import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIONS_REQUIRING_CONFIRMATION,
  createPdfTool,
} from '../src/pdf-tools'
import type { ExtendedAgentTool } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.join(CURRENT_DIR, '..', 'src', 'pdf-tools.ts')

// ---------------------------------------------------------------------------
// Mock pdf-lib and pdf-parse via dynamic import
// ---------------------------------------------------------------------------

const mockGetPageCount = vi.fn().mockReturnValue(3)
const mockCopyPages = vi.fn().mockResolvedValue([{ type: 'page' }, { type: 'page' }, { type: 'page' }])
const mockAddPage = vi.fn()
const mockSave = vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) // %PDF

const mockPdfDocument = {
  getPageCount: mockGetPageCount,
  copyPages: mockCopyPages,
  addPage: mockAddPage,
  save: mockSave,
}

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn().mockResolvedValue(mockPdfDocument),
    create: vi.fn().mockResolvedValue({
      getPageCount: vi.fn().mockReturnValue(0),
      copyPages: mockCopyPages,
      addPage: mockAddPage,
      save: mockSave,
    }),
  },
}))

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({
    text: 'Hello PDF World',
    numpages: 3,
  }),
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let tool: ExtendedAgentTool

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-tool-'))
  tool = createPdfTool({ allowedDirectories: [tmpDir] })
  vi.clearAllMocks()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Behavior Tests ─────────────────────────────────────────────

describe('extractText', () => {
  it('extracts text from a PDF file', async () => {
    const pdfPath = path.join(tmpDir, 'test.pdf')
    await fs.writeFile(pdfPath, '%PDF-1.4 mock content')

    const result = await tool.execute({ action: 'extractText', path: pdfPath })
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { text: string; pages: number }

    expect(parsed.text).toBe('Hello PDF World')
    expect(parsed.pages).toBe(3)
  })

  it('throws for non-existent file', async () => {
    const pdfPath = path.join(tmpDir, 'nope.pdf')

    await expect(
      tool.execute({ action: 'extractText', path: pdfPath }),
    ).rejects.toThrow()
  })
})

describe('merge', () => {
  it('merges multiple PDF files', async () => {
    const pdf1 = path.join(tmpDir, 'a.pdf')
    const pdf2 = path.join(tmpDir, 'b.pdf')
    const output = path.join(tmpDir, 'merged.pdf')
    await fs.writeFile(pdf1, '%PDF mock1')
    await fs.writeFile(pdf2, '%PDF mock2')

    const result = await tool.execute({
      action: 'merge',
      paths: [pdf1, pdf2],
      outputPath: output,
    })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { merged: boolean; inputFiles: number }

    expect(parsed.merged).toBe(true)
    expect(parsed.inputFiles).toBe(2)

    // Output file should exist
    const exists = await fs.access(output).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('requires at least 2 files', async () => {
    const pdf1 = path.join(tmpDir, 'single.pdf')

    await expect(
      tool.execute({ action: 'merge', paths: [pdf1], outputPath: path.join(tmpDir, 'out.pdf') }),
    ).rejects.toThrow('at least 2')
  })
})

describe('split', () => {
  it('splits specific pages from a PDF', async () => {
    const pdfPath = path.join(tmpDir, 'source.pdf')
    const output = path.join(tmpDir, 'split.pdf')
    await fs.writeFile(pdfPath, '%PDF mock')

    const result = await tool.execute({
      action: 'split',
      path: pdfPath,
      pages: [1, 3],
      outputPath: output,
    })

    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { split: boolean; extractedPages: number[] }

    expect(parsed.split).toBe(true)
    expect(parsed.extractedPages).toEqual([1, 3])

    const exists = await fs.access(output).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('throws for page out of range', async () => {
    const pdfPath = path.join(tmpDir, 'source.pdf')
    await fs.writeFile(pdfPath, '%PDF mock')

    await expect(
      tool.execute({
        action: 'split',
        path: pdfPath,
        pages: [5],
        outputPath: path.join(tmpDir, 'out.pdf'),
      }),
    ).rejects.toThrow('out of range')
  })

  it('requires pages array', async () => {
    await expect(
      tool.execute({
        action: 'split',
        path: path.join(tmpDir, 'x.pdf'),
        pages: [],
        outputPath: path.join(tmpDir, 'out.pdf'),
      }),
    ).rejects.toThrow('non-empty "pages"')
  })

  it('rejects non-integer page numbers', async () => {
    await expect(
      tool.execute({
        action: 'split',
        path: path.join(tmpDir, 'x.pdf'),
        pages: [1.5],
        outputPath: path.join(tmpDir, 'out.pdf'),
      }),
    ).rejects.toThrow('positive integer')
  })

  it('rejects zero as page number', async () => {
    await expect(
      tool.execute({
        action: 'split',
        path: path.join(tmpDir, 'x.pdf'),
        pages: [0],
        outputPath: path.join(tmpDir, 'out.pdf'),
      }),
    ).rejects.toThrow('positive integer')
  })
})

describe('pageCount', () => {
  it('returns page count', async () => {
    const pdfPath = path.join(tmpDir, 'count.pdf')
    await fs.writeFile(pdfPath, '%PDF mock')

    const result = await tool.execute({ action: 'pageCount', path: pdfPath })
    const parsed = JSON.parse(
      (result.content[0] as { type: 'text'; text: string }).text,
    ) as { pageCount: number }

    expect(parsed.pageCount).toBe(3)
  })
})

// ── Argument Validation ────────────────────────────────────────

describe('argument validation', () => {
  it('rejects non-object args', async () => {
    await expect(tool.execute('string')).rejects.toThrow(
      'Arguments must be a non-null object',
    )
  })

  it('rejects null args', async () => {
    await expect(tool.execute(null)).rejects.toThrow(
      'Arguments must be a non-null object',
    )
  })

  it('rejects unknown action', async () => {
    await expect(
      tool.execute({ action: 'hackPdf' }),
    ).rejects.toThrow('Invalid action')
  })

  it('rejects extractText without path', async () => {
    await expect(tool.execute({ action: 'extractText' })).rejects.toThrow(
      'non-empty "path"',
    )
  })

  it('rejects merge without outputPath', async () => {
    await expect(
      tool.execute({ action: 'merge', paths: ['a.pdf', 'b.pdf'] }),
    ).rejects.toThrow('non-empty "outputPath"')
  })

  it('rejects split without path', async () => {
    await expect(
      tool.execute({ action: 'split', pages: [1], outputPath: 'out.pdf' }),
    ).rejects.toThrow('non-empty "path"')
  })

  it('rejects pageCount without path', async () => {
    await expect(tool.execute({ action: 'pageCount' })).rejects.toThrow(
      'non-empty "path"',
    )
  })
})

// ── Tool Metadata ──────────────────────────────────────────────

describe('tool metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('pdf-tools')
  })

  it('has correct permissions', () => {
    expect(tool.permissions).toEqual(['fs:read', 'fs:write'])
  })

  it('requires confirmation', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })

  it('runs on desktop', () => {
    expect(tool.runsOn).toBe('desktop')
  })

  it('exports correct confirmation actions', () => {
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('merge')).toBe(true)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('split')).toBe(true)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('extractText')).toBe(false)
    expect(ACTIONS_REQUIRING_CONFIRMATION.has('pageCount')).toBe(false)
  })

  it('requires at least one allowed directory', () => {
    expect(() =>
      createPdfTool({ allowedDirectories: [] }),
    ).toThrow('At least one allowed directory must be configured')
  })
})

