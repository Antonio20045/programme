/* eslint-disable security/detect-non-literal-fs-filename -- test file using temp dirs */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAppLauncherTool,
  parseArgs,
  ALLOWED_APPS,
  type AppLauncherAdapter,
} from '../src/app-launcher'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(currentDir, '../src/app-launcher.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter(): AppLauncherAdapter & {
  openApp: ReturnType<typeof vi.fn>
  openFile: ReturnType<typeof vi.fn>
  openUrl: ReturnType<typeof vi.fn>
  getRunning: ReturnType<typeof vi.fn>
  focusApp: ReturnType<typeof vi.fn>
} {
  return {
    openApp: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn().mockResolvedValue(undefined),
    openUrl: vi.fn().mockResolvedValue(undefined),
    getRunning: vi.fn().mockResolvedValue([
      { name: 'Finder', pid: 123 },
      { name: 'Safari', pid: 456 },
    ]),
    focusApp: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let adapter: ReturnType<typeof createMockAdapter>
let tool: ExtendedAgentTool

beforeEach(async () => {
  tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'app-launcher-')))
  adapter = createMockAdapter()
  tool = createAppLauncherTool({ allowedDirectories: [tmpDir] }, adapter)
  vi.clearAllMocks()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Metadata ──────────────────────────────────────────────────

describe('metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('app-launcher')
  })

  it('runs on desktop', () => {
    expect(tool.runsOn).toBe('desktop')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toContain('app:launch')
  })

  it('requires confirmation', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })
})

// ── open() ────────────────────────────────────────────────────

describe('open()', () => {
  it('opens an allowed app via adapter', async () => {
    const result = await tool.execute({ action: 'open', appName: 'Safari' })

    expect(adapter.openApp).toHaveBeenCalledWith('Safari')
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { opened: string }
    expect(parsed.opened).toBe('Safari')
  })

  it('rejects app not in allowlist', async () => {
    await expect(
      tool.execute({ action: 'open', appName: 'MaliciousApp' }),
    ).rejects.toThrow('not in allowlist')
  })
})

// ── openFile() ────────────────────────────────────────────────

describe('openFile()', () => {
  it('opens a file within allowed directories', async () => {
    const filePath = path.join(tmpDir, 'doc.pdf')
    await fs.writeFile(filePath, 'content')

    const result = await tool.execute({ action: 'openFile', filePath })

    expect(adapter.openFile).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { openedFile: string }
    expect(parsed.openedFile).toBe(filePath)
  })

  it('rejects file outside allowed directories', async () => {
    await expect(
      tool.execute({ action: 'openFile', filePath: '/etc/passwd' }),
    ).rejects.toThrow('outside allowed directories')
  })
})

// ── openUrl() ─────────────────────────────────────────────────

describe('openUrl()', () => {
  it('opens an https URL', async () => {
    const result = await tool.execute({
      action: 'openUrl',
      url: 'https://example.com',
    })

    expect(adapter.openUrl).toHaveBeenCalledWith('https://example.com')
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { openedUrl: string }
    expect(parsed.openedUrl).toBe('https://example.com')
  })

  it('rejects http:// URL', async () => {
    await expect(
      tool.execute({ action: 'openUrl', url: 'http://example.com' }),
    ).rejects.toThrow('Only https://')
  })

  it('rejects javascript: URL', async () => {
    await expect(
      tool.execute({ action: 'openUrl', url: 'javascript:alert(1)' }),
    ).rejects.toThrow()
  })

  it('rejects file:// URL', async () => {
    await expect(
      tool.execute({ action: 'openUrl', url: 'file:///etc/passwd' }),
    ).rejects.toThrow('Only https://')
  })

  it('rejects invalid URL', async () => {
    await expect(
      tool.execute({ action: 'openUrl', url: 'not a url' }),
    ).rejects.toThrow('Invalid URL')
  })
})

// ── running() ─────────────────────────────────────────────────

