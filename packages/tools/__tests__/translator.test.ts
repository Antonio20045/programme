import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { translatorTool, validateApiUrl } from '../src/translator'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/translator.ts')
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('translator tool', () => {
  beforeEach(() => {
    vi.stubEnv('DEEPL_API_KEY', 'test-key-123:fx')
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
      expect(translatorTool.name).toBe('translator')
    })

    it('runs on server', () => {
      expect(translatorTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(translatorTool.permissions).toContain('net:http')
    })

    it('does not require confirmation', () => {
      expect(translatorTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // translate()
  // -------------------------------------------------------------------------

  describe('translate()', () => {
    it('translates text successfully', async () => {
      mockFetchJson({
        translations: [
          { detected_source_language: 'EN', text: 'Hallo Welt' },
        ],
      })

      const result = await translatorTool.execute({
        action: 'translate',
        text: 'Hello World',
        targetLang: 'DE',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { translatedText: string; detectedSourceLang: string; targetLang: string }

      expect(parsed.translatedText).toBe('Hallo Welt')
      expect(parsed.detectedSourceLang).toBe('EN')
      expect(parsed.targetLang).toBe('DE')
    })

    it('passes sourceLang when provided', async () => {
      mockFetchJson({
        translations: [
          { detected_source_language: 'EN', text: 'Bonjour le monde' },
        ],
      })

      const result = await translatorTool.execute({
        action: 'translate',
        text: 'Hello World',
        targetLang: 'FR',
        sourceLang: 'EN',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { translatedText: string }

      expect(parsed.translatedText).toBe('Bonjour le monde')

      // Verify sourceLang was sent in the request body
      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall).toBeDefined()
      const body = fetchCall?.[1]?.body as string
      expect(body).toContain('source_lang=EN')
    })

    it('throws on empty text', async () => {
      await expect(
        translatorTool.execute({ action: 'translate', text: '', targetLang: 'DE' }),
      ).rejects.toThrow('non-empty "text"')
    })

    it('throws on missing targetLang', async () => {
      await expect(
        translatorTool.execute({ action: 'translate', text: 'Hello' }),
      ).rejects.toThrow('non-empty "targetLang"')
    })

    it('throws on text exceeding max length', async () => {
      const longText = 'a'.repeat(50_001)
      await expect(
        translatorTool.execute({ action: 'translate', text: longText, targetLang: 'DE' }),
      ).rejects.toThrow('too long')
    })

    it('throws on API 403 (auth failure)', async () => {
      mockFetchJson({}, 403)

      await expect(
        translatorTool.execute({ action: 'translate', text: 'Hello', targetLang: 'DE' }),
      ).rejects.toThrow('authentication failed')
    })

    it('throws on API 456 (quota exceeded)', async () => {
      mockFetchJson({}, 456)

      await expect(
        translatorTool.execute({ action: 'translate', text: 'Hello', targetLang: 'DE' }),
      ).rejects.toThrow('quota exceeded')
    })

    it('throws when API returns no translation', async () => {
      mockFetchJson({ translations: [] })

      await expect(
        translatorTool.execute({ action: 'translate', text: 'Hello', targetLang: 'DE' }),
      ).rejects.toThrow('no translation')
    })
  })

  // -------------------------------------------------------------------------
  // detect()
  // -------------------------------------------------------------------------

  describe('detect()', () => {
    it('detects language', async () => {
      mockFetchJson({
        translations: [
          { detected_source_language: 'DE', text: 'Hello World' },
        ],
      })

      const result = await translatorTool.execute({
        action: 'detect',
        text: 'Hallo Welt',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { detectedLanguage: string }

      expect(parsed.detectedLanguage).toBe('DE')
    })

    it('throws on empty text', async () => {
      await expect(
        translatorTool.execute({ action: 'detect', text: '' }),
      ).rejects.toThrow('non-empty "text"')
    })

    it('throws when detection fails', async () => {
      mockFetchJson({ translations: [{}] })

      await expect(
        translatorTool.execute({ action: 'detect', text: 'Hello' }),
      ).rejects.toThrow('Could not detect')
    })
  })

  // -------------------------------------------------------------------------
  // API key routing
  // -------------------------------------------------------------------------

  describe('API key routing', () => {
    it('uses free API for keys ending with :fx', async () => {
      vi.stubEnv('DEEPL_API_KEY', 'my-free-key:fx')
      mockFetchJson({
        translations: [{ detected_source_language: 'EN', text: 'Hallo' }],
      })

      await translatorTool.execute({ action: 'translate', text: 'Hello', targetLang: 'DE' })

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall?.[0]).toContain('api-free.deepl.com')
    })

    it('uses pro API for non-:fx keys', async () => {
      vi.stubEnv('DEEPL_API_KEY', 'my-pro-key')
      mockFetchJson({
        translations: [{ detected_source_language: 'EN', text: 'Hallo' }],
      })

      await translatorTool.execute({ action: 'translate', text: 'Hello', targetLang: 'DE' })

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      expect(fetchCall?.[0]).toContain('api.deepl.com')
      expect(fetchCall?.[0]).not.toContain('api-free')
    })

    it('throws on missing API key', async () => {
      vi.stubEnv('DEEPL_API_KEY', '')

      await expect(
        translatorTool.execute({ action: 'translate', text: 'Hello', targetLang: 'DE' }),
      ).rejects.toThrow('DEEPL_API_KEY')
    })
  })

  // -------------------------------------------------------------------------
  // validateApiUrl() — exported
  // -------------------------------------------------------------------------

  describe('validateApiUrl()', () => {
    it('accepts api-free.deepl.com', () => {
      const parsed = validateApiUrl('https://api-free.deepl.com/v2/translate')
      expect(parsed.hostname).toBe('api-free.deepl.com')
    })

    it('accepts api.deepl.com', () => {
      const parsed = validateApiUrl('https://api.deepl.com/v2/translate')
      expect(parsed.hostname).toBe('api.deepl.com')
    })

    it('rejects non-allowed host', () => {
      expect(() => validateApiUrl('https://evil.com/v2/translate')).toThrow('not in the allowed hosts')
    })

    it('rejects http scheme', () => {
      expect(() => validateApiUrl('http://api.deepl.com/v2/translate')).toThrow('only https:')
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(translatorTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(translatorTool.execute(42)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        translatorTool.execute({ action: 'summarize' }),
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
        'https://api-free.deepl.com',
        'https://api.deepl.com',
      ])
    })
  })
})
