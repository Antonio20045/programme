import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { httpClientTool, validateRequestUrl, isPrivateHostname, parseArgs } from '../src/http-client'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/http-client.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: string, status = 200, headers: Record<string, string> = {}): void {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(body)
  let read = false

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: new Headers(headers),
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

function mockFetchRedirectChain(chain: Array<{ status: number; location?: string; body?: string }>): void {
  let callIndex = 0
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const step = chain[callIndex]
      if (!step) throw new Error('Unexpected fetch call')
      callIndex++
      const headers = new Headers()
      if (step.location) headers.set('location', step.location)

      const encoder = new TextEncoder()
      const bytes = encoder.encode(step.body ?? '')
      let read = false

      return Promise.resolve({
        ok: step.status >= 200 && step.status < 300,
        status: step.status,
        statusText: step.status === 200 ? 'OK' : 'Redirect',
        headers,
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
      })
    }),
  )
}

function parseResult(result: { content: readonly { type: string; text?: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('http-client tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(httpClientTool.name).toBe('http-client')
    })

    it('runs on server', () => {
      expect(httpClientTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(httpClientTool.permissions).toContain('net:http')
    })

    it('requires confirmation', () => {
      expect(httpClientTool.requiresConfirmation).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // request()
  // -------------------------------------------------------------------------

  describe('request()', () => {
    it('makes a GET request', async () => {
      mockFetchResponse('{"data":"hello"}', 200, { 'content-type': 'application/json' })
      const result = await httpClientTool.execute({
        action: 'request',
        url: 'https://api.example.com/data',
      })
      const parsed = parseResult(result)
      expect(parsed['status']).toBe(200)
      expect(parsed['body']).toBe('{"data":"hello"}')
    })

    it('makes a POST request with body', async () => {
      mockFetchResponse('{"created":true}', 201)
      const result = await httpClientTool.execute({
        action: 'request',
        url: 'https://api.example.com/items',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name":"test"}',
      })
      const parsed = parseResult(result)
      expect(parsed['status']).toBe(201)

      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      expect(fetchCall[1]).toMatchObject({ method: 'POST', body: '{"name":"test"}' })
    })

    it('follows redirects and validates each hop', async () => {
      mockFetchRedirectChain([
        { status: 302, location: 'https://redirected.example.com/' },
        { status: 200, body: 'final' },
      ])
      const result = await httpClientTool.execute({
        action: 'request',
        url: 'https://example.com',
      })
      const parsed = parseResult(result)
      expect(parsed['status']).toBe(200)
      expect(parsed['redirects']).toBeDefined()
    })

    it('handles non-OK responses', async () => {
      mockFetchResponse('Not Found', 404)
      const result = await httpClientTool.execute({
        action: 'request',
        url: 'https://api.example.com/missing',
      })
      const parsed = parseResult(result)
      expect(parsed['status']).toBe(404)
    })

    it('defaults method to GET', async () => {
      mockFetchResponse('ok')
      await httpClientTool.execute({
        action: 'request',
        url: 'https://example.com',
      })
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      expect(fetchCall[1]).toMatchObject({ method: 'GET' })
    })

    it('rejects empty url', async () => {
      await expect(
        httpClientTool.execute({ action: 'request', url: '' }),
      ).rejects.toThrow('non-empty "url"')
    })

    it('rejects invalid method', async () => {
      await expect(
        httpClientTool.execute({ action: 'request', url: 'https://example.com', method: 'HACK' }),
      ).rejects.toThrow('Invalid method')
    })

    it('rejects timeout exceeding max', async () => {
      await expect(
        httpClientTool.execute({ action: 'request', url: 'https://example.com', timeout: 999999 }),
      ).rejects.toThrow('timeout')
    })
  })

  // -------------------------------------------------------------------------
  // graphql()
  // -------------------------------------------------------------------------

  describe('graphql()', () => {
    it('sends a GraphQL query', async () => {
      mockFetchResponse('{"data":{"user":{"name":"Alice"}}}')
      const result = await httpClientTool.execute({
        action: 'graphql',
        url: 'https://api.example.com/graphql',
        query: '{ user { name } }',
      })
      const parsed = parseResult(result)
      expect(parsed['status']).toBe(200)

      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      const reqInit = fetchCall[1] as RequestInit
      expect(reqInit.method).toBe('POST')
      const bodyParsed = JSON.parse(reqInit.body as string) as Record<string, unknown>
      expect(bodyParsed['query']).toBe('{ user { name } }')
    })

    it('sends GraphQL with variables', async () => {
      mockFetchResponse('{"data":{}}')
      await httpClientTool.execute({
        action: 'graphql',
        url: 'https://api.example.com/graphql',
        query: 'query($id: ID!) { user(id: $id) { name } }',
        variables: { id: '123' },
      })
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      const bodyParsed = JSON.parse((fetchCall[1] as RequestInit).body as string) as Record<string, unknown>
      expect(bodyParsed['variables']).toEqual({ id: '123' })
    })

    it('sets Content-Type to application/json', async () => {
      mockFetchResponse('{}')
      await httpClientTool.execute({
        action: 'graphql',
        url: 'https://api.example.com/graphql',
        query: '{ users { id } }',
      })
      const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      const reqInit = fetchCall[1] as RequestInit
      const headers = reqInit.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('rejects empty query', async () => {
      await expect(
        httpClientTool.execute({ action: 'graphql', url: 'https://example.com', query: '' }),
      ).rejects.toThrow('non-empty "query"')
    })

    it('rejects missing url', async () => {
      await expect(
        httpClientTool.execute({ action: 'graphql', query: '{ users }' }),
      ).rejects.toThrow('non-empty "url"')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(httpClientTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(httpClientTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        httpClientTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects non-string body', async () => {
      await expect(
        httpClientTool.execute({ action: 'request', url: 'https://example.com', body: 123 }),
      ).rejects.toThrow('body must be a string')
    })

    it('rejects non-object headers', async () => {
      await expect(
        httpClientTool.execute({ action: 'request', url: 'https://example.com', headers: 'bad' }),
      ).rejects.toThrow('headers must be an object')
    })
  })

  // -------------------------------------------------------------------------
  // Exported helpers
  // -------------------------------------------------------------------------

  describe('validateRequestUrl()', () => {
    it('accepts https URL', () => {
      const parsed = validateRequestUrl('https://example.com')
      expect(parsed.hostname).toBe('example.com')
    })

    it('accepts http URL', () => {
      const parsed = validateRequestUrl('http://example.com')
      expect(parsed.hostname).toBe('example.com')
    })

    it('rejects file:// scheme', () => {
      expect(() => validateRequestUrl('file:///etc/passwd')).toThrow('Blocked URL scheme')
    })

    it('rejects data: scheme', () => {
      expect(() => validateRequestUrl('data:text/html,test')).toThrow('Blocked URL scheme')
    })

    it('rejects embedded credentials', () => {
      expect(() => validateRequestUrl('https://user:pass@example.com')).toThrow('embedded credentials')
    })

    it('rejects private hostname', () => {
      expect(() => validateRequestUrl('http://localhost:3000')).toThrow('Blocked private/internal')
    })
  })

  describe('isPrivateHostname()', () => {
    it('blocks localhost', () => expect(isPrivateHostname('localhost')).toBe(true))
    it('blocks 127.0.0.1', () => expect(isPrivateHostname('127.0.0.1')).toBe(true))
    it('blocks 10.x', () => expect(isPrivateHostname('10.0.0.1')).toBe(true))
    it('blocks 192.168.x', () => expect(isPrivateHostname('192.168.1.1')).toBe(true))
    it('blocks 172.16.x', () => expect(isPrivateHostname('172.16.0.1')).toBe(true))
    it('blocks ::1', () => expect(isPrivateHostname('::1')).toBe(true))
    it('blocks 169.254.x', () => expect(isPrivateHostname('169.254.1.1')).toBe(true))
    it('allows public hostname', () => expect(isPrivateHostname('example.com')).toBe(false))
    it('allows public IP', () => expect(isPrivateHostname('8.8.8.8')).toBe(false))
  })

  describe('parseArgs()', () => {
    it('parses request with defaults', () => {
      const result = parseArgs({ action: 'request', url: 'https://example.com' })
      expect(result).toMatchObject({
        action: 'request',
        url: 'https://example.com',
        method: 'GET',
      })
    })

    it('uppercases method', () => {
      const result = parseArgs({ action: 'request', url: 'https://example.com', method: 'post' })
      expect((result as { method: string }).method).toBe('POST')
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
      // http-client uses dynamic URLs — no hardcoded fetch URLs
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    describe('SSRF protection', () => {
      it('blocks localhost on request', async () => {
        await expect(
          httpClientTool.execute({ action: 'request', url: 'http://localhost:8080' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks 10.x on request', async () => {
        await expect(
          httpClientTool.execute({ action: 'request', url: 'http://10.0.0.1/admin' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks 192.168.x on graphql', async () => {
        await expect(
          httpClientTool.execute({ action: 'graphql', url: 'http://192.168.1.1/graphql', query: '{ x }' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks ::1 on request', async () => {
        await expect(
          httpClientTool.execute({ action: 'request', url: 'http://[::1]:3000' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks file:// scheme', async () => {
        await expect(
          httpClientTool.execute({ action: 'request', url: 'file:///etc/passwd' }),
        ).rejects.toThrow('Blocked URL scheme')
      })

      it('blocks data: scheme', async () => {
        await expect(
          httpClientTool.execute({ action: 'request', url: 'data:text/html,<h1>hi</h1>' }),
        ).rejects.toThrow('Blocked URL scheme')
      })

      it('blocks SSRF via redirect to private IP', async () => {
        mockFetchRedirectChain([
          { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
        ])
        await expect(
          httpClientTool.execute({ action: 'request', url: 'https://example.com' }),
        ).rejects.toThrow('Blocked private/internal')
      })

      it('blocks too many redirects', async () => {
        const chain = Array.from({ length: 6 }, (_, i) => ({
          status: 302,
          location: `https://hop${String(i + 1)}.com/`,
        }))
        mockFetchRedirectChain(chain)
        await expect(
          httpClientTool.execute({ action: 'request', url: 'https://start.com' }),
        ).rejects.toThrow('Too many redirects')
      })
    })

    describe('response limits', () => {
      it('has MAX_RESPONSE_SIZE constant', () => {
        expect(sourceCode).toContain('MAX_RESPONSE_SIZE')
      })

      it('has MAX_TIMEOUT constant', () => {
        expect(sourceCode).toContain('MAX_TIMEOUT')
      })

      it('has MAX_REDIRECTS constant', () => {
        expect(sourceCode).toContain('MAX_REDIRECTS')
      })
    })

    it('validates redirect targets for SSRF', () => {
      expect(sourceCode).toContain('validateRequestUrl')
      // Ensure redirect loop calls validateRequestUrl
      expect(sourceCode).toContain('SSRF validation on each redirect')
    })
  })
})