describe('running()', () => {
  it('returns running processes via adapter', async () => {
    const result = await tool.execute({ action: 'running' })

    expect(adapter.getRunning).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { processes: { name: string; pid: number }[] }
    expect(parsed.processes).toHaveLength(2)
    expect(parsed.processes[0]?.name).toBe('Finder')
  })
})

// ── focus() ───────────────────────────────────────────────────

describe('focus()', () => {
  it('focuses an allowed app via adapter', async () => {
    const result = await tool.execute({ action: 'focus', appName: 'Terminal' })

    expect(adapter.focusApp).toHaveBeenCalledWith('Terminal')
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { focused: string }
    expect(parsed.focused).toBe('Terminal')
  })

  it('rejects app not in allowlist', async () => {
    await expect(
      tool.execute({ action: 'focus', appName: 'HackerTool' }),
    ).rejects.toThrow('not in allowlist')
  })
})

// ── parseArgs() ───────────────────────────────────────────────

describe('parseArgs()', () => {
  it('parses open', () => {
    expect(parseArgs({ action: 'open', appName: 'Safari' })).toEqual({
      action: 'open',
      appName: 'Safari',
    })
  })

  it('parses running (no extra args)', () => {
    expect(parseArgs({ action: 'running' })).toEqual({ action: 'running' })
  })

  it('rejects null', () => {
    expect(() => parseArgs(null)).toThrow('non-null object')
  })

  it('rejects non-object', () => {
    expect(() => parseArgs(42)).toThrow('non-null object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'delete' })).toThrow('Invalid action')
  })

  it('rejects open without appName', () => {
    expect(() => parseArgs({ action: 'open' })).toThrow('non-empty "appName"')
  })

  it('rejects openFile without filePath', () => {
    expect(() => parseArgs({ action: 'openFile' })).toThrow('non-empty "filePath"')
  })

  it('rejects openUrl without url', () => {
    expect(() => parseArgs({ action: 'openUrl' })).toThrow('non-empty "url"')
  })

  it('rejects focus without appName', () => {
    expect(() => parseArgs({ action: 'focus' })).toThrow('non-empty "appName"')
  })
})

// ── Path Traversal ────────────────────────────────────────────

describe('path traversal protection', () => {
  it('blocks ../../etc/passwd via openFile', async () => {
    await expect(
      tool.execute({
        action: 'openFile',
        filePath: path.join(tmpDir, '..', '..', 'etc', 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks symlink pointing outside', async () => {
    const linkPath = path.join(tmpDir, 'evil-link')
    await fs.symlink('/etc', linkPath)

    await expect(
      tool.execute({
        action: 'openFile',
        filePath: path.join(linkPath, 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks null bytes in path', async () => {
    await expect(
      tool.execute({
        action: 'openFile',
        filePath: path.join(tmpDir, 'file\0.txt'),
      }),
    ).rejects.toThrow('null bytes')
  })
})

// ── ALLOWED_APPS ──────────────────────────────────────────────

describe('ALLOWED_APPS', () => {
  it('is a non-empty set', () => {
    expect(ALLOWED_APPS.size).toBeGreaterThan(0)
  })

  it('contains common macOS apps', () => {
    expect(ALLOWED_APPS.has('Safari')).toBe(true)
    expect(ALLOWED_APPS.has('Finder')).toBe(true)
    expect(ALLOWED_APPS.has('Terminal')).toBe(true)
  })

  it('does not contain dangerous apps', () => {
    expect(ALLOWED_APPS.has('rm')).toBe(false)
    expect(ALLOWED_APPS.has('bash')).toBe(false)
    expect(ALLOWED_APPS.has('sh')).toBe(false)
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

  it('does not import child_process', () => {
    expect(sourceCode).not.toMatch(/require\s*\(\s*['"]child_process['"]\s*\)/)
    expect(sourceCode).not.toMatch(/from\s+['"]child_process['"]/)
    expect(sourceCode).not.toMatch(/from\s+['"]node:child_process['"]/)
  })
})
