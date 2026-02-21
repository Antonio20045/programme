import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { imageGenTool, validateApiUrl } from '../src/image-gen'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/image-gen.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    }),
  )
}

function mockFetchError(status: number, errorData?: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      json: () => Promise.resolve(errorData ?? {}),
    }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('image-gen tool', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key-123')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(imageGenTool.name).toBe('image-gen')
    })

    it('runs on server', () => {
      expect(imageGenTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(imageGenTool.permissions).toContain('net:http')
    })

    it('requires confirmation (costs money)', () => {
      expect(imageGenTool.requiresConfirmation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // generate()
  // -------------------------------------------------------------------------

  describe('generate()', () => {
    it('generates an image and returns base64', async () => {
      const fakeB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
      mockFetchJson({ data: [{ b64_json: fakeB64 }] })

      const result = await imageGenTool.execute({
        action: 'generate',
        prompt: 'A cute cat',
      })

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: 'image',
        data: fakeB64,
        mimeType: 'image/png',
      })
    })

    it('sends correct request body', async () => {
      mockFetchJson({ data: [{ b64_json: 'abc' }] })

      await imageGenTool.execute({
        action: 'generate',
        prompt: 'A sunset',
        size: '1792x1024',
      })

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall?.[0]).toContain('images/generations')
      const body = JSON.parse(fetchCall?.[1]?.body as string) as Record<string, unknown>
      expect(body['prompt']).toBe('A sunset')
      expect(body['size']).toBe('1792x1024')
      expect(body['response_format']).toBe('b64_json')
      expect(body['model']).toBe('dall-e-3')
    })

    it('defaults to 1024x1024 size', async () => {
      mockFetchJson({ data: [{ b64_json: 'abc' }] })

      await imageGenTool.execute({
        action: 'generate',
        prompt: 'A dog',
      })

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse(fetchCall?.[1]?.body as string) as Record<string, unknown>
      expect(body['size']).toBe('1024x1024')
    })

    it('throws on empty prompt', async () => {
      await expect(
        imageGenTool.execute({ action: 'generate', prompt: '' }),
      ).rejects.toThrow('non-empty "prompt"')
    })

    it('throws on prompt exceeding max length', async () => {
      const longPrompt = 'a'.repeat(4001)
      await expect(
        imageGenTool.execute({ action: 'generate', prompt: longPrompt }),
      ).rejects.toThrow('too long')
    })

    it('throws on invalid size', async () => {
      await expect(
        imageGenTool.execute({ action: 'generate', prompt: 'test', size: '512x512' }),
      ).rejects.toThrow('Invalid size')
    })

    it('throws when API returns no image data', async () => {
      mockFetchJson({ data: [] })

      await expect(
        imageGenTool.execute({ action: 'generate', prompt: 'test' }),
      ).rejects.toThrow('no image data')
    })
  })

  // -------------------------------------------------------------------------
  // edit()
  // -------------------------------------------------------------------------

  describe('edit()', () => {
    it('edits an image and returns base64', async () => {
      const fakeB64 = 'editedImageBase64Data'
      mockFetchJson({ data: [{ b64_json: fakeB64 }] })

      const result = await imageGenTool.execute({
        action: 'edit',
        prompt: 'Add a hat',
        imageBase64: 'originalImageData',
      })

      expect(result.content[0]).toEqual({
        type: 'image',
        data: fakeB64,
        mimeType: 'image/png',
      })
    })

    it('throws on missing imageBase64', async () => {
      await expect(
        imageGenTool.execute({ action: 'edit', prompt: 'test' }),
      ).rejects.toThrow('non-empty "imageBase64"')
    })

    it('throws on empty imageBase64', async () => {
      await expect(
        imageGenTool.execute({ action: 'edit', prompt: 'test', imageBase64: '' }),
      ).rejects.toThrow('non-empty "imageBase64"')
    })
  })

  // -------------------------------------------------------------------------
  // API errors
  // -------------------------------------------------------------------------

  describe('API errors', () => {
    it('throws on 401 (auth failure)', async () => {
      mockFetchError(401)

      await expect(
        imageGenTool.execute({ action: 'generate', prompt: 'test' }),
      ).rejects.toThrow('authentication failed')
    })

    it('throws on 429 (rate limit)', async () => {
      mockFetchError(429)

      await expect(
        imageGenTool.execute({ action: 'generate', prompt: 'test' }),
      ).rejects.toThrow('rate limit')
    })

    it('throws on 500 with error message', async () => {
      mockFetchError(500, { error: { message: 'Server overloaded' } })

      await expect(
        imageGenTool.execute({ action: 'generate', prompt: 'test' }),
      ).rejects.toThrow('Server overloaded')
    })

    it('throws on missing API key', async () => {
      vi.stubEnv('OPENAI_API_KEY', '')

      await expect(
        imageGenTool.execute({ action: 'generate', prompt: 'test' }),
      ).rejects.toThrow('OPENAI_API_KEY')
    })
  })

  // -------------------------------------------------------------------------
  // validateApiUrl() — exported
  // -------------------------------------------------------------------------

  describe('validateApiUrl()', () => {
    it('accepts api.openai.com', () => {
      const parsed = validateApiUrl('https://api.openai.com/v1/images/generations')
      expect(parsed.hostname).toBe('api.openai.com')
    })

    it('rejects non-allowed host', () => {
      expect(() => validateApiUrl('https://evil.com/api')).toThrow('not in the allowed hosts')
    })

    it('rejects http scheme', () => {
      expect(() => validateApiUrl('http://api.openai.com/v1')).toThrow('only https:')
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(imageGenTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(imageGenTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        imageGenTool.execute({ action: 'delete' }),
      ).rejects.toThrow('action must be')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [
        'https://api.openai.com',
      ])
    })
  })
})
