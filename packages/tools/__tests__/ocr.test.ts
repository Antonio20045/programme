import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOcrTool,
  parseArgs,
  validateMagicBytes,
  MAX_INPUT_SIZE,
  OCR_TIMEOUT_MS,
} from '../src/ocr'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(currentDir, '../src/ocr.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock tesseract.js
// ---------------------------------------------------------------------------

const mockRecognize = vi.fn().mockResolvedValue({
  data: {
    text: 'Hello World',
    confidence: 95,
    blocks: [
      {
        text: 'Hello World',
        bbox: { x0: 10, y0: 20, x1: 200, y1: 50 },
        confidence: 95,
      },
    ],
  },
})

const mockTerminate = vi.fn().mockResolvedValue(undefined)

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockResolvedValue({
    recognize: mockRecognize,
    terminate: mockTerminate,
  }),
}))

// ---------------------------------------------------------------------------
// Helper: create valid image buffers with magic bytes
// ---------------------------------------------------------------------------

function createPngBuffer(size: number = 100): Buffer {
  const buf = Buffer.alloc(size)
  // PNG magic bytes
  buf[0] = 0x89
  buf[1] = 0x50
  buf[2] = 0x4e
  buf[3] = 0x47
  return buf
}

function createJpegBuffer(size: number = 100): Buffer {
  const buf = Buffer.alloc(size)
  // JPEG magic bytes
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  return buf
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let tool: ExtendedAgentTool

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-tool-'))
  tool = createOcrTool({ allowedDirectories: [tmpDir] })
  vi.clearAllMocks()
  // Re-setup after clearAllMocks
  mockRecognize.mockResolvedValue({
    data: {
      text: 'Hello World',
      confidence: 95,
      blocks: [
        {
          text: 'Hello World',
          bbox: { x0: 10, y0: 20, x1: 200, y1: 50 },
          confidence: 95,
        },
      ],
    },
  })
  mockTerminate.mockResolvedValue(undefined)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Metadata ──────────────────────────────────────────────────

describe('metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('ocr')
  })

  it('runs on server', () => {
    expect(tool.runsOn).toBe('server')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toEqual(['fs:read'])
  })

  it('does not require confirmation (read-only)', () => {
    expect(tool.requiresConfirmation).toBe(false)
  })

  it('requires at least one allowed directory', () => {
    expect(() =>
      createOcrTool({ allowedDirectories: [] }),
    ).toThrow('At least one allowed directory')
  })
})

// ── extract() ─────────────────────────────────────────────────

describe('extract()', () => {
  it('extracts text from file', async () => {
    const imgPath = path.join(tmpDir, 'test.png')
    await fs.writeFile(imgPath, createPngBuffer())

    const result = await tool.execute({ action: 'extract', inputPath: imgPath })

    expect(mockRecognize).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { text: string; confidence: number }
    expect(parsed.text).toBe('Hello World')
    expect(parsed.confidence).toBe(95)
  })

  it('extracts text from base64', async () => {
    const pngBuffer = createPngBuffer()
    const base64 = pngBuffer.toString('base64')

    const result = await tool.execute({ action: 'extract', base64 })

    expect(mockRecognize).toHaveBeenCalledOnce()
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { text: string }
    expect(parsed.text).toBe('Hello World')
  })
})

// ── regions() ─────────────────────────────────────────────────

describe('regions()', () => {
  it('returns text blocks with bounding boxes', async () => {
    const imgPath = path.join(tmpDir, 'test.png')
    await fs.writeFile(imgPath, createPngBuffer())

    const result = await tool.execute({ action: 'regions', inputPath: imgPath })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { regions: { text: string; bbox: { x0: number }; confidence: number }[] }
    expect(parsed.regions).toHaveLength(1)
    expect(parsed.regions[0]?.text).toBe('Hello World')
    expect(parsed.regions[0]?.bbox.x0).toBe(10)
    expect(parsed.regions[0]?.confidence).toBe(95)
  })

  it('handles no blocks (empty regions)', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: '', confidence: 0, blocks: [] },
    })
    const imgPath = path.join(tmpDir, 'blank.png')
    await fs.writeFile(imgPath, createPngBuffer())

    const result = await tool.execute({ action: 'regions', inputPath: imgPath })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { regions: unknown[] }
    expect(parsed.regions).toHaveLength(0)
  })
})

// ── parseArgs() ───────────────────────────────────────────────

