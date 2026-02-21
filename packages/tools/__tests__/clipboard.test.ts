import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval } from './helpers'
import { createClipboardTool, parseArgs, MAX_WRITE_SIZE, type ClipboardAdapter } from '../src/clipboard'
import type { ExtendedAgentTool } from '../src/types'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/clipboard.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter(): ClipboardAdapter & {
  readText: ReturnType<typeof vi.fn>
  writeText: ReturnType<typeof vi.fn>
} {
  return {
    readText: vi.fn().mockResolvedValue('clipboard content'),
    writeText: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('clipboard tool', () => {
  let adapter: ReturnType<typeof createMockAdapter>
  let tool: ExtendedAgentTool

  beforeEach(() => {
    adapter = createMockAdapter()
    tool = createClipboardTool(adapter)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(tool.name).toBe('clipboard')
    })

    it('runs on desktop', () => {
      expect(tool.runsOn).toBe('desktop')
    })

    it('has clipboard permissions', () => {
      expect(tool.permissions).toContain('clipboard:read')
      expect(tool.permissions).toContain('clipboard:write')
    })

    it('requires confirmation (can read sensitive data)', () => {
      expect(tool.requiresConfirmation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // read()
  // -------------------------------------------------------------------------

  describe('read()', () => {
    it('reads clipboard text via adapter', async () => {
      const result = await tool.execute({ action: 'read' })

      expect(adapter.readText).toHaveBeenCalledOnce()
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'clipboard content',
      })
    })

    it('returns empty string when clipboard is empty', async () => {
      adapter.readText.mockResolvedValue('')

      const result = await tool.execute({ action: 'read' })

      expect(result.content[0]).toEqual({
        type: 'text',
        text: '',
      })
    })
  })

  // -------------------------------------------------------------------------
  // write()
  // -------------------------------------------------------------------------

  describe('write()', () => {
    it('writes text via adapter', async () => {
      const result = await tool.execute({ action: 'write', text: 'Hello World' })

      expect(adapter.writeText).toHaveBeenCalledOnce()
      expect(adapter.writeText).toHaveBeenCalledWith('Hello World')

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { written: boolean; length: number }

      expect(parsed.written).toBe(true)
      expect(parsed.length).toBe(11)
    })

    it('rejects text exceeding 1 MB', async () => {
      const largeText = 'X'.repeat(MAX_WRITE_SIZE + 1)

      await expect(
        tool.execute({ action: 'write', text: largeText }),
      ).rejects.toThrow('too large')
    })

    it('accepts text at exactly 1 MB', async () => {
      const text = 'X'.repeat(MAX_WRITE_SIZE)

      const result = await tool.execute({ action: 'write', text })

      expect(adapter.writeText).toHaveBeenCalledOnce()
      expect(result.content).toHaveLength(1)
    })

    it('allows empty string write', async () => {
      const result = await tool.execute({ action: 'write', text: '' })

      expect(adapter.writeText).toHaveBeenCalledWith('')
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { length: number }
      expect(parsed.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // parseArgs()
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('parses read action', () => {
      expect(parseArgs({ action: 'read' })).toEqual({ action: 'read' })
    })

    it('parses write action', () => {
      expect(parseArgs({ action: 'write', text: 'hello' })).toEqual({
        action: 'write',
        text: 'hello',
      })
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'delete' })).toThrow('action must be')
    })

    it('rejects null', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects non-object', () => {
      expect(() => parseArgs(42)).toThrow('Arguments must be an object')
    })

    it('rejects write without text', () => {
      expect(() => parseArgs({ action: 'write' })).toThrow('requires a "text" string')
    })

    it('rejects write with non-string text', () => {
      expect(() => parseArgs({ action: 'write', text: 123 })).toThrow('requires a "text" string')
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
