/**
 * OCR tool — extract text from images using Tesseract.js.
 * Uses tesseract.js via dynamic import with worker caching.
 * Factory pattern with configurable allowed directories.
 *
 * Security:
 * - requiresConfirmation: false (read-only text extraction)
 * - Path validation against allowedDirectories (no traversal)
 * - Magic-bytes validation (only JPEG, PNG, WebP, TIFF, BMP)
 * - 10 MB input size limit
 * - 30 second timeout per OCR operation
 * - Worker logger disabled (no console.log)
 * - No eval, no network access (worker runs locally)
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Configuration ────────────────────────────────────────────

export interface OcrToolConfig {
  readonly allowedDirectories: readonly string[]
}

// ── Constants ────────────────────────────────────────────────

/** Maximum input size (10 MB). */
export const MAX_INPUT_SIZE = 10 * 1024 * 1024

/** OCR timeout in milliseconds. */
export const OCR_TIMEOUT_MS = 30_000

/** Language code pattern: 3 lowercase letters, optional underscore+suffix. */
const LANG_PATTERN = /^[a-z]{3}(_[a-z]+)?$/

/** Magic bytes for supported image formats. */
const MAGIC_BYTES: readonly { readonly name: string; readonly bytes: readonly number[] }[] = [
  { name: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
  { name: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'WebP', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
  { name: 'TIFF-LE', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'TIFF-BE', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { name: 'BMP', bytes: [0x42, 0x4d] },
]

const VALID_ACTIONS: ReadonlySet<string> = new Set(['extract', 'regions'])

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

// ── Magic Bytes Validation ───────────────────────────────────

function validateMagicBytes(buffer: Buffer): void {
  for (const { bytes } of MAGIC_BYTES) {
    if (bytes.every((b, i) => buffer[i] === b)) {
      return
    }
  }
  throw new Error('Unsupported image format (invalid magic bytes). Supported: JPEG, PNG, WebP, TIFF, BMP')
}

// ── Dynamic import + Worker cache ────────────────────────────

interface TesseractWorker {
  recognize(image: Buffer | string): Promise<{
    data: {
      text: string
      confidence: number
      blocks?: readonly {
        text: string
        bbox: { x0: number; y0: number; x1: number; y1: number }
        confidence: number
      }[]
    }
  }>
  terminate(): Promise<void>
}

type CreateWorkerFn = (lang: string, loggerOverride?: number, options?: {
  logger: () => undefined
}) => Promise<TesseractWorker>

let cachedWorker: TesseractWorker | null = null
let cachedLang: string | null = null

async function getWorker(lang: string): Promise<TesseractWorker> {
  if (cachedWorker && cachedLang === lang) {
    return cachedWorker
  }

  // Terminate old worker if language changed
  if (cachedWorker) {
    await cachedWorker.terminate()
    cachedWorker = null
    cachedLang = null
  }

  const moduleName = 'tesseract.js'
  const mod = await (import(/* webpackIgnore: true */ moduleName) as Promise<{ createWorker: CreateWorkerFn }>)
  const worker = await mod.createWorker(lang, 1, { logger: () => undefined })
  cachedWorker = worker
  cachedLang = lang
  return worker
}

// ── Argument Parsing ─────────────────────────────────────────

interface ExtractArgs {
  readonly action: 'extract'
  readonly inputPath?: string
  readonly base64?: string
  readonly inputType: 'file' | 'base64'
  readonly language: string
}

interface RegionsArgs {
  readonly action: 'regions'
  readonly inputPath?: string
  readonly base64?: string
  readonly inputType: 'file' | 'base64'
  readonly language: string
}

type OcrArgs = ExtractArgs | RegionsArgs

function parseArgs(args: unknown): OcrArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  // Determine input type
  const inputPath = obj['inputPath']
  const base64 = obj['base64']

  let inputType: 'file' | 'base64'
  if (typeof inputPath === 'string' && inputPath.trim() !== '') {
    inputType = 'file'
  } else if (typeof base64 === 'string' && base64.trim() !== '') {
    inputType = 'base64'
  } else {
    throw new Error('Either "inputPath" or "base64" must be provided as a non-empty string')
  }

  // Validate language
  let language = 'eng'
  if (obj['language'] !== undefined) {
    if (typeof obj['language'] !== 'string' || !LANG_PATTERN.test(obj['language'])) {
      throw new Error('language must match pattern: 3 lowercase letters, optional _suffix (e.g. "eng", "deu", "chi_sim")')
    }
    language = obj['language']
  }

  if (action === 'extract') {
    return {
      action: 'extract',
      inputPath: inputType === 'file' ? (inputPath as string).trim() : undefined,
      base64: inputType === 'base64' ? (base64 as string).trim() : undefined,
      inputType,
      language,
    }
  }

  return {
    action: 'regions',
    inputPath: inputType === 'file' ? (inputPath as string).trim() : undefined,
    base64: inputType === 'base64' ? (base64 as string).trim() : undefined,
    inputType,
    language,
  }
}

// ── Helpers ──────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`OCR operation timed out after ${String(ms)}ms`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer!)
  }
}

