import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGitTool,
  parseArgs,
  type GitAdapter,
  type StatusResult,
  type LogEntry,
  type BranchResult,
  type CommitResult,
  type BlameResult,
  MAX_DIFF_SIZE,
  MAX_LOG_COUNT,
  MAX_BLAME_LINES,
  DEFAULT_LOG_COUNT,
  SAFE_REF_PATTERN,
} from '../src/git-tools'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(currentDir, '../src/git-tools.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter(): GitAdapter & {
  status: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
  diff: ReturnType<typeof vi.fn>
  branch: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  blame: ReturnType<typeof vi.fn>
} {
  const statusResult: StatusResult = {
    branch: 'main',
    files: [{ path: 'file.ts', status: 'M' }],
  }
  const logEntries: LogEntry[] = [{
    hash: 'abc123def456',
    shortHash: 'abc123d',
    author: 'Test User',
    date: '2025-01-01',
    message: 'test commit',
  }]
  const branchResult: BranchResult = {
    current: 'main',
    branches: ['main', 'develop'],
  }
  const commitResult: CommitResult = {
    hash: 'newcommithash',
    message: 'test message',
    filesCommitted: ['file.ts'],
  }
  const blameResult: BlameResult = {
    lines: [{
      hash: 'abc123',
      author: 'Test User',
      lineNumber: 1,
      content: 'const x = 1',
    }],
  }

  return {
    status: vi.fn().mockResolvedValue(statusResult),
    log: vi.fn().mockResolvedValue(logEntries),
    diff: vi.fn().mockResolvedValue('diff --git a/file.ts b/file.ts\n+added line'),
    branch: vi.fn().mockResolvedValue(branchResult),
    commit: vi.fn().mockResolvedValue(commitResult),
    blame: vi.fn().mockResolvedValue(blameResult),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let adapter: ReturnType<typeof createMockAdapter>
let tool: ExtendedAgentTool

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'git-tool-')))
  // Create .git directory to pass repo validation
  await fs.mkdir(path.join(tmpDir, '.git'))
  adapter = createMockAdapter()
  tool = createGitTool({ allowedDirectories: [tmpDir] }, adapter)
  vi.clearAllMocks()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Metadata ──────────────────────────────────────────────────

describe('metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('git-tools')
  })

  it('runs on desktop', () => {
    expect(tool.runsOn).toBe('desktop')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toContain('exec:git')
    expect(tool.permissions).toContain('fs:read')
  })

  it('requires confirmation', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })
})

// ── status() ──────────────────────────────────────────────────

describe('status()', () => {
  it('returns status via adapter', async () => {
    const result = await tool.execute({ action: 'status', repoPath: tmpDir })

    expect(adapter.status).toHaveBeenCalledOnce()
    expect(adapter.status).toHaveBeenCalledWith(tmpDir)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as StatusResult
    expect(parsed.branch).toBe('main')
    expect(parsed.files).toHaveLength(1)
  })
})

// ── log() ─────────────────────────────────────────────────────

describe('log()', () => {
  it('returns log entries via adapter with default count', async () => {
    const result = await tool.execute({ action: 'log', repoPath: tmpDir })

    expect(adapter.log).toHaveBeenCalledWith(tmpDir, DEFAULT_LOG_COUNT)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { entries: LogEntry[]; count: number }
    expect(parsed.entries).toHaveLength(1)
  })

  it('respects custom count', async () => {
    await tool.execute({ action: 'log', repoPath: tmpDir, count: 5 })

    expect(adapter.log).toHaveBeenCalledWith(tmpDir, 5)
  })

  it('caps count at MAX_LOG_COUNT', async () => {
    await tool.execute({ action: 'log', repoPath: tmpDir, count: 999 })

    expect(adapter.log).toHaveBeenCalledWith(tmpDir, MAX_LOG_COUNT)
  })
})

// ── diff() ────────────────────────────────────────────────────

