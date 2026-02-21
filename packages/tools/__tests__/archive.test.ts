import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { createArchiveTool, parseArgs, isWithinDir } from '../src/archive'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/archive.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_DIR = resolve(currentDir, '../.test-archive-tmp')
const ALLOWED_DIR = join(TEST_DIR, 'workspace')
const OUTSIDE_DIR = join(TEST_DIR, 'outside')
const OUTPUT_ZIP = join(ALLOWED_DIR, 'test-output.zip')

function parseResult(result: { content: readonly { type: string; text?: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
}

// Create a tool instance with the test directory as allowed
const tool = createArchiveTool({ allowedDirectories: [ALLOWED_DIR] })

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Create test directories and files
  mkdirSync(ALLOWED_DIR, { recursive: true })
  mkdirSync(OUTSIDE_DIR, { recursive: true })
  mkdirSync(join(ALLOWED_DIR, 'subdir'), { recursive: true })

  writeFileSync(join(ALLOWED_DIR, 'file1.txt'), 'Hello World')
  writeFileSync(join(ALLOWED_DIR, 'file2.txt'), 'Second file')
  writeFileSync(join(ALLOWED_DIR, 'subdir', 'nested.txt'), 'Nested content')
  writeFileSync(join(OUTSIDE_DIR, 'forbidden.txt'), 'Should not access')
})

