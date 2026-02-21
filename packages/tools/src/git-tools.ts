/**
 * Git Tools — read-only git operations + commit with explicit files.
 * Uses a Factory pattern with Dependency Injection: the actual git binary
 * calls are injected via an adapter, keeping this package child_process-free.
 *
 * Security:
 * - requiresConfirmation: true (commit modifies repo state)
 * - No push/pull/merge/rebase/fetch/checkout — only safe read + commit
 * - Ref validation via SAFE_REF_PATTERN (no shell metacharacters)
 * - Path validation against allowedDirectories (no traversal)
 * - commit only with explicitly named files (no git add .)
 * - No eval, no network access
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Adapter Interface ────────────────────────────────────────

export interface StatusResult {
  readonly branch: string
  readonly files: readonly { readonly path: string; readonly status: string }[]
}

export interface LogEntry {
  readonly hash: string
  readonly shortHash: string
  readonly author: string
  readonly date: string
  readonly message: string
}

export interface BranchResult {
  readonly current: string
  readonly branches: readonly string[]
}

export interface CommitResult {
  readonly hash: string
  readonly message: string
  readonly filesCommitted: readonly string[]
}

export interface BlameResult {
  readonly lines: readonly {
    readonly hash: string
    readonly author: string
    readonly lineNumber: number
    readonly content: string
  }[]
}

export interface GitAdapter {
  readonly status: (repoPath: string) => Promise<StatusResult>
  readonly log: (repoPath: string, count: number) => Promise<readonly LogEntry[]>
  readonly diff: (repoPath: string, ref?: string, ref2?: string) => Promise<string>
  readonly branch: (repoPath: string) => Promise<BranchResult>
  readonly commit: (repoPath: string, message: string, files: readonly string[]) => Promise<CommitResult>
  readonly blame: (repoPath: string, filePath: string) => Promise<BlameResult>
}

// ── Configuration ────────────────────────────────────────────

export interface GitToolConfig {
  readonly allowedDirectories: readonly string[]
}

// ── Constants ────────────────────────────────────────────────

export const MAX_DIFF_SIZE = 1_000_000
export const MAX_BLAME_LINES = 10_000
export const MAX_LOG_COUNT = 100
export const DEFAULT_LOG_COUNT = 20
export const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\-/^~@{}:]+$/

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'status',
  'log',
  'diff',
  'branch',
  'commit',
  'blame',
])

// ── Path Validation (from pdf-tools.ts) ──────────────────────

function assertNoNullBytes(p: string): void {
  if (p.includes('\0')) {
    throw new Error('Path contains null bytes')
  }
}

function isWithinAllowed(resolved: string, dirs: readonly string[]): boolean {
  return dirs.some(
    (dir) => resolved === dir || resolved.startsWith(dir + path.sep),
  )
}

async function resolveReal(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const parent = path.dirname(target)
    if (parent === target) return target
    const resolvedParent = await resolveReal(parent)
    return path.join(resolvedParent, path.basename(target))
  }
}

async function validatePath(
  inputPath: string,
  allowedDirs: readonly string[],
): Promise<string> {
  assertNoNullBytes(inputPath)

  const resolved = path.resolve(inputPath)
  const real = await resolveReal(resolved)
  const realAllowedDirs = await Promise.all(allowedDirs.map(resolveReal))

  if (!isWithinAllowed(real, realAllowedDirs)) {
    throw new Error('Access denied: path is outside allowed directories')
  }

  return real
}

// ── Repo Validation ──────────────────────────────────────────

async function validateRepoPath(
  repoPath: string,
  allowedDirs: readonly string[],
): Promise<string> {
  const safe = await validatePath(repoPath, allowedDirs)

  // Check .git directory exists
  try {
    await fs.access(path.join(safe, '.git'))
  } catch {
    throw new Error('Not a git repository (no .git directory found)')
  }

  return safe
}

function validateRef(ref: string): void {
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: ${ref}`)
  }
}

// ── Argument Parsing ─────────────────────────────────────────

interface StatusArgs {
  readonly action: 'status'
  readonly repoPath: string
}

interface LogArgs {
  readonly action: 'log'
  readonly repoPath: string
  readonly count: number
}

interface DiffArgs {
  readonly action: 'diff'
  readonly repoPath: string
  readonly ref?: string
  readonly ref2?: string
}

interface BranchArgs {
  readonly action: 'branch'
  readonly repoPath: string
}

interface CommitArgs {
  readonly action: 'commit'
  readonly repoPath: string
  readonly message: string
  readonly files: readonly string[]
}

interface BlameArgs {
  readonly action: 'blame'
  readonly repoPath: string
  readonly filePath: string
}

type GitToolsArgs = StatusArgs | LogArgs | DiffArgs | BranchArgs | CommitArgs | BlameArgs

function parseArgs(args: unknown): GitToolsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  const repoPath = obj['repoPath']
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new Error('repoPath is required and must be a non-empty string')
  }

  switch (action) {
    case 'status':
      return { action: 'status', repoPath: repoPath.trim() }

    case 'log': {
      let count = DEFAULT_LOG_COUNT
      if (obj['count'] !== undefined) {
        if (typeof obj['count'] !== 'number' || !Number.isInteger(obj['count']) || obj['count'] < 1) {
          throw new Error('count must be a positive integer')
        }
        count = Math.min(obj['count'], MAX_LOG_COUNT)
      }
      return { action: 'log', repoPath: repoPath.trim(), count }
    }

    case 'diff': {
      const ref = obj['ref']
      const ref2 = obj['ref2']
      if (ref !== undefined && typeof ref !== 'string') {
        throw new Error('ref must be a string')
      }
      if (ref2 !== undefined && typeof ref2 !== 'string') {
        throw new Error('ref2 must be a string')
      }
      return {
        action: 'diff',
        repoPath: repoPath.trim(),
        ref: typeof ref === 'string' ? ref : undefined,
        ref2: typeof ref2 === 'string' ? ref2 : undefined,
      }
    }

    case 'branch':
      return { action: 'branch', repoPath: repoPath.trim() }

    case 'commit': {
      const message = obj['message']
      if (typeof message !== 'string' || message.trim() === '') {
        throw new Error('commit requires a non-empty "message" string')
      }
      const files = obj['files']
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('commit requires a non-empty "files" array')
      }
      for (const f of files) {
        if (typeof f !== 'string' || (f as string).trim() === '') {
          throw new Error('commit: each file must be a non-empty string')
        }
      }
      return {
        action: 'commit',
        repoPath: repoPath.trim(),
        message: message.trim(),
        files: (files as string[]).map((f) => f.trim()),
      }
    }

    case 'blame': {
      const filePath = obj['filePath']
      if (typeof filePath !== 'string' || filePath.trim() === '') {
        throw new Error('blame requires a non-empty "filePath" string')
      }
      return { action: 'blame', repoPath: repoPath.trim(), filePath: filePath.trim() }
    }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ── Tool Definition ──────────────────────────────────────────

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Git operation: "status", "log", "diff", "branch", "commit", or "blame"',
      enum: ['status', 'log', 'diff', 'branch', 'commit', 'blame'],
    },
    repoPath: {
      type: 'string',
      description: 'Absolute path to the git repository root',
    },
    count: {
      type: 'integer',
      description: 'Number of log entries to return (default 20, max 100)',
    },
    ref: {
      type: 'string',
      description: 'Git ref for diff (branch, tag, commit hash)',
    },
    ref2: {
      type: 'string',
      description: 'Second git ref for diff (compare ref..ref2)',
    },
    message: {
      type: 'string',
      description: 'Commit message (for "commit" action)',
    },
    files: {
      type: 'array',
      description: 'Files to commit — explicit list, no wildcards (for "commit" action)',
      items: { type: 'string' },
    },
    filePath: {
      type: 'string',
      description: 'File path relative to repo root (for "blame" action)',
    },
  },
  required: ['action', 'repoPath'],
}

// ── Factory ──────────────────────────────────────────────────

export function createGitTool(config: GitToolConfig, adapter: GitAdapter): ExtendedAgentTool {
  const allowedDirs: readonly string[] = config.allowedDirectories.map((d) =>
    path.resolve(d),
  )

  return {
    name: 'git-tools',
    description:
      'Git repository operations. Actions: status(repoPath) shows working tree status; ' +
      'log(repoPath, count?) shows commit history; diff(repoPath, ref?, ref2?) shows changes; ' +
      'branch(repoPath) lists branches; commit(repoPath, message, files) commits specific files; ' +
      'blame(repoPath, filePath) shows line-by-line authorship. Requires user confirmation.',
    parameters: PARAMETERS,
    permissions: ['exec:git', 'fs:read'],
    requiresConfirmation: true,
    runsOn: 'desktop',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)
      const safeRepo = await validateRepoPath(parsed.repoPath, allowedDirs)

      switch (parsed.action) {
        case 'status': {
          const result = await adapter.status(safeRepo)
          return textResult(JSON.stringify(result))
        }

        case 'log': {
          const entries = await adapter.log(safeRepo, parsed.count)
          return textResult(JSON.stringify({ entries, count: entries.length }))
        }

        case 'diff': {
          if (parsed.ref !== undefined) validateRef(parsed.ref)
          if (parsed.ref2 !== undefined) validateRef(parsed.ref2)
          const diffOutput = await adapter.diff(safeRepo, parsed.ref, parsed.ref2)
          const truncated = diffOutput.length > MAX_DIFF_SIZE
          const text = truncated ? diffOutput.slice(0, MAX_DIFF_SIZE) : diffOutput
          return textResult(JSON.stringify({ diff: text, truncated }))
        }

        case 'branch': {
          const result = await adapter.branch(safeRepo)
          return textResult(JSON.stringify(result))
        }

        case 'commit': {
          // Validate each file path is within repo
          for (const file of parsed.files) {
            const filePath = path.isAbsolute(file) ? file : path.join(safeRepo, file)
            await validatePath(filePath, allowedDirs)
          }
          const result = await adapter.commit(safeRepo, parsed.message, parsed.files)
          return textResult(JSON.stringify(result))
        }

        case 'blame': {
          const blameFilePath = path.isAbsolute(parsed.filePath)
            ? parsed.filePath
            : path.join(safeRepo, parsed.filePath)
          await validatePath(blameFilePath, allowedDirs)
          const result = await adapter.blame(safeRepo, parsed.filePath)
          if (result.lines.length > MAX_BLAME_LINES) {
            return textResult(JSON.stringify({
              lines: result.lines.slice(0, MAX_BLAME_LINES),
              truncated: true,
              totalLines: result.lines.length,
            }))
          }
          return textResult(JSON.stringify(result))
        }
      }
    },
  }
}

export { parseArgs }