describe('diff()', () => {
  it('returns diff via adapter', async () => {
    const result = await tool.execute({ action: 'diff', repoPath: tmpDir })

    expect(adapter.diff).toHaveBeenCalledWith(tmpDir, undefined, undefined)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { diff: string; truncated: boolean }
    expect(parsed.diff).toContain('+added line')
    expect(parsed.truncated).toBe(false)
  })

  it('passes ref and ref2 to adapter', async () => {
    await tool.execute({ action: 'diff', repoPath: tmpDir, ref: 'HEAD~1', ref2: 'HEAD' })

    expect(adapter.diff).toHaveBeenCalledWith(tmpDir, 'HEAD~1', 'HEAD')
  })

  it('truncates diff larger than MAX_DIFF_SIZE', async () => {
    adapter.diff.mockResolvedValue('X'.repeat(MAX_DIFF_SIZE + 100))

    const result = await tool.execute({ action: 'diff', repoPath: tmpDir })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { diff: string; truncated: boolean }
    expect(parsed.truncated).toBe(true)
    expect(parsed.diff.length).toBe(MAX_DIFF_SIZE)
  })

  it('rejects invalid ref characters', async () => {
    await expect(
      tool.execute({ action: 'diff', repoPath: tmpDir, ref: 'HEAD; rm -rf /' }),
    ).rejects.toThrow('Invalid git ref')
  })
})

// ── branch() ──────────────────────────────────────────────────

describe('branch()', () => {
  it('returns branches via adapter', async () => {
    const result = await tool.execute({ action: 'branch', repoPath: tmpDir })

    expect(adapter.branch).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as BranchResult
    expect(parsed.current).toBe('main')
    expect(parsed.branches).toContain('develop')
  })
})

// ── commit() ──────────────────────────────────────────────────

describe('commit()', () => {
  it('commits specific files via adapter', async () => {
    // Create a file inside tmpDir for validation
    const filePath = path.join(tmpDir, 'file.ts')
    await fs.writeFile(filePath, 'content')

    const result = await tool.execute({
      action: 'commit',
      repoPath: tmpDir,
      message: 'test commit',
      files: ['file.ts'],
    })

    expect(adapter.commit).toHaveBeenCalledWith(tmpDir, 'test commit', ['file.ts'])
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as CommitResult
    expect(parsed.hash).toBe('newcommithash')
  })

  it('rejects empty files array', async () => {
    await expect(
      tool.execute({ action: 'commit', repoPath: tmpDir, message: 'msg', files: [] }),
    ).rejects.toThrow('non-empty "files"')
  })

  it('rejects empty message', async () => {
    await expect(
      tool.execute({ action: 'commit', repoPath: tmpDir, message: '', files: ['f.ts'] }),
    ).rejects.toThrow('non-empty "message"')
  })
})

// ── blame() ───────────────────────────────────────────────────

describe('blame()', () => {
  it('returns blame via adapter', async () => {
    // Create the file for path validation
    const filePath = path.join(tmpDir, 'file.ts')
    await fs.writeFile(filePath, 'content')

    const result = await tool.execute({
      action: 'blame',
      repoPath: tmpDir,
      filePath: 'file.ts',
    })

    expect(adapter.blame).toHaveBeenCalledWith(tmpDir, 'file.ts')
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as BlameResult
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]?.author).toBe('Test User')
  })

  it('truncates blame with more than MAX_BLAME_LINES', async () => {
    const filePath = path.join(tmpDir, 'big.ts')
    await fs.writeFile(filePath, 'content')

    const manyLines = Array.from({ length: MAX_BLAME_LINES + 100 }, (_, i) => ({
      hash: 'abc',
      author: 'User',
      lineNumber: i + 1,
      content: `line ${String(i)}`,
    }))
    adapter.blame.mockResolvedValue({ lines: manyLines })

    const result = await tool.execute({
      action: 'blame',
      repoPath: tmpDir,
      filePath: 'big.ts',
    })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { lines: unknown[]; truncated: boolean; totalLines: number }
    expect(parsed.truncated).toBe(true)
    expect(parsed.lines).toHaveLength(MAX_BLAME_LINES)
    expect(parsed.totalLines).toBe(MAX_BLAME_LINES + 100)
  })
})

// ── parseArgs() ───────────────────────────────────────────────

