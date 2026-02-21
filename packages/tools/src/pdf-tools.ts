/**
 * PDF Tools — extract text, merge, split, and count pages in PDF files.
 * Uses pdf-lib (merge/split/pageCount) and pdf-parse (extractText) via dynamic import.
 * Factory pattern with configurable allowed directories (same as filesystem.ts).
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Configuration ──────────────────────────────────────────────

export interface PdfToolsConfig {
  readonly allowedDirectories: readonly string[]
}

/** Maximum PDF file size (50 MB). */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** Actions that write files and require user confirmation. */
export const ACTIONS_REQUIRING_CONFIRMATION: ReadonlySet<string> = new Set([
  'merge',
  'split',
])

// ── Path Validation (copied from filesystem.ts — not exported there) ──

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

// ── Dynamic imports ────────────────────────────────────────────

interface PdfLibModule {
  PDFDocument: {
    load(bytes: Uint8Array | ArrayBuffer): Promise<PdfLibDocument>
    create(): Promise<PdfLibDocument>
  }
}

interface PdfLibDocument {
  getPageCount(): number
  copyPages(src: PdfLibDocument, indices: number[]): Promise<PdfLibPage[]>
  addPage(page: PdfLibPage): void
  save(): Promise<Uint8Array>
}

type PdfLibPage = unknown

interface PdfParseResult {
  text: string
  numpages: number
}

type PdfParseFunction = (buffer: Buffer) => Promise<PdfParseResult>

async function loadPdfLib(): Promise<PdfLibModule> {
  const moduleName = 'pdf-lib'
  return import(/* webpackIgnore: true */ moduleName) as Promise<PdfLibModule>
}

async function loadPdfParse(): Promise<PdfParseFunction> {
  const moduleName = 'pdf-parse'
  const mod = await (import(/* webpackIgnore: true */ moduleName) as Promise<{ default: PdfParseFunction }>)
  return mod.default
}

// ── File size check ────────────────────────────────────────────

