/**
 * Filesystem tool — read, write, search, list, move, and delete files.
 * All paths are validated against configurable allowed directories.
 * Symlinks are resolved to prevent escaping the sandbox.
 */

import type { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Configuration ──────────────────────────────────────────────

export interface FilesystemConfig {
  readonly allowedDirectories: readonly string[]
}

/** Maximum file size for readFile (10 MB) to prevent OOM. */
const MAX_READ_SIZE = 10 * 1024 * 1024

/** Actions that mutate the filesystem and require user confirmation. */
export const ACTIONS_REQUIRING_CONFIRMATION: ReadonlySet<string> = new Set([
  'writeFile',
  'moveFile',
  'deleteFile',
])

// ── Path Validation ────────────────────────────────────────────

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

/**
 * Resolves a path following symlinks where they exist.
 * For non-existing segments, resolves the deepest existing ancestor
 * and appends the remaining segments.
 */
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

/**
 * Validates that inputPath resides within allowedDirs.
 * 1. Rejects null bytes.
 * 2. Resolves to an absolute path.
 * 3. Resolves symlinks in both target and allowed dirs.
 * 4. Checks real path against real allowed dirs.
 *
 * Both sides are resolved to handle platforms where system paths
 * contain symlinks (e.g. macOS: /var -> /private/var).
 */
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

// ── Argument Parsing ───────────────────────────────────────────

interface ReadFileArgs {
  readonly action: 'readFile'
  readonly path: string
}
interface WriteFileArgs {
  readonly action: 'writeFile'
  readonly path: string
  readonly content: string
}
interface SearchFilesArgs {
  readonly action: 'searchFiles'
  readonly query: string
  readonly directory: string
}
interface ListDirectoryArgs {
  readonly action: 'listDirectory'
  readonly path: string
}
interface MoveFileArgs {
  readonly action: 'moveFile'
  readonly from: string
  readonly to: string
}
interface DeleteFileArgs {
  readonly action: 'deleteFile'
  readonly path: string
}

type FilesystemArgs =
  | ReadFileArgs
  | WriteFileArgs
  | SearchFilesArgs
  | ListDirectoryArgs
  | MoveFileArgs
  | DeleteFileArgs

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'readFile',
  'writeFile',
  'searchFiles',
  'listDirectory',
  'moveFile',
  'deleteFile',
])

function requireString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key]
  if (typeof val !== 'string') {
    throw new Error(`${key} is required and must be a string`)
  }
  return val
}

function parseArgs(args: unknown): FilesystemArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  switch (action) {
    case 'readFile':
      return { action, path: requireString(obj, 'path') }
    case 'writeFile':
      return {
        action,
        path: requireString(obj, 'path'),
        content: requireString(obj, 'content'),
      }
    case 'searchFiles':
      return {
        action,
        query: requireString(obj, 'query'),
        directory: requireString(obj, 'directory'),
      }
    case 'listDirectory':
      return { action, path: requireString(obj, 'path') }
    case 'moveFile':
      return {
        action,
        from: requireString(obj, 'from'),
        to: requireString(obj, 'to'),
      }
    case 'deleteFile':
      return { action, path: requireString(obj, 'path') }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

// ── Helpers ────────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

async function searchRecursive(
  directory: string,
  query: string,
  allowedDirs: readonly string[],
): Promise<string[]> {
  const lowerQuery = query.toLowerCase()

  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const results: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)

    if (entry.name.toLowerCase().includes(lowerQuery)) {
      results.push(fullPath)
    }

    if (entry.isDirectory()) {
      try {
        await validatePath(fullPath, allowedDirs)
        const sub = await searchRecursive(fullPath, query, allowedDirs)
        results.push(...sub)
      } catch {
        // Skip directories outside allowed paths or unreadable
      }
    }
  }

  return results
}

// ── Tool Definition ────────────────────────────────────────────

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Filesystem operation to perform',
      enum: [
        'readFile',
        'writeFile',
        'searchFiles',
        'listDirectory',
        'moveFile',
        'deleteFile',
      ],
    },
    path: {
      type: 'string',
      description:
        'File or directory path (readFile, writeFile, listDirectory, deleteFile)',
    },
    content: {
      type: 'string',
      description: 'File content to write (writeFile)',
    },
    query: {
      type: 'string',
      description: 'Filename search query (searchFiles)',
    },
    directory: {
      type: 'string',
      description: 'Directory to search in (searchFiles)',
    },
    from: {
      type: 'string',
      description: 'Source path (moveFile)',
    },
    to: {
      type: 'string',
      description: 'Destination path (moveFile)',
    },
  },
  required: ['action'],
}

// ── Factory ────────────────────────────────────────────────────

export function createFilesystemTool(
  config: FilesystemConfig,
): ExtendedAgentTool {
  if (config.allowedDirectories.length === 0) {
    throw new Error('At least one allowed directory must be configured')
  }

  const allowedDirs: readonly string[] = config.allowedDirectories.map((d) =>
    path.resolve(d),
  )

  return {
    name: 'filesystem',
    description:
      'Read, write, search, list, move, and delete files within allowed directories. ' +
      'writeFile, moveFile, and deleteFile require user confirmation.',
    parameters: PARAMETERS,
    permissions: ['fs:read', 'fs:write'],
    requiresConfirmation: true,
    runsOn: 'desktop',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'readFile': {
          const safe = await validatePath(parsed.path, allowedDirs)
          const stat = await fs.stat(safe)
          if (stat.size > MAX_READ_SIZE) {
            throw new Error(`File too large (${String(stat.size)} bytes). Maximum: ${String(MAX_READ_SIZE)} bytes (10 MB)`)
          }
          const content = await fs.readFile(safe, 'utf-8')
          return textResult(content)
        }

        case 'writeFile': {
          const safe = await validatePath(parsed.path, allowedDirs)
          await fs.mkdir(path.dirname(safe), { recursive: true })
          await fs.writeFile(safe, parsed.content, 'utf-8')
          return textResult(`Written: ${safe}`)
        }

        case 'searchFiles': {
          const safeDir = await validatePath(parsed.directory, allowedDirs)
          const matches = await searchRecursive(
            safeDir,
            parsed.query,
            allowedDirs,
          )
          return textResult(
            matches.length > 0 ? matches.join('\n') : 'No files found',
          )
        }

        case 'listDirectory': {
          const safeDir = await validatePath(parsed.path, allowedDirs)
          const entries = await fs.readdir(safeDir, { withFileTypes: true })
          const lines = entries.map(
            (e) =>
              `${e.isDirectory() ? '[DIR]  ' : '       '}${e.name}`,
          )
          return textResult(
            lines.length > 0 ? lines.join('\n') : 'Empty directory',
          )
        }

        case 'moveFile': {
          const safeFrom = await validatePath(parsed.from, allowedDirs)
          const safeTo = await validatePath(parsed.to, allowedDirs)
          await fs.rename(safeFrom, safeTo)
          return textResult(`Moved: ${safeFrom} → ${safeTo}`)
        }

        case 'deleteFile': {
          const safe = await validatePath(parsed.path, allowedDirs)
          await fs.unlink(safe)
          return textResult(`Deleted: ${safe}`)
        }
      }
    },
  }
}