describe('parseArgs()', () => {
  it('parses status', () => {
    expect(parseArgs({ action: 'status', repoPath: '/repo' })).toEqual({
      action: 'status',
      repoPath: '/repo',
    })
  })

  it('parses log with default count', () => {
    const result = parseArgs({ action: 'log', repoPath: '/repo' })
    expect(result).toEqual({ action: 'log', repoPath: '/repo', count: DEFAULT_LOG_COUNT })
  })

  it('parses commit', () => {
    const result = parseArgs({
      action: 'commit',
      repoPath: '/repo',
      message: 'msg',
      files: ['a.ts'],
    })
    expect(result).toEqual({
      action: 'commit',
      repoPath: '/repo',
      message: 'msg',
      files: ['a.ts'],
    })
  })

  it('rejects null', () => {
    expect(() => parseArgs(null)).toThrow('non-null object')
  })

  it('rejects non-object', () => {
    expect(() => parseArgs(42)).toThrow('non-null object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'push', repoPath: '/repo' })).toThrow('Invalid action')
  })

  it('rejects missing repoPath', () => {
    expect(() => parseArgs({ action: 'status' })).toThrow('repoPath is required')
  })

  it('rejects non-integer count', () => {
    expect(() => parseArgs({ action: 'log', repoPath: '/r', count: 1.5 })).toThrow('positive integer')
  })

  it('rejects commit with non-string files', () => {
    expect(() => parseArgs({
      action: 'commit',
      repoPath: '/r',
      message: 'msg',
      files: [123],
    })).toThrow('non-empty string')
  })

  it('rejects blame without filePath', () => {
    expect(() => parseArgs({ action: 'blame', repoPath: '/r' })).toThrow('non-empty "filePath"')
  })
})

// ── Repo Validation ───────────────────────────────────────────

describe('repo validation', () => {
  it('rejects path without .git directory', async () => {
    const noGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nogit-'))
    const noGitTool = createGitTool({ allowedDirectories: [noGitDir] }, adapter)

    await expect(
      noGitTool.execute({ action: 'status', repoPath: noGitDir }),
    ).rejects.toThrow('Not a git repository')

    await fs.rm(noGitDir, { recursive: true, force: true })
  })

  it('rejects repo path outside allowed directories', async () => {
    await expect(
      tool.execute({ action: 'status', repoPath: '/etc' }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('rejects path with null bytes', async () => {
    await expect(
      tool.execute({ action: 'status', repoPath: tmpDir + '\0hack' }),
    ).rejects.toThrow('null bytes')
  })
})

// ── SAFE_REF_PATTERN ─────────────────────────────────────────

describe('SAFE_REF_PATTERN', () => {
  it('allows normal refs', () => {
    expect(SAFE_REF_PATTERN.test('main')).toBe(true)
    expect(SAFE_REF_PATTERN.test('HEAD~1')).toBe(true)
    expect(SAFE_REF_PATTERN.test('v1.0.0')).toBe(true)
    expect(SAFE_REF_PATTERN.test('origin/main')).toBe(true)
    expect(SAFE_REF_PATTERN.test('HEAD^')).toBe(true)
    expect(SAFE_REF_PATTERN.test('HEAD@{1}')).toBe(true)
  })

  it('rejects shell metacharacters', () => {
    expect(SAFE_REF_PATTERN.test('HEAD; rm -rf /')).toBe(false)
    expect(SAFE_REF_PATTERN.test('$(whoami)')).toBe(false)
    expect(SAFE_REF_PATTERN.test('`id`')).toBe(false)
    expect(SAFE_REF_PATTERN.test('a|b')).toBe(false)
    expect(SAFE_REF_PATTERN.test('a&b')).toBe(false)
    expect(SAFE_REF_PATTERN.test('a\nb')).toBe(false)
  })
})

// ── Security ──────────────────────────────────────────────────

describe('security', () => {
  it('contains no eval/exec patterns', () => {
    assertNoEval(sourceCode)
  })

  it('does not use fetch (no network access)', () => {
    assertNoUnauthorizedFetch(sourceCode, [])
  })

  it('does not import child_process (adapter handles exec)', () => {
    expect(sourceCode).not.toMatch(/require\s*\(\s*['"]child_process['"]\s*\)/)
    expect(sourceCode).not.toMatch(/from\s+['"]child_process['"]/)
    expect(sourceCode).not.toMatch(/from\s+['"]node:child_process['"]/)
  })

  it('does not allow push/pull/merge/rebase/fetch/checkout', () => {
    const dangerousActions = ['push', 'pull', 'merge', 'rebase', 'fetch', 'checkout']
    for (const action of dangerousActions) {
      expect(() => parseArgs({ action, repoPath: '/repo' })).toThrow('Invalid action')
    }
  })
})