async function assertFileSize(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${String(stat.size)} bytes). Maximum: ${String(MAX_FILE_SIZE)} bytes (50 MB)`,
    )
  }
}

// ── Argument parsing ───────────────────────────────────────────

interface ExtractTextArgs {
  readonly action: 'extractText'
  readonly path: string
}

interface MergeArgs {
  readonly action: 'merge'
  readonly paths: readonly string[]
  readonly outputPath: string
}

interface SplitArgs {
  readonly action: 'split'
  readonly path: string
  readonly pages: readonly number[]
  readonly outputPath: string
}

interface PageCountArgs {
  readonly action: 'pageCount'
  readonly path: string
}

type PdfToolsArgs = ExtractTextArgs | MergeArgs | SplitArgs | PageCountArgs

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'extractText',
  'merge',
  'split',
  'pageCount',
])

function parseArgs(args: unknown): PdfToolsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  switch (action) {
    case 'extractText': {
      const p = obj['path']
      if (typeof p !== 'string' || p.trim() === '') {
        throw new Error('extractText requires a non-empty "path" string')
      }
      return { action: 'extractText', path: p.trim() }
    }

    case 'merge': {
      const paths = obj['paths']
      if (!Array.isArray(paths) || paths.length < 2) {
        throw new Error('merge requires "paths" array with at least 2 files')
      }
      for (const p of paths) {
        if (typeof p !== 'string' || (p as string).trim() === '') {
          throw new Error('merge: each path must be a non-empty string')
        }
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('merge requires a non-empty "outputPath" string')
      }
      return {
        action: 'merge',
        paths: (paths as string[]).map((p) => p.trim()),
        outputPath: outputPath.trim(),
      }
    }

    case 'split': {
      const p = obj['path']
      if (typeof p !== 'string' || p.trim() === '') {
        throw new Error('split requires a non-empty "path" string')
      }
      const pages = obj['pages']
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error('split requires a non-empty "pages" array of page numbers (1-based)')
      }
      for (const pg of pages) {
        if (typeof pg !== 'number' || !Number.isInteger(pg) || pg < 1) {
          throw new Error('split: each page must be a positive integer (1-based)')
        }
      }
      const outputPath = obj['outputPath']
      if (typeof outputPath !== 'string' || outputPath.trim() === '') {
        throw new Error('split requires a non-empty "outputPath" string')
      }
      return {
        action: 'split',
        path: p.trim(),
        pages: pages as number[],
        outputPath: outputPath.trim(),
      }
    }

    case 'pageCount': {
      const p = obj['path']
      if (typeof p !== 'string' || p.trim() === '') {
        throw new Error('pageCount requires a non-empty "path" string')
      }
      return { action: 'pageCount', path: p.trim() }
    }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

// ── Helpers ────────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ── Tool Definition ────────────────────────────────────────────

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'PDF operation: "extractText", "merge", "split", or "pageCount"',
      enum: ['extractText', 'merge', 'split', 'pageCount'],
    },
    path: {
      type: 'string',
      description: 'PDF file path (extractText, split, pageCount)',
    },
    paths: {
      type: 'array',
      description: 'PDF file paths to merge (merge, at least 2)',
      items: { type: 'string' },
    },
    pages: {
      type: 'array',
      description: 'Page numbers to extract (split, 1-based)',
      items: { type: 'integer' },
    },
    outputPath: {
      type: 'string',
      description: 'Output file path (merge, split)',
    },
  },
  required: ['action'],
}

// ── Factory ────────────────────────────────────────────────────

export function createPdfTool(config: PdfToolsConfig): ExtendedAgentTool {
  if (config.allowedDirectories.length === 0) {
    throw new Error('At least one allowed directory must be configured')
  }

  const allowedDirs: readonly string[] = config.allowedDirectories.map((d) =>
    path.resolve(d),
  )

  return {
    name: 'pdf-tools',
    description:
      'Work with PDF files. Actions: extractText(path) extracts text content; ' +
      'merge(paths, outputPath) combines multiple PDFs; split(path, pages, outputPath) ' +
      'extracts specific pages; pageCount(path) returns the number of pages. ' +
      'merge and split require user confirmation.',
    parameters: PARAMETERS,
    permissions: ['fs:read', 'fs:write'],
    requiresConfirmation: true,
    runsOn: 'desktop',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'extractText': {
          const safe = await validatePath(parsed.path, allowedDirs)
          await assertFileSize(safe)
          const pdfParse = await loadPdfParse()
          const buffer = await fs.readFile(safe)
          const data = await pdfParse(buffer)
          return textResult(JSON.stringify({
            text: data.text,
            pages: data.numpages,
            path: safe,
          }))
        }

        case 'merge': {
          // Validate all input paths and output path
          const safePaths: string[] = []
          for (const p of parsed.paths) {
            const safe = await validatePath(p, allowedDirs)
            await assertFileSize(safe)
            safePaths.push(safe)
          }
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)

          const { PDFDocument } = await loadPdfLib()
          const merged = await PDFDocument.create()

          for (const safePath of safePaths) {
            const bytes = await fs.readFile(safePath)
            const src = await PDFDocument.load(bytes)
            const pageCount = src.getPageCount()
            const indices = Array.from({ length: pageCount }, (_, i) => i)
            const copiedPages = await merged.copyPages(src, indices)
            for (const page of copiedPages) {
              merged.addPage(page)
            }
          }

          const mergedBytes = await merged.save()
          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, mergedBytes)

          return textResult(JSON.stringify({
            merged: true,
            inputFiles: safePaths.length,
            totalPages: merged.getPageCount(),
            outputPath: safeOutput,
          }))
        }

        case 'split': {
          const safe = await validatePath(parsed.path, allowedDirs)
          await assertFileSize(safe)
          const safeOutput = await validatePath(parsed.outputPath, allowedDirs)

          const { PDFDocument } = await loadPdfLib()
          const bytes = await fs.readFile(safe)
          const src = await PDFDocument.load(bytes)
          const totalPages = src.getPageCount()

          // Validate page numbers
          for (const pg of parsed.pages) {
            if (pg > totalPages) {
              throw new Error(
                `Page ${String(pg)} is out of range (document has ${String(totalPages)} pages)`,
              )
            }
          }

          const output = await PDFDocument.create()
          const indices = parsed.pages.map((pg) => pg - 1) // convert to 0-based
          const copiedPages = await output.copyPages(src, indices)
          for (const page of copiedPages) {
            output.addPage(page)
          }

          const outputBytes = await output.save()
          await fs.mkdir(path.dirname(safeOutput), { recursive: true })
          await fs.writeFile(safeOutput, outputBytes)

          return textResult(JSON.stringify({
            split: true,
            extractedPages: parsed.pages,
            outputPath: safeOutput,
          }))
        }

        case 'pageCount': {
          const safe = await validatePath(parsed.path, allowedDirs)
          await assertFileSize(safe)

          const { PDFDocument } = await loadPdfLib()
          const bytes = await fs.readFile(safe)
          const doc = await PDFDocument.load(bytes)

          return textResult(JSON.stringify({
            pageCount: doc.getPageCount(),
            path: safe,
          }))
        }
      }
    },
  }
}
