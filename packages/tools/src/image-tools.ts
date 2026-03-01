/**
 * Image Tools — resize, crop, convert, rotate, compress, and get info for images.
 * Uses sharp via dynamic import. Factory pattern with configurable allowed directories.
 *
 * Security:
 * - requiresConfirmation: true (writes files)
 * - Path validation against allowedDirectories (no traversal)
 * - 50 MB file size limit
 * - Only png/jpeg/webp (no SVG — script injection risk)
 * - EXIF stripped by default (sharp default without withMetadata)
 * - No eval, no network access
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Configuration ────────────────────────────────────────────

export interface ImageToolsConfig {
  readonly allowedDirectories: readonly string[]
}

// ── Constants ────────────────────────────────────────────────

/** Maximum image file size (50 MB). */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

export const ALLOWED_FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp'])

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'resize',
  'crop',
  'convert',
  'info',
  'rotate',
  'compress',
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

// ── File size check ──────────────────────────────────────────

async function assertFileSize(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${String(stat.size)} bytes). Maximum: ${String(MAX_FILE_SIZE)} bytes (50 MB)`,
    )
  }
}

// ── Dynamic import ───────────────────────────────────────────

interface SharpInstance {
  resize(width: number | null, height: number | null): SharpInstance
  extract(region: { left: number; top: number; width: number; height: number }): SharpInstance
  rotate(angle: number): SharpInstance
  toFormat(format: string, options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
  metadata(): Promise<{
    width?: number
    height?: number
    format?: string
    size?: number
    channels?: number
    hasAlpha?: boolean
  }>
}

type SharpConstructor = (input: Buffer) => SharpInstance

async function loadSharp(): Promise<SharpConstructor> {
  const moduleName = 'sharp'
  const mod = await (import(/* webpackIgnore: true */ moduleName) as Promise<{ default: SharpConstructor }>)
  return mod.default
}

// ── Argument Parsing ─────────────────────────────────────────

interface ResizeArgs {
  readonly action: 'resize'
  readonly inputPath: string
  readonly outputPath: string
  readonly width?: number
  readonly height?: number
}

interface CropArgs {
  readonly action: 'crop'
  readonly inputPath: string
  readonly outputPath: string
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface ConvertArgs {
  readonly action: 'convert'
  readonly inputPath: string
  readonly outputPath: string
  readonly format: string
}

interface InfoArgs {
  readonly action: 'info'
  readonly inputPath: string
}

interface RotateArgs {
  readonly action: 'rotate'
  readonly inputPath: string
  readonly outputPath: string
  readonly angle: number
}

interface CompressArgs {
  readonly action: 'compress'
  readonly inputPath: string
  readonly outputPath: string
  readonly quality: number
}

type ImageToolsArgs = ResizeArgs | CropArgs | ConvertArgs | InfoArgs | RotateArgs | CompressArgs

function assertPositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function assertNonNegativeInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return value
}

function parseArgs(args: unknown): ImageToolsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  switch (action) {
    case 'resize': {
      const inputPath = obj['inputPath']
      if (typeof inputPath !== 'string' || inputPath.trim() === '') {
        throw new Error('resize requires a non-empty "inputPath" string')
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('resize requires a non-empty "outputPath" string')
      }
      const width = obj['width'] !== undefined ? assertPositiveInt(obj['width'], 'width') : undefined
      const height = obj['height'] !== undefined ? assertPositiveInt(obj['height'], 'height') : undefined
      if (width === undefined && height === undefined) {
        throw new Error('resize requires at least one of "width" or "height"')
      }
      return {
        action: 'resize',
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        width,
        height,
      }
    }

    case 'crop': {
      const inputPath = obj['inputPath']
      if (typeof inputPath !== 'string' || inputPath.trim() === '') {
        throw new Error('crop requires a non-empty "inputPath" string')
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('crop requires a non-empty "outputPath" string')
      }
      return {
        action: 'crop',
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        left: assertNonNegativeInt(obj['left'], 'left'),
        top: assertNonNegativeInt(obj['top'], 'top'),
        width: assertPositiveInt(obj['width'], 'width'),
        height: assertPositiveInt(obj['height'], 'height'),
      }
    }

    case 'convert': {
      const inputPath = obj['inputPath']
      if (typeof inputPath !== 'string' || inputPath.trim() === '') {
        throw new Error('convert requires a non-empty "inputPath" string')
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('convert requires a non-empty "outputPath" string')
      }
      const format = obj['format']
      if (typeof format !== 'string' || !ALLOWED_FORMATS.has(format)) {
        throw new Error(`format must be one of: ${[...ALLOWED_FORMATS].join(', ')}`)
      }
      return {
        action: 'convert',
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        format,
      }
    }

    case 'info': {
      const inputPath = obj['inputPath']
      if (typeof inputPath !== 'string' || inputPath.trim() === '') {
        throw new Error('info requires a non-empty "inputPath" string')
      }
      return { action: 'info', inputPath: inputPath.trim() }
    }

    case 'rotate': {
      const inputPath = obj['inputPath']
      if (typeof inputPath !== 'string' || inputPath.trim() === '') {
        throw new Error('rotate requires a non-empty "inputPath" string')
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('rotate requires a non-empty "outputPath" string')
      }
      const angle = obj['angle']
      if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < 0 || angle > 360) {
        throw new Error('angle must be a number between 0 and 360')
      }
      return {
        action: 'rotate',
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        angle,
      }
    }

    case 'compress': {
      const inputPath = obj['inputPath']
      if (typeof inputPath !== 'string' || inputPath.trim() === '') {
        throw new Error('compress requires a non-empty "inputPath" string')
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('compress requires a non-empty "outputPath" string')
      }
      const quality = obj['quality']
      if (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 1 || quality > 100) {
        throw new Error('quality must be an integer between 1 and 100')
      }
      return {
        action: 'compress',
        inputPath: inputPath.trim(),
        outputPath: outputPath.trim(),
        quality,
      }
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
      description: 'Image operation: "resize", "crop", "convert", "info", "rotate", or "compress"',
      enum: ['resize', 'crop', 'convert', 'info', 'rotate', 'compress'],
    },
    inputPath: {
      type: 'string',
      description: 'Input image file path',
    },
    outputPath: {
      type: 'string',
      description: 'Output image file path (not needed for "info")',
    },
    width: {
      type: 'integer',
      description: 'Width in pixels (resize, crop)',
    },
    height: {
      type: 'integer',
      description: 'Height in pixels (resize, crop)',
    },
    left: {
      type: 'integer',
      description: 'Left offset for crop (0-based)',
    },
    top: {
      type: 'integer',
      description: 'Top offset for crop (0-based)',
    },
    format: {
      type: 'string',
      description: 'Output format: "png", "jpeg", or "webp" (for "convert")',
      enum: ['png', 'jpeg', 'webp'],
    },
    angle: {
      type: 'number',
      description: 'Rotation angle 0-360 degrees (for "rotate")',
    },
    quality: {
      type: 'integer',
      description: 'Compression quality 1-100 (for "compress")',
    },
  },
  required: ['action'],
}

// ── Factory ──────────────────────────────────────────────────

export function createImageToolsTool(config: ImageToolsConfig): ExtendedAgentTool {
  if (config.allowedDirectories.length === 0) {
    throw new Error('At least one allowed directory must be configured')
  }

  const allowedDirs: readonly string[] = config.allowedDirectories.map((d) =>
    path.resolve(d),
  )

  return {
    name: 'image-tools',
    description:
      'Process images. Actions: resize(inputPath, outputPath, width?, height?) resizes; ' +
      'crop(inputPath, outputPath, left, top, width, height) crops a region; ' +
      'convert(inputPath, outputPath, format) converts between png/jpeg/webp; ' +
      'info(inputPath) returns metadata; rotate(inputPath, outputPath, angle) rotates; ' +
      'compress(inputPath, outputPath, quality) compresses with quality 1-100. ' +
      'Requires user confirmation.',
    parameters: PARAMETERS,
    permissions: ['fs:read', 'fs:write'],
    requiresConfirmation: true,
    defaultRiskTier: 2,
    riskTiers: { info: 1, resize: 2, crop: 2, convert: 2, rotate: 2, compress: 2 },
    runsOn: 'server',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)
      const sharp = await loadSharp()

      switch (parsed.action) {
        case 'resize': {
          const safeInput = await validatePath(parsed.inputPath, allowedDirs)
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)
          await assertFileSize(safeInput)

          const buffer = await fs.readFile(safeInput)
          const result = await sharp(buffer)
            .resize(parsed.width ?? null, parsed.height ?? null)
            .toBuffer()

          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, result)

          return textResult(JSON.stringify({
            action: 'resize',
            inputPath: safeInput,
            outputPath: safeOutput,
            width: parsed.width,
            height: parsed.height,
          }))
        }

        case 'crop': {
          const safeInput = await validatePath(parsed.inputPath, allowedDirs)
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)
          await assertFileSize(safeInput)

          const buffer = await fs.readFile(safeInput)
          const result = await sharp(buffer)
            .extract({
              left: parsed.left,
              top: parsed.top,
              width: parsed.width,
              height: parsed.height,
            })
            .toBuffer()

          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, result)

          return textResult(JSON.stringify({
            action: 'crop',
            inputPath: safeInput,
            outputPath: safeOutput,
          }))
        }

        case 'convert': {
          const safeInput = await validatePath(parsed.inputPath, allowedDirs)
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)
          await assertFileSize(safeInput)

          const buffer = await fs.readFile(safeInput)
          const result = await sharp(buffer)
            .toFormat(parsed.format)
            .toBuffer()

          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, result)

          return textResult(JSON.stringify({
            action: 'convert',
            inputPath: safeInput,
            outputPath: safeOutput,
            format: parsed.format,
          }))
        }

        case 'info': {
          const safeInput = await validatePath(parsed.inputPath, allowedDirs)
          await assertFileSize(safeInput)

          const buffer = await fs.readFile(safeInput)
          const meta = await sharp(buffer).metadata()

          return textResult(JSON.stringify({
            width: meta.width,
            height: meta.height,
            format: meta.format,
            size: meta.size,
            channels: meta.channels,
            hasAlpha: meta.hasAlpha,
            path: safeInput,
          }))
        }

        case 'rotate': {
          const safeInput = await validatePath(parsed.inputPath, allowedDirs)
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)
          await assertFileSize(safeInput)

          const buffer = await fs.readFile(safeInput)
          const result = await sharp(buffer)
            .rotate(parsed.angle)
            .toBuffer()

          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, result)

          return textResult(JSON.stringify({
            action: 'rotate',
            inputPath: safeInput,
            outputPath: safeOutput,
            angle: parsed.angle,
          }))
        }

        case 'compress': {
          const safeInput = await validatePath(parsed.inputPath, allowedDirs)
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)
          await assertFileSize(safeInput)

          const buffer = await fs.readFile(safeInput)
          const meta = await sharp(buffer).metadata()
          const format = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg'

          const result = await sharp(buffer)
            .toFormat(format, { quality: parsed.quality })
            .toBuffer()

          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, result)

          return textResult(JSON.stringify({
            action: 'compress',
            inputPath: safeInput,
            outputPath: safeOutput,
            quality: parsed.quality,
            format,
          }))
        }
      }
    },
  }
}

export { parseArgs }
