import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval } from './helpers'
import { createScreenshotTool, parseArgs, MAX_WIDTH, type ScreenshotAdapter, type ScreenshotResult } from '../src/screenshot'
import type { ExtendedAgentTool } from '../src/types'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/screenshot.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

const MOCK_SCREENSHOT: ScreenshotResult = {
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk',
  mimeType: 'image/png',
  width: 1920,
  height: 1080,
}

function createMockAdapter(): ScreenshotAdapter & {
  captureScreen: ReturnType<typeof vi.fn>
  captureWindow: ReturnType<typeof vi.fn>
} {
  return {
    captureScreen: vi.fn().mockResolvedValue(MOCK_SCREENSHOT),
    captureWindow: vi.fn().mockResolvedValue(MOCK_SCREENSHOT),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('screenshot tool', () => {
  let adapter: ReturnType<typeof createMockAdapter>
  let tool: ExtendedAgentTool

  beforeEach(() => {
    adapter = createMockAdapter()
    tool = createScreenshotTool(adapter)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(tool.name).toBe('screenshot')
    })

    it('runs on desktop', () => {
      expect(tool.runsOn).toBe('desktop')
    })

    it('has screen:capture permission', () => {
      expect(tool.permissions).toContain('screen:capture')
    })

    it('requires confirmation (screenshots can show sensitive content)', () => {
      expect(tool.requiresConfirmation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // captureScreen()
  // -------------------------------------------------------------------------

  describe('captureScreen()', () => {
    it('returns ImageContent from adapter', async () => {
      const result = await tool.execute({ action: 'captureScreen' })

      expect(adapter.captureScreen).toHaveBeenCalledOnce()
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: 'image',
        data: MOCK_SCREENSHOT.data,
        mimeType: 'image/png',
      })
    })
  })

  // -------------------------------------------------------------------------
  // captureWindow()
  // -------------------------------------------------------------------------

  describe('captureWindow()', () => {
    it('captures window without title (focused window)', async () => {
      const result = await tool.execute({ action: 'captureWindow' })

      expect(adapter.captureWindow).toHaveBeenCalledOnce()
      expect(adapter.captureWindow).toHaveBeenCalledWith(undefined)
      expect(result.content[0]).toEqual({
        type: 'image',
        data: MOCK_SCREENSHOT.data,
        mimeType: 'image/png',
      })
    })

    it('captures window with specific title', async () => {
      const result = await tool.execute({
        action: 'captureWindow',
        windowTitle: 'Visual Studio Code',
      })

      expect(adapter.captureWindow).toHaveBeenCalledWith('Visual Studio Code')
      expect(result.content[0]).toEqual({
        type: 'image',
        data: MOCK_SCREENSHOT.data,
        mimeType: 'image/png',
      })
    })
  })

  // -------------------------------------------------------------------------
  // parseArgs()
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('parses captureScreen action', () => {
      expect(parseArgs({ action: 'captureScreen' })).toEqual({ action: 'captureScreen' })
    })

    it('parses captureWindow without title', () => {
      expect(parseArgs({ action: 'captureWindow' })).toEqual({
        action: 'captureWindow',
        windowTitle: undefined,
      })
    })

    it('parses captureWindow with title', () => {
      expect(parseArgs({ action: 'captureWindow', windowTitle: 'Chrome' })).toEqual({
        action: 'captureWindow',
        windowTitle: 'Chrome',
      })
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'delete' })).toThrow('action must be')
    })

    it('rejects null', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects non-object', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })

    it('rejects non-string windowTitle', () => {
      expect(() => parseArgs({ action: 'captureWindow', windowTitle: 123 })).toThrow('windowTitle must be a string')
    })
  })

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  describe('constants', () => {
    it('exports MAX_WIDTH as 1920', () => {
      expect(MAX_WIDTH).toBe(1920)
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('does not use fetch (no network access needed)', () => {
      const fetchPattern = /\bfetch\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })
  })
})
