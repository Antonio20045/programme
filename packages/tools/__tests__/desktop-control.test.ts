import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDesktopControlTool,
  parseArgs,
  TEXT_MAX_LENGTH,
  ALLOWED_KEYS,
  ALLOWED_MODIFIERS,
  KEY_CODES,
  type DesktopControlAdapter,
} from '../src/desktop-control'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/desktop-control.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter(): DesktopControlAdapter & {
  click: ReturnType<typeof vi.fn>
  doubleClick: ReturnType<typeof vi.fn>
  rightClick: ReturnType<typeof vi.fn>
  type: ReturnType<typeof vi.fn>
  keystroke: ReturnType<typeof vi.fn>
  scroll: ReturnType<typeof vi.fn>
  getCursorPosition: ReturnType<typeof vi.fn>
} {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    rightClick: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    keystroke: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    getCursorPosition: vi.fn().mockResolvedValue({ x: 100, y: 200 }),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let adapter: ReturnType<typeof createMockAdapter>
let tool: ExtendedAgentTool

beforeEach(() => {
  adapter = createMockAdapter()
  tool = createDesktopControlTool(adapter)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Metadata ──────────────────────────────────────────────────

describe('metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('desktop-control')
  })

  it('runs on desktop', () => {
    expect(tool.runsOn).toBe('desktop')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toContain('desktop:control')
  })

  it('requires confirmation (UI automation)', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })

  it('has correct risk tiers', () => {
    expect(tool.riskTiers).toEqual({
      click: 2,
      doubleClick: 2,
      rightClick: 2,
      type: 2,
      keystroke: 2,
      scroll: 1,
      getCursorPosition: 0,
    })
  })

  it('has defaultRiskTier 2', () => {
    expect(tool.defaultRiskTier).toBe(2)
  })
})

// ── click() ──────────────────────────────────────────────────

describe('click()', () => {
  it('clicks at coordinates via adapter', async () => {
    const result = await tool.execute({ action: 'click', x: 100, y: 200 })

    expect(adapter.click).toHaveBeenCalledWith(100, 200)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; x: number; y: number; success: boolean }
    expect(parsed.success).toBe(true)
    expect(parsed.x).toBe(100)
    expect(parsed.y).toBe(200)
  })

  it('rounds fractional coordinates', async () => {
    await tool.execute({ action: 'click', x: 100.7, y: 200.3 })

    expect(adapter.click).toHaveBeenCalledWith(101, 200)
  })
})

// ── doubleClick() ────────────────────────────────────────────

describe('doubleClick()', () => {
  it('double-clicks at coordinates via adapter', async () => {
    const result = await tool.execute({ action: 'doubleClick', x: 50, y: 75 })

    expect(adapter.doubleClick).toHaveBeenCalledWith(50, 75)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; success: boolean }
    expect(parsed.action).toBe('doubleClick')
    expect(parsed.success).toBe(true)
  })
})

// ── rightClick() ─────────────────────────────────────────────

describe('rightClick()', () => {
  it('right-clicks at coordinates via adapter', async () => {
    const result = await tool.execute({ action: 'rightClick', x: 300, y: 400 })

    expect(adapter.rightClick).toHaveBeenCalledWith(300, 400)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; success: boolean }
    expect(parsed.action).toBe('rightClick')
    expect(parsed.success).toBe(true)
  })
})

// ── type() ───────────────────────────────────────────────────

describe('type()', () => {
  it('types text via adapter', async () => {
    const result = await tool.execute({ action: 'type', text: 'Hello World' })

    expect(adapter.type).toHaveBeenCalledWith('Hello World')
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; length: number; success: boolean }
    expect(parsed.success).toBe(true)
    expect(parsed.length).toBe(11)
  })

  it('rejects empty text', async () => {
    await expect(
      tool.execute({ action: 'type', text: '' }),
    ).rejects.toThrow('must not be empty')
  })

  it('rejects text exceeding max length', async () => {
    const longText = 'a'.repeat(TEXT_MAX_LENGTH + 1)
    await expect(
      tool.execute({ action: 'type', text: longText }),
    ).rejects.toThrow('exceeds maximum length')
  })

  it('rejects text with null bytes', async () => {
    await expect(
      tool.execute({ action: 'type', text: 'hello\0world' }),
    ).rejects.toThrow('null bytes')
  })

  it('rejects non-string text', async () => {
    await expect(
      tool.execute({ action: 'type', text: 123 }),
    ).rejects.toThrow('string "text"')
  })
})

// ── keystroke() ──────────────────────────────────────────────