afterAll(() => {
  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('archive tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(tool.name).toBe('archive')
    })

    it('runs on server', () => {
      expect(tool.runsOn).toBe('server')
    })

    it('has fs permissions', () => {
      expect(tool.permissions).toContain('fs:read')
      expect(tool.permissions).toContain('fs:write')
    })

    it('requires confirmation', () => {
      expect(tool.requiresConfirmation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe('create()', () => {
    it('creates a ZIP from files', async () => {
      const result = await tool.execute({
        action: 'create',
        output: OUTPUT_ZIP,
        sources: [join(ALLOWED_DIR, 'file1.txt'), join(ALLOWED_DIR, 'file2.txt')],
      })
      const parsed = parseResult(result)
      expect(parsed['created']).toBe(true)
      expect(parsed['size']).toBeGreaterThan(0)
      expect(existsSync(OUTPUT_ZIP)).toBe(true)
    })

    it('creates a ZIP from a directory', async () => {
      const dirZip = join(ALLOWED_DIR, 'dir-output.zip')
      const result = await tool.execute({
        action: 'create',
        output: dirZip,
        sources: [join(ALLOWED_DIR, 'subdir')],
      })
      const parsed = parseResult(result)
      expect(parsed['created']).toBe(true)
    })

    it('rejects output outside allowed dirs', async () => {
      await expect(
        tool.execute({
          action: 'create',
          output: join(OUTSIDE_DIR, 'out.zip'),
          sources: [join(ALLOWED_DIR, 'file1.txt')],
        }),
      ).rejects.toThrow('outside allowed')
    })

    it('rejects source outside allowed dirs', async () => {
      await expect(
        tool.execute({
          action: 'create',
          output: join(ALLOWED_DIR, 'out.zip'),
          sources: [join(OUTSIDE_DIR, 'forbidden.txt')],
        }),
      ).rejects.toThrow('outside allowed')
    })

    it('rejects empty sources', async () => {
      await expect(
        tool.execute({ action: 'create', output: OUTPUT_ZIP, sources: [] }),
      ).rejects.toThrow('non-empty "sources"')
    })
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('lists entries in a ZIP', async () => {
      const result = await tool.execute({
        action: 'list',
        archive: OUTPUT_ZIP,
      })
      const parsed = parseResult(result)
      expect(parsed['count']).toBeGreaterThan(0)
      expect(Array.isArray(parsed['entries'])).toBe(true)
    })

    it('rejects archive outside allowed dirs', async () => {
      await expect(
        tool.execute({ action: 'list', archive: join(OUTSIDE_DIR, 'test.zip') }),
      ).rejects.toThrow('outside allowed')
    })
  })

  // -------------------------------------------------------------------------
  // extract()
  // -------------------------------------------------------------------------

  describe('extract()', () => {
    it('extracts a ZIP to destination', async () => {
      const extractDir = join(ALLOWED_DIR, 'extracted')
      const result = await tool.execute({
        action: 'extract',
        archive: OUTPUT_ZIP,
        destination: extractDir,
      })
      const parsed = parseResult(result)
      expect(parsed['extracted']).toBe(true)
      expect(parsed['files']).toBeGreaterThan(0)
      expect(existsSync(extractDir)).toBe(true)
    })

    it('rejects destination outside allowed dirs', async () => {
      await expect(
        tool.execute({
          action: 'extract',
          archive: OUTPUT_ZIP,
          destination: OUTSIDE_DIR,
        }),
      ).rejects.toThrow('outside allowed')
    })

    it('rejects archive outside allowed dirs', async () => {
      await expect(
        tool.execute({
          action: 'extract',
          archive: join(OUTSIDE_DIR, 'test.zip'),
          destination: join(ALLOWED_DIR, 'out'),
        }),
      ).rejects.toThrow('outside allowed')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(tool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(tool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        tool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects create without output', async () => {
      await expect(
        tool.execute({ action: 'create', sources: ['file'] }),
      ).rejects.toThrow('non-empty "output"')
    })

    it('rejects extract without archive', async () => {
      await expect(
        tool.execute({ action: 'extract', destination: '/tmp' }),
      ).rejects.toThrow('non-empty "archive"')
    })

    it('rejects extract without destination', async () => {
      await expect(
        tool.execute({ action: 'extract', archive: '/tmp/test.zip' }),
      ).rejects.toThrow('non-empty "destination"')
    })

    it('rejects list without archive', async () => {
      await expect(
        tool.execute({ action: 'list' }),
      ).rejects.toThrow('non-empty "archive"')
    })
  })

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  describe('createArchiveTool()', () => {
    it('throws on empty allowed directories', () => {
      expect(() => createArchiveTool({ allowedDirectories: [] })).toThrow(
        'At least one allowed directory',
      )
    })

    it('creates tool with default config', () => {
      // Should not throw
      const defaultTool = createArchiveTool()
      expect(defaultTool.name).toBe('archive')
    })
  })

  // -------------------------------------------------------------------------
  // Exported helpers
  // -------------------------------------------------------------------------

  describe('isWithinDir()', () => {
    it('accepts path within directory', () => {
      expect(isWithinDir('subdir/file.txt', '/target')).toBe(true)
    })

    it('rejects path escaping directory', () => {
      expect(isWithinDir('../../../etc/passwd', '/target')).toBe(false)
    })

    it('rejects absolute path escaping directory', () => {
      expect(isWithinDir('/etc/passwd', '/target')).toBe(false)
    })

    it('accepts file at root of target', () => {
      expect(isWithinDir('file.txt', '/target')).toBe(true)
    })
  })

  describe('parseArgs()', () => {
    it('parses create action', () => {
      const result = parseArgs({ action: 'create', output: '/out.zip', sources: ['a.txt'] })
      expect(result).toEqual({ action: 'create', output: '/out.zip', sources: ['a.txt'] })
    })

    it('parses list action', () => {
      const result = parseArgs({ action: 'list', archive: '/test.zip' })
      expect(result).toEqual({ action: 'list', archive: '/test.zip' })
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('has no network access', () => {
      const fetchPattern = /\bfetch\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })

    describe('Zip Slip protection', () => {
      it('blocks ../../../etc/passwd', () => {
        expect(isWithinDir('../../../etc/passwd', '/target')).toBe(false)
      })

      it('blocks deeply nested traversal', () => {
        expect(isWithinDir('a/../../../../../../etc/passwd', '/target')).toBe(false)
      })

      it('blocks absolute paths', () => {
        expect(isWithinDir('/etc/shadow', '/target')).toBe(false)
      })

      it('allows normal nested path', () => {
        expect(isWithinDir('docs/readme.txt', '/target')).toBe(true)
      })

      it('source code checks isWithinDir before extraction', () => {
        expect(sourceCode).toContain('isWithinDir')
        expect(sourceCode).toContain('Zip Slip')
      })
    })

    describe('size limits', () => {
      it('has MAX_ARCHIVE_SIZE constant', () => {
        expect(sourceCode).toContain('MAX_ARCHIVE_SIZE')
      })

      it('has MAX_FILES constant', () => {
        expect(sourceCode).toContain('MAX_FILES')
      })

      it('has MAX_EXTRACTED_SIZE constant', () => {
        expect(sourceCode).toContain('MAX_EXTRACTED_SIZE')
      })

      it('has compression ratio check', () => {
        expect(sourceCode).toContain('MAX_COMPRESSION_RATIO')
        expect(sourceCode).toContain('zip bomb')
      })
    })

    describe('path validation', () => {
      it('validates all paths against allowed directories', () => {
        expect(sourceCode).toContain('validatePath')
        expect(sourceCode).toContain('outside allowed directories')
      })

      it('checks for null bytes', () => {
        expect(sourceCode).toContain('null bytes')
      })
    })
  })
})
