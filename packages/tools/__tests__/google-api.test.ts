import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { createGoogleApiClient, validateUrl } from '../src/google-api'
import type { GoogleApiClient, GoogleApiConfig } from '../src/google-api'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/google-api.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'people.googleapis.com',
  'tasks.googleapis.com',
])

function createMockFetch(responses: Array<{ ok: boolean; status: number; statusText: string; data?: unknown }>): ReturnType<typeof vi.fn> {
  const queue = [...responses]
  return vi.fn().mockImplementation(() => {
    const resp = queue.shift() ?? { ok: true, status: 200, statusText: 'OK', data: {} }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: () => Promise.resolve(resp.data ?? {}),
      text: () => Promise.resolve(JSON.stringify(resp.data ?? {})),
      headers: new Headers(),
    })
  })
}

function setupEnv(): void {
  vi.stubEnv('GOOGLE_ACCESS_TOKEN', 'test-access-token')
  vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'test-refresh-token')
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
}

function createTestClient(overrides?: Partial<GoogleApiConfig>): GoogleApiClient {
  const config: GoogleApiConfig = {
    getAccessToken: overrides?.getAccessToken ?? (() => Promise.resolve('test-access-token')),
    allowedHosts: overrides?.allowedHosts ?? ALLOWED_HOSTS,
    timeoutMs: overrides?.timeoutMs ?? 5_000,
  }
  return createGoogleApiClient(config)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('google-api shared helper', () => {
  beforeEach(() => {
    setupEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // validateUrl
  // -------------------------------------------------------------------------

  describe('validateUrl()', () => {
    it('accepts allowed host', () => {
      const parsed = validateUrl('https://people.googleapis.com/v1/people', ALLOWED_HOSTS)
      expect(parsed.hostname).toBe('people.googleapis.com')
    })

    it('accepts oauth2.googleapis.com automatically', () => {
      const parsed = validateUrl('https://oauth2.googleapis.com/token', ALLOWED_HOSTS)
      expect(parsed.hostname).toBe('oauth2.googleapis.com')
    })

    it('rejects non-allowed host', () => {
      expect(() => validateUrl('https://evil.com/api', ALLOWED_HOSTS)).toThrow('not in the allowed hosts')
    })

    it('rejects http scheme', () => {
      expect(() => validateUrl('http://people.googleapis.com/v1', ALLOWED_HOSTS)).toThrow('only https:')
    })

    it('rejects invalid URL', () => {
      expect(() => validateUrl('not-a-url', ALLOWED_HOSTS)).toThrow('Invalid URL')
    })

    it('rejects javascript: scheme', () => {
      // eslint-disable-next-line no-script-url
      expect(() => validateUrl('javascript:alert(1)', ALLOWED_HOSTS)).toThrow('only https:')
    })

    it('rejects file: scheme', () => {
      expect(() => validateUrl('file:///etc/passwd', ALLOWED_HOSTS)).toThrow('only https:')
    })
  })

  // -------------------------------------------------------------------------
  // GET requests
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('sends GET request with Bearer token', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: { items: [] } },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      const result = await client.get('https://people.googleapis.com/v1/people')

      expect(result).toEqual({ items: [] })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[0]).toBe('https://people.googleapis.com/v1/people')
      const headers = callArgs[1].headers as Headers
      expect(headers.get('Authorization')).toBe('Bearer test-access-token')
    })

    it('appends query params', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: { results: [] } },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await client.get('https://people.googleapis.com/v1/people', { query: 'test', pageSize: '10' })

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[0]).toContain('query=test')
      expect(callArgs[0]).toContain('pageSize=10')
    })
  })

  // -------------------------------------------------------------------------
  // POST requests
  // -------------------------------------------------------------------------

  describe('post()', () => {
    it('sends POST with JSON body', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: { id: '123' } },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      const result = await client.post('https://tasks.googleapis.com/tasks/v1/users/@me/lists', { title: 'My List' })

      expect(result).toEqual({ id: '123' })
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('POST')
      expect(callArgs[1].body).toBe(JSON.stringify({ title: 'My List' }))
    })

    it('sends POST without body', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: {} },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await client.post('https://tasks.googleapis.com/tasks/v1/clear')

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('POST')
      expect(callArgs[1].body).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // PUT / PATCH / DELETE
  // -------------------------------------------------------------------------

  describe('put()', () => {
    it('sends PUT with JSON body', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: { updated: true } },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await client.put('https://tasks.googleapis.com/tasks/v1/lists/abc/tasks/123', { title: 'Updated' })

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('PUT')
    })
  })

  describe('patch()', () => {
    it('sends PATCH with JSON body', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: { patched: true } },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await client.patch('https://tasks.googleapis.com/tasks/v1/lists/abc/tasks/123', { status: 'completed' })

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('PATCH')
    })
  })

  describe('del()', () => {
    it('sends DELETE request', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 204, statusText: 'No Content' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await client.del('https://tasks.googleapis.com/tasks/v1/lists/abc/tasks/123')

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('DELETE')
    })
  })

  // -------------------------------------------------------------------------
  // rawFetch
  // -------------------------------------------------------------------------

  describe('rawFetch()', () => {
    it('returns raw Response object', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: 'raw-data' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      const response = await client.rawFetch('https://people.googleapis.com/v1/download')

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
    })

    it('passes custom RequestInit', async () => {
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await client.rawFetch('https://people.googleapis.com/v1/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: 'file-data',
      })

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('POST')
      expect(callArgs[1].body).toBe('file-data')
    })
  })

  // -------------------------------------------------------------------------
  // Token caching
  // -------------------------------------------------------------------------

  describe('token caching', () => {
    it('caches the token after first call', async () => {
      const getAccessToken = vi.fn().mockResolvedValue('cached-token')
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: {} },
        { ok: true, status: 200, statusText: 'OK', data: {} },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient({ getAccessToken })
      await client.get('https://people.googleapis.com/v1/a')
      await client.get('https://people.googleapis.com/v1/b')

      expect(getAccessToken).toHaveBeenCalledTimes(1)
    })

    it('_resetTokenCache clears the cached token', async () => {
      const getAccessToken = vi.fn().mockResolvedValue('fresh-token')
      const mockFetch = createMockFetch([
        { ok: true, status: 200, statusText: 'OK', data: {} },
        { ok: true, status: 200, statusText: 'OK', data: {} },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient({ getAccessToken })
      await client.get('https://people.googleapis.com/v1/a')
      client._resetTokenCache()
      await client.get('https://people.googleapis.com/v1/b')

      expect(getAccessToken).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // 401 → token refresh → retry
  // -------------------------------------------------------------------------

  describe('401 token refresh', () => {
    it('refreshes token and retries on 401', async () => {
      const mockFetch = createMockFetch([
        { ok: false, status: 401, statusText: 'Unauthorized' },
        // Token refresh call
        { ok: true, status: 200, statusText: 'OK', data: { access_token: 'new-token', expires_in: 3600 } },
        // Retry call
        { ok: true, status: 200, statusText: 'OK', data: { success: true } },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      const result = await client.get('https://people.googleapis.com/v1/people')

      expect(result).toEqual({ success: true })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('throws if retry after refresh also fails', async () => {
      const mockFetch = createMockFetch([
        { ok: false, status: 401, statusText: 'Unauthorized' },
        // Token refresh
        { ok: true, status: 200, statusText: 'OK', data: { access_token: 'new-token', expires_in: 3600 } },
        // Retry also fails
        { ok: false, status: 403, statusText: 'Forbidden' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await expect(client.get('https://people.googleapis.com/v1/people')).rejects.toThrow('Missing scope')
    })
  })

  // -------------------------------------------------------------------------
  // Error mapping
  // -------------------------------------------------------------------------

  describe('error mapping', () => {
    it('maps 403 to scope error', async () => {
      const mockFetch = createMockFetch([
        { ok: false, status: 403, statusText: 'Forbidden' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await expect(client.get('https://people.googleapis.com/v1/people')).rejects.toThrow('Missing scope')
    })

    it('maps 429 to rate limit error', async () => {
      const mockFetch = createMockFetch([
        { ok: false, status: 429, statusText: 'Too Many Requests' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await expect(client.get('https://people.googleapis.com/v1/people')).rejects.toThrow('Rate limit')
    })

    it('maps other errors to generic message', async () => {
      const mockFetch = createMockFetch([
        { ok: false, status: 500, statusText: 'Internal Server Error' },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const client = createTestClient()
      await expect(client.get('https://people.googleapis.com/v1/people')).rejects.toThrow('Google API error: 500')
    })
  })

  // -------------------------------------------------------------------------
  // URL validation in client methods
  // -------------------------------------------------------------------------

  describe('URL validation in requests', () => {
    it('rejects requests to non-allowed hosts', async () => {
      const client = createTestClient()
      await expect(client.get('https://evil.com/steal')).rejects.toThrow('not in the allowed hosts')
    })

    it('rejects http URLs', async () => {
      const client = createTestClient()
      await expect(client.get('http://people.googleapis.com/v1/people')).rejects.toThrow('only https:')
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
      assertNoUnauthorizedFetch(sourceCode, [
        'https://oauth2.googleapis.com',
      ])
    })
  })
})
