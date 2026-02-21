import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { urlToolsTool, validateHttpUrl, isPrivateHostname, parseArgs } from '../src/url-tools'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/url-tools.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchHead(status = 200, headers: Record<string, string> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: new Headers(headers),
    }),
  )
}

function mockFetchHtml(html: string, status = 200): void {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(html)
  let read = false

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      body: {
        getReader: () => ({
          read: () => {
            if (read) return Promise.resolve({ done: true, value: undefined })
            read = true
            return Promise.resolve({ done: false, value: bytes })
          },
          cancel: () => Promise.resolve(),
        }),
      },
    }),
  )
}

function mockFetchRedirectChain(chain: Array<{ status: number; location?: string }>): void {
  let callIndex = 0
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const step = chain[callIndex]
      if (!step) throw new Error('Unexpected fetch call')
      callIndex++
      const headers = new Headers()
      if (step.location) headers.set('location', step.location)
      return Promise.resolve({
        ok: step.status >= 200 && step.status < 300,
        status: step.status,
        statusText: step.status === 200 ? 'OK' : 'Redirect',
        headers,
      })
    }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('url-tools tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(urlToolsTool.name).toBe('url-tools')
    })

    it('runs on server', () => {
      expect(urlToolsTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(urlToolsTool.permissions).toContain('net:http')
    })

    it('does not require confirmation', () => {
      expect(urlToolsTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // parse()
  // -------------------------------------------------------------------------

  describe('parse()', () => {
    it('parses a full URL', async () => {
      const result = await urlToolsTool.execute({
        action: 'parse',
        url: 'https://example.com:8080/path?q=hello&lang=en#section',
      })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed).toMatchObject({
        protocol: 'https:',
        hostname: 'example.com',
        port: '8080',
        pathname: '/path',
        search: '?q=hello&lang=en',
        hash: '#section',
      })
      expect((parsed['searchParams'] as Record<string, string>)['q']).toBe('hello')
      expect((parsed['searchParams'] as Record<string, string>)['lang']).toBe('en')
    })

    it('parses a minimal URL', async () => {
      const result = await urlToolsTool.execute({ action: 'parse', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['hostname']).toBe('example.com')
      expect(parsed['pathname']).toBe('/')
      expect(parsed['port']).toBe('')
    })

    it('throws on invalid URL', async () => {
      await expect(
        urlToolsTool.execute({ action: 'parse', url: 'not-a-url' }),
      ).rejects.toThrow('Invalid URL')
    })
  })

  // -------------------------------------------------------------------------
  // validate()
  // -------------------------------------------------------------------------

  describe('validate()', () => {
    it('reports reachable URL', async () => {
      mockFetchHead(200)
      const result = await urlToolsTool.execute({ action: 'validate', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['reachable']).toBe(true)
      expect(parsed['status']).toBe(200)
    })

    it('reports unreachable URL on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
      const result = await urlToolsTool.execute({ action: 'validate', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['reachable']).toBe(false)
      expect(parsed['error']).toBe('Network error')
    })

    it('blocks private IP (SSRF)', async () => {
      await expect(
        urlToolsTool.execute({ action: 'validate', url: 'http://127.0.0.1' }),
      ).rejects.toThrow('Blocked private/internal hostname')
    })

    it('blocks file:// scheme', async () => {
      await expect(
        urlToolsTool.execute({ action: 'validate', url: 'file:///etc/passwd' }),
      ).rejects.toThrow('Blocked URL scheme')
    })
  })

  // -------------------------------------------------------------------------
  // metadata()
  // -------------------------------------------------------------------------

  describe('metadata()', () => {
    it('extracts title and OG tags', async () => {
      const html = `
        <html>
          <head>
            <title>Page Title</title>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Description">
            <meta property="og:image" content="https://example.com/img.jpg">
            <meta name="description" content="Meta Description">
          </head>
          <body>Content</body>
        </html>
      `
      mockFetchHtml(html)
      const result = await urlToolsTool.execute({ action: 'metadata', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['title']).toBe('OG Title')
      expect(parsed['description']).toBe('Meta Description')
      expect(parsed['image']).toBe('https://example.com/img.jpg')
    })

    it('falls back to <title> when no og:title', async () => {
      const html = '<html><head><title>Fallback Title</title></head></html>'
      mockFetchHtml(html)
      const result = await urlToolsTool.execute({ action: 'metadata', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['title']).toBe('Fallback Title')
    })

    it('handles page with no metadata', async () => {
      mockFetchHtml('<html><body>Hello</body></html>')
      const result = await urlToolsTool.execute({ action: 'metadata', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['title']).toBe('')
      expect(parsed['description']).toBe('')
    })

    it('throws on HTTP error', async () => {
      mockFetchHtml('', 404)
      await expect(
        urlToolsTool.execute({ action: 'metadata', url: 'https://example.com/missing' }),
      ).rejects.toThrow('Fetch failed')
    })

    it('blocks SSRF on metadata', async () => {
      await expect(
        urlToolsTool.execute({ action: 'metadata', url: 'http://10.0.0.1/internal' }),
      ).rejects.toThrow('Blocked private/internal hostname')
    })
  })

  // -------------------------------------------------------------------------
  // resolve()
  // -------------------------------------------------------------------------

  describe('resolve()', () => {
    it('resolves direct URL (no redirect)', async () => {
      mockFetchRedirectChain([{ status: 200 }])
      const result = await urlToolsTool.execute({ action: 'resolve', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['finalUrl']).toBe('https://example.com/')
      expect(parsed['hops']).toBe(0)
    })

    it('follows single redirect', async () => {
      mockFetchRedirectChain([
        { status: 301, location: 'https://www.example.com/' },
        { status: 200 },
      ])
      const result = await urlToolsTool.execute({ action: 'resolve', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['finalUrl']).toBe('https://www.example.com/')
      expect(parsed['hops']).toBe(1)
      expect((parsed['chain'] as string[]).length).toBe(2)
    })

    it('follows multiple redirects', async () => {
      mockFetchRedirectChain([
        { status: 302, location: 'https://step1.com/' },
        { status: 302, location: 'https://step2.com/' },
        { status: 200 },
      ])
      const result = await urlToolsTool.execute({ action: 'resolve', url: 'https://start.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['finalUrl']).toBe('https://step2.com/')
      expect(parsed['hops']).toBe(2)
    })

    it('handles redirect without Location header', async () => {
      mockFetchRedirectChain([{ status: 301 }])
      const result = await urlToolsTool.execute({ action: 'resolve', url: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['warning']).toContain('without Location')
    })

    it('blocks SSRF on redirect target', async () => {
      mockFetchRedirectChain([
        { status: 301, location: 'http://192.168.1.1/admin' },
      ])
      await expect(
        urlToolsTool.execute({ action: 'resolve', url: 'https://example.com' }),
      ).rejects.toThrow('Blocked private/internal hostname')
    })

    it('throws on too many redirects', async () => {
      const chain = Array.from({ length: 11 }, (_, i) => ({
        status: 302,
        location: `https://hop${String(i + 1)}.com/`,
      }))
      mockFetchRedirectChain(chain)
      await expect(
        urlToolsTool.execute({ action: 'resolve', url: 'https://start.com' }),
      ).rejects.toThrow('Too many redirects')
    })
  })

  // -------------------------------------------------------------------------
  // build()
  // -------------------------------------------------------------------------

  describe('build()', () => {
    it('builds URL from base', async () => {
      const result = await urlToolsTool.execute({ action: 'build', base: 'https://example.com' })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['url']).toBe('https://example.com/')
    })

    it('builds URL with path', async () => {
      const result = await urlToolsTool.execute({
        action: 'build',
        base: 'https://example.com',
        path: '/api/v1/users',
      })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      expect(parsed['url']).toBe('https://example.com/api/v1/users')
    })

    it('builds URL with params', async () => {
      const result = await urlToolsTool.execute({
        action: 'build',
        base: 'https://example.com/search',
        params: { q: 'hello world', page: '2' },
      })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      const url = new URL(parsed['url'] as string)
      expect(url.searchParams.get('q')).toBe('hello world')
      expect(url.searchParams.get('page')).toBe('2')
    })

    it('builds URL with path and params', async () => {
      const result = await urlToolsTool.execute({
        action: 'build',
        base: 'https://api.example.com',
        path: '/v2/items',
        params: { limit: '10' },
      })
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
      const url = new URL(parsed['url'] as string)
      expect(url.pathname).toBe('/v2/items')
      expect(url.searchParams.get('limit')).toBe('10')
    })

    it('throws on invalid base URL', async () => {
      await expect(
        urlToolsTool.execute({ action: 'build', base: 'not-a-url' }),
      ).rejects.toThrow('Invalid base URL')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(urlToolsTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(urlToolsTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        urlToolsTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects parse without url', async () => {
      await expect(
        urlToolsTool.execute({ action: 'parse' }),
      ).rejects.toThrow('non-empty "url"')
    })

    it('rejects build without base', async () => {
      await expect(
        urlToolsTool.execute({ action: 'build' }),
      ).rejects.toThrow('non-empty "base"')
    })

    it('rejects build with non-string path', async () => {
      await expect(
        urlToolsTool.execute({ action: 'build', base: 'https://example.com', path: 123 }),
      ).rejects.toThrow('"path" must be a string')
    })

    it('rejects build with non-object params', async () => {
      await expect(
        urlToolsTool.execute({ action: 'build', base: 'https://example.com', params: 'bad' }),
      ).rejects.toThrow('"params" must be an object')
    })
  })

  // -------------------------------------------------------------------------
  // Exported functions
  // -------------------------------------------------------------------------

  describe('validateHttpUrl()', () => {
    it('accepts https URL', () => {
      const parsed = validateHttpUrl('https://example.com')
      expect(parsed.hostname).toBe('example.com')
    })

    it('accepts http URL', () => {
      const parsed = validateHttpUrl('http://example.com')
      expect(parsed.hostname).toBe('example.com')
    })

    it('rejects file:// scheme', () => {
      expect(() => validateHttpUrl('file:///etc/passwd')).toThrow('Blocked URL scheme')
    })

    it('rejects javascript: scheme', () => {
      expect(() => validateHttpUrl('javascript:alert(1)')).toThrow()
    })

    it('rejects embedded credentials', () => {
      expect(() => validateHttpUrl('https://user:pass@example.com')).toThrow('embedded credentials')
    })

    it('rejects private hostname', () => {
      expect(() => validateHttpUrl('http://localhost')).toThrow('Blocked private/internal')
    })
  })

  describe('isPrivateHostname()', () => {
    it('blocks localhost', () => expect(isPrivateHostname('localhost')).toBe(true))
    it('blocks 127.0.0.1', () => expect(isPrivateHostname('127.0.0.1')).toBe(true))
    it('blocks 10.x.x.x', () => expect(isPrivateHostname('10.0.0.1')).toBe(true))
    it('blocks 192.168.x.x', () => expect(isPrivateHostname('192.168.1.1')).toBe(true))
    it('blocks 172.16.x.x', () => expect(isPrivateHostname('172.16.0.1')).toBe(true))
    it('blocks ::1', () => expect(isPrivateHostname('::1')).toBe(true))
    it('blocks .local', () => expect(isPrivateHostname('server.local')).toBe(true))
    it('blocks .internal', () => expect(isPrivateHostname('api.internal')).toBe(true))
    it('blocks 169.254.x.x', () => expect(isPrivateHostname('169.254.1.1')).toBe(true))
    it('blocks 0.0.0.0', () => expect(isPrivateHostname('0.0.0.0')).toBe(true))
    it('allows public hostname', () => expect(isPrivateHostname('example.com')).toBe(false))
    it('allows public IP', () => expect(isPrivateHostname('8.8.8.8')).toBe(false))
  })

  describe('parseArgs()', () => {
    it('parses valid parse action', () => {
      const result = parseArgs({ action: 'parse', url: 'https://example.com' })
      expect(result).toEqual({ action: 'parse', url: 'https://example.com' })
    })

    it('trims url whitespace', () => {
      const result = parseArgs({ action: 'parse', url: '  https://example.com  ' })
      expect(result).toEqual({ action: 'parse', url: 'https://example.com' })
    })
  })

  // -------------------------------------------------------------------------
  // Security — SSRF
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      // url-tools uses dynamic URLs — no hardcoded fetch URLs in source
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('contains no direct HTML injection patterns', () => {
      // Verify no .inner + HTML assignment or dangerous set patterns
      const assignPattern = new RegExp(['.inner', 'HTML\\s*='].join(''))
      const dangerousPattern = new RegExp(['dangerous', 'lySetInner', 'HTML'].join(''))
      expect(sourceCode).not.toMatch(assignPattern)
      expect(sourceCode).not.toMatch(dangerousPattern)
    })

    describe('SSRF protection', () => {
      it('blocks localhost on validate', async () => {
        await expect(
          urlToolsTool.execute({ action: 'validate', url: 'http://localhost:8080' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks 10.x on metadata', async () => {
        await expect(
          urlToolsTool.execute({ action: 'metadata', url: 'http://10.0.0.1' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks 192.168.x on resolve', async () => {
        await expect(
          urlToolsTool.execute({ action: 'resolve', url: 'http://192.168.1.1' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks ::1 on validate', async () => {
        await expect(
          urlToolsTool.execute({ action: 'validate', url: 'http://[::1]' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks file:// on validate', async () => {
        await expect(
          urlToolsTool.execute({ action: 'validate', url: 'file:///etc/passwd' }),
        ).rejects.toThrow('Blocked URL scheme')
      })

      it('blocks data: on metadata', async () => {
        await expect(
          urlToolsTool.execute({ action: 'metadata', url: 'data:text/html,<h1>hi</h1>' }),
        ).rejects.toThrow('Blocked URL scheme')
      })

      it('blocks SSRF via redirect chain', async () => {
        mockFetchRedirectChain([
          { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
        ])
        await expect(
          urlToolsTool.execute({ action: 'resolve', url: 'https://example.com' }),
        ).rejects.toThrow('Blocked private/internal')
      })
    })
  })
})