// ── Path Traversal Protection ──────────────────────────────────

describe('path traversal protection', () => {
  it('blocks ../../etc/passwd', async () => {
    await expect(
      tool.execute({
        action: 'extractText',
        path: path.join(tmpDir, '..', '..', 'etc', 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks /etc/shadow', async () => {
    await expect(
      tool.execute({ action: 'extractText', path: '/etc/shadow' }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks symlink pointing outside allowed directories', async () => {
    const linkPath = path.join(tmpDir, 'evil-link')
    await fs.symlink('/etc', linkPath)

    await expect(
      tool.execute({
        action: 'extractText',
        path: path.join(linkPath, 'passwd'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks path with null bytes', async () => {
    await expect(
      tool.execute({
        action: 'extractText',
        path: path.join(tmpDir, 'file\0.pdf'),
      }),
    ).rejects.toThrow('null bytes')
  })

  it('blocks merge output to traversal path', async () => {
    const pdf1 = path.join(tmpDir, 'a.pdf')
    const pdf2 = path.join(tmpDir, 'b.pdf')
    await fs.writeFile(pdf1, '%PDF')
    await fs.writeFile(pdf2, '%PDF')

    await expect(
      tool.execute({
        action: 'merge',
        paths: [pdf1, pdf2],
        outputPath: '/tmp/evil.pdf',
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks split output to traversal path', async () => {
    const pdfPath = path.join(tmpDir, 'src.pdf')
    await fs.writeFile(pdfPath, '%PDF')

    await expect(
      tool.execute({
        action: 'split',
        path: pdfPath,
        pages: [1],
        outputPath: '/tmp/evil.pdf',
      }),
    ).rejects.toThrow('outside allowed directories')
  })

  it('blocks merge input from outside allowed dirs', async () => {
    const legit = path.join(tmpDir, 'legit.pdf')
    await fs.writeFile(legit, '%PDF')

    await expect(
      tool.execute({
        action: 'merge',
        paths: [legit, '/etc/passwd'],
        outputPath: path.join(tmpDir, 'out.pdf'),
      }),
    ).rejects.toThrow('outside allowed directories')
  })
})

// ── File Size Limit ────────────────────────────────────────────

describe('file size limit', () => {
  it('rejects files larger than 50 MB', async () => {
    const largePath = path.join(tmpDir, 'huge.pdf')
    // Create a file slightly over 50 MB using sparse file technique
    const fd = await fs.open(largePath, 'w')
    await fd.truncate(MAX_FILE_SIZE_PLUS_ONE)
    await fd.close()

    await expect(
      tool.execute({ action: 'extractText', path: largePath }),
    ).rejects.toThrow('too large')
  })
})

const MAX_FILE_SIZE_PLUS_ONE = 50 * 1024 * 1024 + 1

// ── Source Code Security ───────────────────────────────────────

describe('source code security', () => {
  it('contains no code execution patterns', async () => {
    const source = await fs.readFile(SOURCE_PATH, 'utf-8')
    assertNoEval(source)
  })

  it('contains no unauthorized fetch calls', async () => {
    const source = await fs.readFile(SOURCE_PATH, 'utf-8')
    assertNoUnauthorizedFetch(source, [])
  })
})
