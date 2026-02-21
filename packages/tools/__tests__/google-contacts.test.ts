import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { googleContactsTool, parseArgs, _resetClient } from '../src/google-contacts'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/google-contacts.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; statusText: string; data?: unknown }>): ReturnType<typeof vi.fn> {
  const queue = [...responses]
  const mock = vi.fn().mockImplementation(() => {
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
  vi.stubGlobal('fetch', mock)
  return mock
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('google-contacts tool', () => {
  beforeEach(() => {
    _resetClient()
    vi.stubEnv('GOOGLE_ACCESS_TOKEN', 'test-access-token')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'test-refresh-token')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
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
      expect(googleContactsTool.name).toBe('google-contacts')
    })

    it('runs on server', () => {
      expect(googleContactsTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(googleContactsTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(googleContactsTool.permissions).toContain('net:http')
      expect(googleContactsTool.permissions).toContain('google:contacts')
    })

    it('has action enum in parameters', () => {
      const actionProp = googleContactsTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual(['search', 'get', 'list', 'groups'])
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects non-object args', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    it('parses search action', () => {
      const result = parseArgs({ action: 'search', query: 'John' })
      expect(result).toEqual({ action: 'search', query: 'John' })
    })

    it('rejects search without query', () => {
      expect(() => parseArgs({ action: 'search' })).toThrow('non-empty "query"')
    })

    it('rejects search with empty query', () => {
      expect(() => parseArgs({ action: 'search', query: '' })).toThrow('non-empty "query"')
    })

    it('parses get action', () => {
      const result = parseArgs({ action: 'get', resourceName: 'people/c123' })
      expect(result).toEqual({ action: 'get', resourceName: 'people/c123' })
    })

    it('rejects get without resourceName', () => {
      expect(() => parseArgs({ action: 'get' })).toThrow('non-empty "resourceName"')
    })

    it('parses list action with defaults', () => {
      const result = parseArgs({ action: 'list' })
      expect(result).toEqual({ action: 'list', pageSize: 25, pageToken: undefined })
    })

    it('parses list action with custom pageSize', () => {
      const result = parseArgs({ action: 'list', pageSize: 50 })
      expect(result).toEqual({ action: 'list', pageSize: 50, pageToken: undefined })
    })

    it('caps pageSize at 100', () => {
      const result = parseArgs({ action: 'list', pageSize: 200 })
      expect(result).toEqual({ action: 'list', pageSize: 100, pageToken: undefined })
    })

    it('rejects invalid pageSize', () => {
      expect(() => parseArgs({ action: 'list', pageSize: -1 })).toThrow('positive integer')
    })

    it('rejects non-integer pageSize', () => {
      expect(() => parseArgs({ action: 'list', pageSize: 3.5 })).toThrow('positive integer')
    })

    it('parses list with pageToken', () => {
      const result = parseArgs({ action: 'list', pageToken: 'abc123' })
      expect(result).toEqual({ action: 'list', pageSize: 25, pageToken: 'abc123' })
    })

    it('parses groups action', () => {
      const result = parseArgs({ action: 'groups' })
      expect(result).toEqual({ action: 'groups' })
    })
  })

  // -------------------------------------------------------------------------
  // Execution — search
  // -------------------------------------------------------------------------

  describe('execute search', () => {
    it('calls People API searchContacts endpoint', async () => {
      const mock = mockFetchJson({ results: [{ person: { names: [{ displayName: 'John' }] } }] })

      const result = await googleContactsTool.execute({ action: 'search', query: 'John' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { results: unknown[] }

      expect(parsed.results).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('people.googleapis.com')
      expect(callUrl).toContain('searchContacts')
      expect(callUrl).toContain('query=John')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — get
  // -------------------------------------------------------------------------

  describe('execute get', () => {
    it('calls People API get endpoint', async () => {
      const mock = mockFetchJson({
        resourceName: 'people/c123',
        names: [{ displayName: 'Jane Doe' }],
        emailAddresses: [{ value: 'jane@example.com' }],
      })

      const result = await googleContactsTool.execute({ action: 'get', resourceName: 'people/c123' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { resourceName: string }

      expect(parsed.resourceName).toBe('people/c123')
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('people/c123')
      expect(callUrl).toContain('personFields=')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — list
  // -------------------------------------------------------------------------

  describe('execute list', () => {
    it('calls People API connections endpoint', async () => {
      const mock = mockFetchJson({
        connections: [{ resourceName: 'people/c1' }],
        totalPeople: 1,
      })

      const result = await googleContactsTool.execute({ action: 'list' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { connections: unknown[] }

      expect(parsed.connections).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('people/me/connections')
      expect(callUrl).toContain('pageSize=25')
    })

    it('passes pageToken when provided', async () => {
      const mock = mockFetchJson({ connections: [] })

      await googleContactsTool.execute({ action: 'list', pageToken: 'next-page' })

      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('pageToken=next-page')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — groups
  // -------------------------------------------------------------------------

  describe('execute groups', () => {
    it('calls People API contactGroups endpoint', async () => {
      const mock = mockFetchJson({
        contactGroups: [{ name: 'Family', resourceName: 'contactGroups/abc' }],
      })

      const result = await googleContactsTool.execute({ action: 'groups' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { contactGroups: unknown[] }

      expect(parsed.contactGroups).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('contactGroups')
    })
  })

  // -------------------------------------------------------------------------
  // Token refresh on 401
  // -------------------------------------------------------------------------

  describe('token refresh', () => {
    it('refreshes token and retries on 401', async () => {
      const mock = mockFetchSequence([
        { ok: false, status: 401, statusText: 'Unauthorized' },
        { ok: true, status: 200, statusText: 'OK', data: { access_token: 'new-token', expires_in: 3600 } },
        { ok: true, status: 200, statusText: 'OK', data: { contactGroups: [] } },
      ])

      const result = await googleContactsTool.execute({ action: 'groups' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { contactGroups: unknown[] }

      expect(parsed.contactGroups).toEqual([])
      expect(mock).toHaveBeenCalledTimes(3)
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
        'https://people.googleapis.com',
      ])
    })
  })
})
