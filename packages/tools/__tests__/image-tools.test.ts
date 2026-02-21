import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImageToolsTool,
  parseArgs,
  MAX_FILE_SIZE,
  ALLOWED_FORMATS,
} from '../src/image-tools'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(currentDir, '../src/image-tools.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock sharp
// ---------------------------------------------------------------------------

const mockMetadata = vi.fn().mockResolvedValue({
  width: 800,
  height: 600,
  format: 'png',
  size: 12345,
  channels: 4,
  hasAlpha: true,
})

const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]))

const mockSharpInstance = {
  resize: vi.fn().mockReturnThis(),
  extract: vi.fn().mockReturnThis(),
  rotate: vi.fn().mockReturnThis(),
  toFormat: vi.fn().mockReturnThis(),
  toBuffer: mockToBuffer,
  metadata: mockMetadata,
}

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue(mockSharpInstance),
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let tool: ExtendedAgentTool

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-tool-'))
  tool = createImageToolsTool({ allowedDirectories: [tmpDir] })
  vi.clearAllMocks()
  // Re-setup return values after clearAllMocks
  mockSharpInstance.resize.mockReturnThis()
  mockSharpInstance.extract.mockReturnThis()
  mockSharpInstance.rotate.mockReturnThis()
  mockSharpInstance.toFormat.mockReturnThis()
  mockToBuffer.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  mockMetadata.mockResolvedValue({
    width: 800,
    height: 600,
    format: 'png',
    size: 12345,
    channels: 4,
    hasAlpha: true,
  })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Metadata ──────────────────────────────────────────────────

describe('metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('image-tools')
  })

  it('runs on server', () => {
    expect(tool.runsOn).toBe('server')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toEqual(['fs:read', 'fs:write'])
  })

  it('requires confirmation', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })

  it('requires at least one allowed directory', () => {
    expect(() =>
      createImageToolsTool({ allowedDirectories: [] }),
    ).toThrow('At least one allowed directory')
  })
})

// ── resize() ──────────────────────────────────────────────────

describe('resize()', () => {
  it('resizes an image', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    const outputPath = path.join(tmpDir, 'output.png')
    await fs.writeFile(inputPath, 'fake image data')

    const result = await tool.execute({
      action: 'resize',
      inputPath,
      outputPath,
      width: 400,
      height: 300,
    })

    expect(mockSharpInstance.resize).toHaveBeenCalledWith(400, 300)
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { action: string; width: number; height: number }
    expect(parsed.action).toBe('resize')
    expect(parsed.width).toBe(400)

    // Output file should exist
    const exists = await fs.access(outputPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('allows width-only resize', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    const outputPath = path.join(tmpDir, 'output.png')
    await fs.writeFile(inputPath, 'fake')

    await tool.execute({ action: 'resize', inputPath, outputPath, width: 200 })

    expect(mockSharpInstance.resize).toHaveBeenCalledWith(200, null)
  })
})

// ── crop() ────────────────────────────────────────────────────

describe('crop()', () => {
  it('crops an image region', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    const outputPath = path.join(tmpDir, 'cropped.png')
    await fs.writeFile(inputPath, 'fake')

    await tool.execute({
      action: 'crop',
      inputPath,
      outputPath,
      left: 10,
      top: 20,
      width: 100,
      height: 50,
    })

    expect(mockSharpInstance.extract).toHaveBeenCalledWith({
      left: 10,
      top: 20,
      width: 100,
      height: 50,
    })
  })
})

// ── convert() ─────────────────────────────────────────────────

describe('convert()', () => {
  it('converts to jpeg', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    const outputPath = path.join(tmpDir, 'output.jpg')
    await fs.writeFile(inputPath, 'fake')

    await tool.execute({
      action: 'convert',
      inputPath,
      outputPath,
      format: 'jpeg',
    })

    expect(mockSharpInstance.toFormat).toHaveBeenCalledWith('jpeg')
  })

  it('rejects SVG format', async () => {
    await expect(
      tool.execute({
        action: 'convert',
        inputPath: path.join(tmpDir, 'x.png'),
        outputPath: path.join(tmpDir, 'x.svg'),
        format: 'svg',
      }),
    ).rejects.toThrow('format must be one of')
  })
})

// ── info() ────────────────────────────────────────────────────

describe('info()', () => {
  it('returns image metadata', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    await fs.writeFile(inputPath, 'fake')

    const result = await tool.execute({ action: 'info', inputPath })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { width: number; height: number; format: string }
    expect(parsed.width).toBe(800)
    expect(parsed.height).toBe(600)
    expect(parsed.format).toBe('png')
  })
})

// ── rotate() ──────────────────────────────────────────────────