describe('keystroke()', () => {
  it('presses a key via adapter', async () => {
    const result = await tool.execute({ action: 'keystroke', key: 'return' })

    expect(adapter.keystroke).toHaveBeenCalledWith('return', undefined)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; key: string; success: boolean }
    expect(parsed.success).toBe(true)
    expect(parsed.key).toBe('return')
  })

  it('presses key with modifiers', async () => {
    const result = await tool.execute({
      action: 'keystroke',
      key: 'n',
      modifiers: ['command'],
    })

    expect(adapter.keystroke).toHaveBeenCalledWith('n', ['command'])
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { modifiers: string[] }
    expect(parsed.modifiers).toEqual(['command'])
  })

  it('normalizes key to lowercase', async () => {
    await tool.execute({ action: 'keystroke', key: 'Return' })

    expect(adapter.keystroke).toHaveBeenCalledWith('return', undefined)
  })

  it('normalizes modifiers to lowercase', async () => {
    await tool.execute({ action: 'keystroke', key: 'a', modifiers: ['Command', 'SHIFT'] })

    expect(adapter.keystroke).toHaveBeenCalledWith('a', ['command', 'shift'])
  })

  it('rejects disallowed key', async () => {
    await expect(
      tool.execute({ action: 'keystroke', key: 'backslash' }),
    ).rejects.toThrow('Key not allowed')
  })

  it('rejects disallowed modifier', async () => {
    await expect(
      tool.execute({ action: 'keystroke', key: 'a', modifiers: ['super'] }),
    ).rejects.toThrow('Modifier not allowed')
  })

  it('rejects non-array modifiers', async () => {
    await expect(
      tool.execute({ action: 'keystroke', key: 'a', modifiers: 'command' }),
    ).rejects.toThrow('modifiers must be an array')
  })
})

// ── scroll() ─────────────────────────────────────────────────

describe('scroll()', () => {
  it('scrolls via adapter', async () => {
    const result = await tool.execute({ action: 'scroll', direction: 'down', amount: 5 })

    expect(adapter.scroll).toHaveBeenCalledWith('down', 5)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; direction: string; amount: number; success: boolean }
    expect(parsed.success).toBe(true)
    expect(parsed.direction).toBe('down')
  })

  it('rejects invalid direction', async () => {
    await expect(
      tool.execute({ action: 'scroll', direction: 'diagonal', amount: 5 }),
    ).rejects.toThrow('Invalid scroll direction')
  })

  it('rejects non-positive amount', async () => {
    await expect(
      tool.execute({ action: 'scroll', direction: 'up', amount: 0 }),
    ).rejects.toThrow('positive numeric "amount"')
  })

  it('rejects negative amount', async () => {
    await expect(
      tool.execute({ action: 'scroll', direction: 'up', amount: -3 }),
    ).rejects.toThrow('positive numeric "amount"')
  })
})

// ── getCursorPosition() ──────────────────────────────────────

describe('getCursorPosition()', () => {
  it('returns cursor position from adapter', async () => {
    const result = await tool.execute({ action: 'getCursorPosition' })

    expect(adapter.getCursorPosition).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { x: number; y: number }
    expect(parsed.x).toBe(100)
    expect(parsed.y).toBe(200)
  })
})

// ── parseArgs() ──────────────────────────────────────────────

describe('parseArgs()', () => {
  it('rejects null', () => {
    expect(() => parseArgs(null)).toThrow('non-null object')
  })

  it('rejects non-object', () => {
    expect(() => parseArgs('string')).toThrow('non-null object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'drag' })).toThrow('Invalid action')
  })

  it('rejects negative x', () => {
    expect(() => parseArgs({ action: 'click', x: -1, y: 0 })).toThrow('non-negative')
  })

  it('rejects negative y', () => {
    expect(() => parseArgs({ action: 'click', x: 0, y: -1 })).toThrow('non-negative')
  })

  it('rejects non-numeric coordinates', () => {
    expect(() => parseArgs({ action: 'click', x: 'abc', y: 0 })).toThrow('non-negative')
  })

  it('rejects Infinity coordinates', () => {
    expect(() => parseArgs({ action: 'click', x: Infinity, y: 0 })).toThrow('non-negative')
  })
})

// ── Constants ────────────────────────────────────────────────

describe('constants', () => {
  it('KEY_CODES contains expected special keys', () => {
    expect(KEY_CODES['return']).toBe(36)
    expect(KEY_CODES['tab']).toBe(48)
    expect(KEY_CODES['escape']).toBe(53)
    expect(KEY_CODES['space']).toBe(49)
    expect(KEY_CODES['delete']).toBe(51)
  })

  it('ALLOWED_KEYS contains a-z', () => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      expect(ALLOWED_KEYS.has(c)).toBe(true)
    }
  })

  it('ALLOWED_KEYS contains 0-9', () => {
    for (const c of '0123456789') {
      expect(ALLOWED_KEYS.has(c)).toBe(true)
    }
  })

  it('ALLOWED_MODIFIERS has the four macOS modifiers', () => {
    expect(ALLOWED_MODIFIERS.has('command')).toBe(true)
    expect(ALLOWED_MODIFIERS.has('shift')).toBe(true)
    expect(ALLOWED_MODIFIERS.has('option')).toBe(true)
    expect(ALLOWED_MODIFIERS.has('control')).toBe(true)
    expect(ALLOWED_MODIFIERS.size).toBe(4)
  })
})

// ── Security ─────────────────────────────────────────────────

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

  it('does not import fs', () => {
    expect(sourceCode).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(sourceCode).not.toMatch(/from\s+['"]fs['"]/)
  })

  it('enforces text max length', () => {
    expect(TEXT_MAX_LENGTH).toBe(10_000)
  })

  it('rejects null bytes in text', () => {
    expect(() => parseArgs({ action: 'type', text: 'a\0b' })).toThrow('null bytes')
  })

  it('validates key against allowlist', () => {
    expect(() => parseArgs({ action: 'keystroke', key: 'rm -rf' })).toThrow('Key not allowed')
  })

  it('validates modifiers against allowlist', () => {
    expect(() => parseArgs({
      action: 'keystroke',
      key: 'a',
      modifiers: ['meta'],
    })).toThrow('Modifier not allowed')
  })
})
