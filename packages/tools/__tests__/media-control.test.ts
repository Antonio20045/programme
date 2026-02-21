import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMediaControlTool,
  parseArgs,
  VOLUME_MIN,
  VOLUME_MAX,
  type MediaAdapter,
} from '../src/media-control'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/media-control.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter(): MediaAdapter & {
  playPause: ReturnType<typeof vi.fn>
  next: ReturnType<typeof vi.fn>
  previous: ReturnType<typeof vi.fn>
  setVolume: ReturnType<typeof vi.fn>
  getVolume: ReturnType<typeof vi.fn>
  mute: ReturnType<typeof vi.fn>
  getNowPlaying: ReturnType<typeof vi.fn>
} {
  return {
    playPause: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    previous: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    getVolume: vi.fn().mockResolvedValue(50),
    mute: vi.fn().mockResolvedValue(undefined),
    getNowPlaying: vi.fn().mockResolvedValue({
      title: 'Test Song',
      artist: 'Test Artist',
      app: 'Music',
    }),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let adapter: ReturnType<typeof createMockAdapter>
let tool: ExtendedAgentTool

beforeEach(() => {
  adapter = createMockAdapter()
  tool = createMediaControlTool(adapter)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Metadata ──────────────────────────────────────────────────

describe('metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('media-control')
  })

  it('runs on desktop', () => {
    expect(tool.runsOn).toBe('desktop')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toContain('media:control')
  })

  it('does not require confirmation (non-destructive)', () => {
    expect(tool.requiresConfirmation).toBe(false)
  })
})

// ── playPause() ───────────────────────────────────────────────

describe('playPause()', () => {
  it('toggles playback via adapter', async () => {
    const result = await tool.execute({ action: 'playPause' })

    expect(adapter.playPause).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; success: boolean }
    expect(parsed.success).toBe(true)
  })
})

// ── next() ────────────────────────────────────────────────────

describe('next()', () => {
  it('skips to next track via adapter', async () => {
    const result = await tool.execute({ action: 'next' })

    expect(adapter.next).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; success: boolean }
    expect(parsed.action).toBe('next')
    expect(parsed.success).toBe(true)
  })
})

// ── previous() ────────────────────────────────────────────────

describe('previous()', () => {
  it('goes to previous track via adapter', async () => {
    const result = await tool.execute({ action: 'previous' })

    expect(adapter.previous).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; success: boolean }
    expect(parsed.action).toBe('previous')
    expect(parsed.success).toBe(true)
  })
})

// ── volume() ──────────────────────────────────────────────────

describe('volume()', () => {
  it('sets volume via adapter', async () => {
    const result = await tool.execute({ action: 'volume', level: 75 })

    expect(adapter.setVolume).toHaveBeenCalledWith(75)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { level: number }
    expect(parsed.level).toBe(75)
  })

  it('clamps volume below 0 to VOLUME_MIN', async () => {
    const result = await tool.execute({ action: 'volume', level: -10 })

    expect(adapter.setVolume).toHaveBeenCalledWith(VOLUME_MIN)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { level: number }
    expect(parsed.level).toBe(VOLUME_MIN)
  })

  it('clamps volume above 100 to VOLUME_MAX', async () => {
    const result = await tool.execute({ action: 'volume', level: 150 })

    expect(adapter.setVolume).toHaveBeenCalledWith(VOLUME_MAX)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { level: number }
    expect(parsed.level).toBe(VOLUME_MAX)
  })

  it('rounds fractional volume to nearest integer', async () => {
    await tool.execute({ action: 'volume', level: 33.7 })

    expect(adapter.setVolume).toHaveBeenCalledWith(34)
  })

  it('rejects non-numeric level', async () => {
    await expect(
      tool.execute({ action: 'volume', level: 'loud' }),
    ).rejects.toThrow('numeric "level"')
  })

  it('rejects NaN level', async () => {
    await expect(
      tool.execute({ action: 'volume', level: NaN }),
    ).rejects.toThrow('numeric "level"')
  })
})

// ── mute() ────────────────────────────────────────────────────

describe('mute()', () => {
  it('mutes audio via adapter', async () => {
    const result = await tool.execute({ action: 'mute' })

    expect(adapter.mute).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; success: boolean }
    expect(parsed.action).toBe('mute')
    expect(parsed.success).toBe(true)
  })
})

// ── nowPlaying() ──────────────────────────────────────────────

describe('nowPlaying()', () => {
  it('returns now-playing info via adapter', async () => {
    const result = await tool.execute({ action: 'nowPlaying' })

    expect(adapter.getNowPlaying).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { nowPlaying: { title: string; artist: string; app: string } }
    expect(parsed.nowPlaying.title).toBe('Test Song')
    expect(parsed.nowPlaying.artist).toBe('Test Artist')
    expect(parsed.nowPlaying.app).toBe('Music')
  })

  it('handles null now-playing (nothing playing)', async () => {
    adapter.getNowPlaying.mockResolvedValue(null)

    const result = await tool.execute({ action: 'nowPlaying' })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { nowPlaying: null }
    expect(parsed.nowPlaying).toBeNull()
  })
})

// ── parseArgs() ───────────────────────────────────────────────

describe('parseArgs()', () => {
  it('parses playPause', () => {
    expect(parseArgs({ action: 'playPause' })).toEqual({ action: 'playPause' })
  })

  it('parses volume with clamping', () => {
    expect(parseArgs({ action: 'volume', level: 50 })).toEqual({
      action: 'volume',
      level: 50,
    })
  })

  it('rejects null', () => {
    expect(() => parseArgs(null)).toThrow('non-null object')
  })

  it('rejects non-object', () => {
    expect(() => parseArgs('string')).toThrow('non-null object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'shuffle' })).toThrow('Invalid action')
  })

  it('rejects volume without level', () => {
    expect(() => parseArgs({ action: 'volume' })).toThrow('numeric "level"')
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

  it('does not import fs', () => {
    expect(sourceCode).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(sourceCode).not.toMatch(/from\s+['"]fs['"]/)
  })
})
