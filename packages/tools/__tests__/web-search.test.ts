import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { webSearchTool, validateUrl } from '../src/web-search'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/web-search.ts')
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

function mockFetchHtml(html: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(html),
    }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('web-search tool', () => {
  beforeEach(() => {
    vi.stubEnv('WEB_SEARCH_BACKEND', 'brave')
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key-123')
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
      expect(webSearchTool.name).toBe('web-search')
    })

    it('runs on server', () => {
      expect(webSearchTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(webSearchTool.permissions).toContain('net:http')
    })

    it('does not require confirmation', () => {
      expect(webSearchTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('returns results from Brave backend', async () => {
      mockFetchJson({
        web: {
          results: [
            {
              title: 'Example',
              url: 'https://example.com',
              description: 'An example page',
            },
            {
              title: 'Test Site',
              url: 'https://test.com',
              description: 'A test site',
            },
          ],
        },
      })

      const result = await webSearchTool.execute({
        action: 'search',
        query: 'test query',
      })

      expect(result.content).toHaveLength(1)
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { results: { title: string; url: string; snippet: string }[] }

      expect(parsed.results).toHaveLength(2)
      expect(parsed.results[0]).toEqual({
        title: 'Example',
        url: 'https://example.com',
        snippet: 'An example page',
      })
    })

    it('returns results from Serper backend', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'serper')
      vi.stubEnv('SERPER_API_KEY', 'serper-key-456')

      mockFetchJson({
        organic: [
          {
            title: 'Serper Result',
            link: 'https://serper-result.com',
            snippet: 'From Serper',
          },
        ],
      })

      const result = await webSearchTool.execute({
        action: 'search',
        query: 'serper test',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { results: { title: string; url: string; snippet: string }[] }

      expect(parsed.results).toHaveLength(1)
      expect(parsed.results[0]?.title).toBe('Serper Result')
    })

    it('returns results from SearXNG backend', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng')
      vi.stubEnv('SEARXNG_INSTANCE_URL', 'https://searx.example.com')

      mockFetchJson({
        results: [
          {
            title: 'SearXNG Result',
            url: 'https://searxng-result.com',
            content: 'From SearXNG',
          },
        ],
      })

      const result = await webSearchTool.execute({
        action: 'search',
        query: 'searxng test',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { results: { title: string; url: string; snippet: string }[] }

      expect(parsed.results).toHaveLength(1)
      expect(parsed.results[0]?.snippet).toBe('From SearXNG')
    })

    it('limits to 10 results', async () => {
      const manyResults = Array.from({ length: 15 }, (_, i) => ({
        title: `Result ${String(i)}`,
        url: `https://example.com/${String(i)}`,
        description: `Snippet ${String(i)}`,
      }))
      mockFetchJson({ web: { results: manyResults } })

      const result = await webSearchTool.execute({
        action: 'search',
        query: 'many results',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { results: unknown[] }

      expect(parsed.results).toHaveLength(10)
    })

    it('rejects empty query', async () => {
      await expect(
        webSearchTool.execute({ action: 'search', query: '' }),
      ).rejects.toThrow('non-empty "query"')
    })

    it('rejects missing query', async () => {
      await expect(
        webSearchTool.execute({ action: 'search' }),
      ).rejects.toThrow('non-empty "query"')
    })

    it('throws on missing API key', async () => {
      vi.stubEnv('BRAVE_SEARCH_API_KEY', '')

      await expect(
        webSearchTool.execute({ action: 'search', query: 'test' }),
      ).rejects.toThrow('BRAVE_SEARCH_API_KEY')
    })

    it('throws on unknown backend', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'unknown')

      await expect(
        webSearchTool.execute({ action: 'search', query: 'test' }),
      ).rejects.toThrow('Unknown search backend')
    })
  })

  // -------------------------------------------------------------------------
  // fetchPage()
  // -------------------------------------------------------------------------

  describe('fetchPage()', () => {
    it('returns page content and title', async () => {
      mockFetchHtml(
        '<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>',
      )

      const result = await webSearchTool.execute({
        action: 'fetchPage',
        url: 'https://example.com',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { content: string; title: string }

      expect(parsed.title).toBe('Test Page')
      expect(parsed.content).toContain('Hello world')
    })

    it('strips script and style tags', async () => {
      mockFetchHtml(
        '<html><head><style>body{color:red}</style></head><body><script>alert(1)</script><p>Safe</p></body></html>',
      )

      const result = await webSearchTool.execute({
        action: 'fetchPage',
        url: 'https://example.com',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { content: string }

      expect(parsed.content).toContain('Safe')
      expect(parsed.content).not.toContain('alert')
      expect(parsed.content).not.toContain('color:red')
    })

    it('rejects file:// URLs', async () => {
      await expect(
        webSearchTool.execute({
          action: 'fetchPage',
          url: 'file:///etc/passwd',
        }),
      ).rejects.toThrow('only https: is allowed')
    })

    it('rejects javascript: URLs', async () => {
      await expect(
        webSearchTool.execute({
          action: 'fetchPage',
          url: 'javascript:alert(1)',
        }),
      ).rejects.toThrow('only https: is allowed')
    })

    it('rejects http:// URLs', async () => {
      await expect(
        webSearchTool.execute({
          action: 'fetchPage',
          url: 'http://example.com',
        }),
      ).rejects.toThrow('only https: is allowed')
    })

    it('rejects data: URLs', async () => {
      await expect(
        webSearchTool.execute({
          action: 'fetchPage',
          url: 'data:text/html,<h1>xss</h1>',
        }),
      ).rejects.toThrow('only https: is allowed')
    })

    it('rejects URLs with embedded credentials', async () => {
      await expect(
        webSearchTool.execute({
          action: 'fetchPage',
          url: 'https://user:pass@evil.com',
        }),
      ).rejects.toThrow('credentials are not allowed')
    })

    it('rejects invalid URLs', async () => {
      await expect(
        webSearchTool.execute({
          action: 'fetchPage',
          url: 'not-a-url',
        }),
      ).rejects.toThrow('Invalid URL')
    })

    it('rejects empty url', async () => {
      await expect(
        webSearchTool.execute({ action: 'fetchPage', url: '' }),
      ).rejects.toThrow('non-empty "url"')
    })
  })

  // -------------------------------------------------------------------------
  // validateUrl (exported)
  // -------------------------------------------------------------------------

  describe('validateUrl()', () => {
    it('accepts valid https URL', () => {
      const parsed = validateUrl('https://example.com/path?q=1')
      expect(parsed.protocol).toBe('https:')
      expect(parsed.hostname).toBe('example.com')
    })

    it('normalizes uppercase HTTPS', () => {
      const parsed = validateUrl('HTTPS://EXAMPLE.COM')
      expect(parsed.protocol).toBe('https:')
    })

    it('rejects ftp:// URLs', () => {
      expect(() => validateUrl('ftp://files.example.com')).toThrow(
        'only https: is allowed',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing edge cases
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(webSearchTool.execute(null)).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects non-object args', async () => {
      await expect(webSearchTool.execute('string')).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects unknown action', async () => {
      await expect(
        webSearchTool.execute({ action: 'delete' }),
      ).rejects.toThrow('action must be "search" or "fetchPage"')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [
        'https://api.search.brave.com',
        'https://google.serper.dev',
      ])
    })
  })
})