describe('parseArgs()', () => {
  it('parses extract with file input', () => {
    const result = parseArgs({ action: 'extract', inputPath: '/img.png' })
    expect(result).toEqual({
      action: 'extract',
      inputPath: '/img.png',
      base64: undefined,
      inputType: 'file',
      language: 'eng',
    })
  })

  it('parses extract with base64 input', () => {
    const result = parseArgs({ action: 'extract', base64: 'AAAA' })
    expect(result).toEqual({
      action: 'extract',
      inputPath: undefined,
      base64: 'AAAA',
      inputType: 'base64',
      language: 'eng',
    })
  })

  it('parses custom language', () => {
    const result = parseArgs({ action: 'extract', inputPath: '/img.png', language: 'deu' })
    expect(result).toMatchObject({ language: 'deu' })
  })

  it('accepts language with underscore suffix', () => {
    const result = parseArgs({ action: 'extract', inputPath: '/img.png', language: 'chi_sim' })
    expect(result).toMatchObject({ language: 'chi_sim' })
  })

  it('rejects null', () => {
    expect(() => parseArgs(null)).toThrow('non-null object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'translate', inputPath: '/x' })).toThrow('Invalid action')
  })

  it('rejects missing input', () => {
    expect(() => parseArgs({ action: 'extract' })).toThrow('Either "inputPath" or "base64"')
  })

  it('rejects invalid language pattern', () => {
    expect(() => parseArgs({
      action: 'extract',
      inputPath: '/x',
      language: 'INVALID',
    })).toThrow('language must match')
  })

  it('rejects language with injection attempt', () => {
    expect(() => parseArgs({
      action: 'extract',
      inputPath: '/x',
      language: 'eng; rm -rf /',
    })).toThrow('language must match')
  })
})

// ── Magic Bytes ───────────────────────────────────────────────

describe('magic bytes validation', () => {
  it('accepts JPEG', () => {
    expect(() => validateMagicBytes(createJpegBuffer())).not.toThrow()
  })

  it('accepts PNG', () => {
    expect(() => validateMagicBytes(createPngBuffer())).not.toThrow()
  })

  it('accepts WebP (RIFF)', () => {
    const buf = Buffer.alloc(20)
    buf[0] = 0x52 // R
    buf[1] = 0x49 // I
    buf[2] = 0x46 // F
    buf[3] = 0x46 // F
    expect(() => validateMagicBytes(buf)).not.toThrow()
  })

  it('accepts TIFF little-endian', () => {
    const buf = Buffer.alloc(10)
    buf[0] = 0x49
    buf[1] = 0x49
    buf[2] = 0x2a
    buf[3] = 0x00
    expect(() => validateMagicBytes(buf)).not.toThrow()
  })

  it('accepts BMP', () => {
    const buf = Buffer.alloc(10)
    buf[0] = 0x42 // B
    buf[1] = 0x4d // M
    expect(() => validateMagicBytes(buf)).not.toThrow()
  })

  it('rejects unknown format', () => {
    const buf = Buffer.alloc(10)
    buf[0] = 0x00
    buf[1] = 0x00
    expect(() => validateMagicBytes(buf)).toThrow('Unsupported image format')
  })

  it('rejects empty buffer', () => {
    expect(() => validateMagicBytes(Buffer.alloc(0))).toThrow('Unsupported image format')
  })
})

// ── Size Limit ────────────────────────────────────────────────

describe('size limit', () => {
  it('rejects file larger than 10 MB', async () => {
    const largePath = path.join(tmpDir, 'huge.png')
    // Write PNG magic bytes first, then truncate to over 10MB
    await fs.writeFile(largePath, createPngBuffer())
    const fd = await fs.open(largePath, 'r+')
    await fd.truncate(MAX_INPUT_SIZE + 1)
    await fd.close()

    await expect(
      tool.execute({ action: 'extract', inputPath: largePath }),
    ).rejects.toThrow('too large')
  })

  it('rejects base64 input exceeding 10 MB decoded', async () => {
    // Create a base64 string that decodes to >10MB with valid PNG magic bytes
    const pngHeader = createPngBuffer(4)
    const largeBuffer = Buffer.concat([pngHeader, Buffer.alloc(MAX_INPUT_SIZE)])
    const base64 = largeBuffer.toString('base64')

    await expect(
      tool.execute({ action: 'extract', base64 }),
    ).rejects.toThrow('too large')
  })
})

// ── Path Traversal ────────────────────────────────────────────

describe('path traversal protection', () => {
  it('blocks path outside allowed directories', async () => {
    await expect(
      tool.execute({ action: 'extract', inputPath: '/etc/passwd' }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks ../../ traversal', async () => {
    await expect(
      tool.execute({
        action: 'extract',
        inputPath: path.join(tmpDir, '..', '..', 'etc', 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks symlink pointing outside', async () => {
    const linkPath = path.join(tmpDir, 'evil-link')
    await fs.symlink('/etc', linkPath)

    await expect(
      tool.execute({
        action: 'extract',
        inputPath: path.join(linkPath, 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks null bytes', async () => {
    await expect(
      tool.execute({
        action: 'extract',
        inputPath: path.join(tmpDir, 'file\0.png'),
      }),
    ).rejects.toThrow('null bytes')
  })
})

// ── Timeout ───────────────────────────────────────────────────

describe('timeout', () => {
  it('has OCR_TIMEOUT_MS set to 30 seconds', () => {
    expect(OCR_TIMEOUT_MS).toBe(30_000)
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
    expect(sourceCode).not.toMatch(/from\s+['"]child_process['"]/)
    expect(sourceCode).not.toMatch(/from\s+['"]node:child_process['"]/)
  })

  it('does not contain console.log in source', () => {
    // Worker logger is explicitly disabled
    expect(sourceCode).not.toMatch(/console\.log\s*\(/)
    expect(sourceCode).not.toMatch(/console\.info\s*\(/)
    expect(sourceCode).not.toMatch(/console\.debug\s*\(/)
  })
})