describe('rotate()', () => {
  it('rotates an image', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    const outputPath = path.join(tmpDir, 'rotated.png')
    await fs.writeFile(inputPath, 'fake')

    await tool.execute({ action: 'rotate', inputPath, outputPath, angle: 90 })

    expect(mockSharpInstance.rotate).toHaveBeenCalledWith(90)
  })

  it('rejects angle > 360', async () => {
    await expect(
      tool.execute({
        action: 'rotate',
        inputPath: path.join(tmpDir, 'x.png'),
        outputPath: path.join(tmpDir, 'y.png'),
        angle: 400,
      }),
    ).rejects.toThrow('between 0 and 360')
  })

  it('rejects negative angle', async () => {
    await expect(
      tool.execute({
        action: 'rotate',
        inputPath: path.join(tmpDir, 'x.png'),
        outputPath: path.join(tmpDir, 'y.png'),
        angle: -10,
      }),
    ).rejects.toThrow('between 0 and 360')
  })
})

// ── compress() ────────────────────────────────────────────────

describe('compress()', () => {
  it('compresses with quality', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    const outputPath = path.join(tmpDir, 'compressed.png')
    await fs.writeFile(inputPath, 'fake')

    await tool.execute({ action: 'compress', inputPath, outputPath, quality: 80 })

    expect(mockSharpInstance.toFormat).toHaveBeenCalledWith('png', { quality: 80 })
  })

  it('rejects quality < 1', async () => {
    await expect(
      tool.execute({
        action: 'compress',
        inputPath: path.join(tmpDir, 'x.png'),
        outputPath: path.join(tmpDir, 'y.png'),
        quality: 0,
      }),
    ).rejects.toThrow('between 1 and 100')
  })

  it('rejects quality > 100', async () => {
    await expect(
      tool.execute({
        action: 'compress',
        inputPath: path.join(tmpDir, 'x.png'),
        outputPath: path.join(tmpDir, 'y.png'),
        quality: 101,
      }),
    ).rejects.toThrow('between 1 and 100')
  })
})

// ── parseArgs() ───────────────────────────────────────────────

describe('parseArgs()', () => {
  it('parses resize', () => {
    const result = parseArgs({
      action: 'resize',
      inputPath: '/img.png',
      outputPath: '/out.png',
      width: 100,
    })
    expect(result).toEqual({
      action: 'resize',
      inputPath: '/img.png',
      outputPath: '/out.png',
      width: 100,
      height: undefined,
    })
  })

  it('rejects null', () => {
    expect(() => parseArgs(null)).toThrow('non-null object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'blur' })).toThrow('Invalid action')
  })

  it('rejects resize without dimensions', () => {
    expect(() => parseArgs({
      action: 'resize',
      inputPath: '/a.png',
      outputPath: '/b.png',
    })).toThrow('at least one of')
  })

  it('rejects resize with non-integer width', () => {
    expect(() => parseArgs({
      action: 'resize',
      inputPath: '/a.png',
      outputPath: '/b.png',
      width: 1.5,
    })).toThrow('positive integer')
  })

  it('rejects crop with negative left', () => {
    expect(() => parseArgs({
      action: 'crop',
      inputPath: '/a.png',
      outputPath: '/b.png',
      left: -1,
      top: 0,
      width: 10,
      height: 10,
    })).toThrow('non-negative integer')
  })
})

// ── Path Traversal ────────────────────────────────────────────

describe('path traversal protection', () => {
  it('blocks input path outside allowed dirs', async () => {
    await expect(
      tool.execute({
        action: 'info',
        inputPath: '/etc/passwd',
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks output path traversal', async () => {
    const inputPath = path.join(tmpDir, 'input.png')
    await fs.writeFile(inputPath, 'fake')

    await expect(
      tool.execute({
        action: 'resize',
        inputPath,
        outputPath: '/tmp/evil.png',
        width: 100,
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks symlink pointing outside', async () => {
    const linkPath = path.join(tmpDir, 'evil-link')
    await fs.symlink('/etc', linkPath)

    await expect(
      tool.execute({
        action: 'info',
        inputPath: path.join(linkPath, 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks null bytes', async () => {
    await expect(
      tool.execute({
        action: 'info',
        inputPath: path.join(tmpDir, 'file\0.png'),
      }),
    ).rejects.toThrow('null bytes')
  })
})

// ── File Size Limit ──────────────────────────────────────────

describe('file size limit', () => {
  it('rejects files larger than 50 MB', async () => {
    const largePath = path.join(tmpDir, 'huge.png')
    const fd = await fs.open(largePath, 'w')
    await fd.truncate(MAX_FILE_SIZE + 1)
    await fd.close()

    await expect(
      tool.execute({ action: 'info', inputPath: largePath }),
    ).rejects.toThrow('too large')
  })
})

// ── ALLOWED_FORMATS ──────────────────────────────────────────

describe('ALLOWED_FORMATS', () => {
  it('contains png, jpeg, webp', () => {
    expect(ALLOWED_FORMATS.has('png')).toBe(true)
    expect(ALLOWED_FORMATS.has('jpeg')).toBe(true)
    expect(ALLOWED_FORMATS.has('webp')).toBe(true)
  })

  it('does not contain svg', () => {
    expect(ALLOWED_FORMATS.has('svg')).toBe(false)
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
})