// ── Tool Definition ──────────────────────────────────────────

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'OCR operation: "extract" for full text, "regions" for text with bounding boxes',
      enum: ['extract', 'regions'],
    },
    inputPath: {
      type: 'string',
      description: 'Image file path (use this or base64)',
    },
    base64: {
      type: 'string',
      description: 'Base64-encoded image data (use this or inputPath)',
    },
    language: {
      type: 'string',
      description: 'OCR language code (default "eng"). Examples: "deu", "fra", "chi_sim"',
    },
  },
  required: ['action'],
}

// ── Factory ──────────────────────────────────────────────────

export function createOcrTool(config: OcrToolConfig): ExtendedAgentTool {
  if (config.allowedDirectories.length === 0) {
    throw new Error('At least one allowed directory must be configured')
  }

  const allowedDirs: readonly string[] = config.allowedDirectories.map((d) =>
    path.resolve(d),
  )

  return {
    name: 'ocr',
    description:
      'Extract text from images using OCR. Actions: extract(inputPath|base64, language?) ' +
      'returns full text with confidence; regions(inputPath|base64, language?) returns text ' +
      'blocks with bounding boxes. Supports JPEG, PNG, WebP, TIFF, BMP. Default language: eng.',
    parameters: PARAMETERS,
    permissions: ['fs:read'],
    requiresConfirmation: false,
    defaultRiskTier: 1,
    runsOn: 'server',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      // Get image buffer
      let imageBuffer: Buffer
      if (parsed.inputType === 'file') {
        const safePath = await validatePath(parsed.inputPath!, allowedDirs)
        const stat = await fs.stat(safePath)
        if (stat.size > MAX_INPUT_SIZE) {
          throw new Error(
            `File too large (${String(stat.size)} bytes). Maximum: ${String(MAX_INPUT_SIZE)} bytes (10 MB)`,
          )
        }
        imageBuffer = await fs.readFile(safePath)
      } else {
        imageBuffer = Buffer.from(parsed.base64!, 'base64')
        if (imageBuffer.length > MAX_INPUT_SIZE) {
          throw new Error(
            `Input too large (${String(imageBuffer.length)} bytes). Maximum: ${String(MAX_INPUT_SIZE)} bytes (10 MB)`,
          )
        }
      }

      // Validate magic bytes
      validateMagicBytes(imageBuffer)

      // Get or create worker
      const worker = await getWorker(parsed.language)

      switch (parsed.action) {
        case 'extract': {
          const result = await withTimeout(worker.recognize(imageBuffer), OCR_TIMEOUT_MS)
          return textResult(JSON.stringify({
            text: result.data.text,
            confidence: result.data.confidence,
          }))
        }

        case 'regions': {
          const result = await withTimeout(worker.recognize(imageBuffer), OCR_TIMEOUT_MS)
          const regions = (result.data.blocks ?? []).map((block) => ({
            text: block.text,
            bbox: block.bbox,
            confidence: block.confidence,
          }))
          return textResult(JSON.stringify({ regions }))
        }
      }
    },
  }
}

export { parseArgs, validateMagicBytes }
