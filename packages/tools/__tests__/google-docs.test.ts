import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { googleDocsTool, parseArgs, extractPlainText, _resetClient } from '../src/google-docs'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/google-docs.ts')
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

describe('google-docs tool', () => {
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
      expect(googleDocsTool.name).toBe('google-docs')
    })

    it('runs on server', () => {
      expect(googleDocsTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(googleDocsTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(googleDocsTool.permissions).toContain('net:http')
      expect(googleDocsTool.permissions).toContain('google:docs')
    })

    it('has action enum in parameters', () => {
      const actionProp = googleDocsTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual(['read', 'create', 'append', 'insert', 'replace'])
    })
  })

  // -------------------------------------------------------------------------
  // extractPlainText
  // -------------------------------------------------------------------------

  describe('extractPlainText()', () => {
    it('extracts text from nested document body', () => {
      const body = {
        content: [
          {
            paragraph: {
              elements: [
                { textRun: { content: 'Hello ' } },
                { textRun: { content: 'World' } },
              ],
            },
          },
          {
            paragraph: {
              elements: [
                { textRun: { content: '\nSecond paragraph' } },
              ],
            },
          },
        ],
      }
      expect(extractPlainText(body)).toBe('Hello World\nSecond paragraph')
    })

    it('returns empty string for undefined body', () => {
      expect(extractPlainText(undefined)).toBe('')
    })

    it('returns empty string for empty content', () => {
      expect(extractPlainText({ content: [] })).toBe('')
    })

    it('skips elements without textRun', () => {
      const body = {
        content: [
          {
            paragraph: {
              elements: [
                { textRun: { content: 'Text' } },
                {}, // e.g. an image or table reference
              ],
            },
          },
        ],
      }
      expect(extractPlainText(body)).toBe('Text')
    })

    it('handles paragraphs without elements', () => {
      const body = {
        content: [
          { paragraph: {} },
          { paragraph: { elements: [{ textRun: { content: 'After' } }] } },
        ],
      }
      expect(extractPlainText(body)).toBe('After')
    })

    it('handles structural elements without paragraph', () => {
      const body = {
        content: [
          {}, // e.g. a table
          { paragraph: { elements: [{ textRun: { content: 'Text' } }] } },
        ],
      }
      expect(extractPlainText(body)).toBe('Text')
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
      expect(() => parseArgs(42)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    // read
    it('parses read action', () => {
      expect(parseArgs({ action: 'read', documentId: 'abc123' })).toEqual({
        action: 'read', documentId: 'abc123',
      })
    })

    it('rejects read without documentId', () => {
      expect(() => parseArgs({ action: 'read' })).toThrow('non-empty "documentId"')
    })

    it('rejects documentId with invalid characters', () => {
      expect(() => parseArgs({ action: 'read', documentId: '../evil' })).toThrow('invalid characters')
    })

    // create
    it('parses create action', () => {
      expect(parseArgs({ action: 'create', title: 'My Doc' })).toEqual({
        action: 'create', title: 'My Doc', text: undefined,
      })
    })

    it('parses create with text', () => {
      expect(parseArgs({ action: 'create', title: 'My Doc', text: 'Hello' })).toEqual({
        action: 'create', title: 'My Doc', text: 'Hello',
      })
    })

    it('rejects create without title', () => {
      expect(() => parseArgs({ action: 'create' })).toThrow('non-empty "title"')
    })

    it('rejects create with text exceeding limit', () => {
      const longText = 'a'.repeat(100_001)
      expect(() => parseArgs({ action: 'create', title: 'Doc', text: longText })).toThrow('at most 100000')
    })

    // append
    it('parses append action', () => {
      expect(parseArgs({ action: 'append', documentId: 'abc', text: 'Hello' })).toEqual({
        action: 'append', documentId: 'abc', text: 'Hello',
      })
    })

    it('rejects append without text', () => {
      expect(() => parseArgs({ action: 'append', documentId: 'abc' })).toThrow('non-empty "text"')
    })

    it('rejects append with empty text', () => {
      expect(() => parseArgs({ action: 'append', documentId: 'abc', text: '' })).toThrow('non-empty "text"')
    })

    it('rejects append with text exceeding limit', () => {
      const longText = 'a'.repeat(100_001)
      expect(() => parseArgs({ action: 'append', documentId: 'abc', text: longText })).toThrow('at most 100000')
    })

    // insert
    it('parses insert action', () => {
      expect(parseArgs({ action: 'insert', documentId: 'abc', text: 'Hi', index: 5 })).toEqual({
        action: 'insert', documentId: 'abc', text: 'Hi', index: 5,
      })
    })

    it('rejects insert without index', () => {
      expect(() => parseArgs({ action: 'insert', documentId: 'abc', text: 'Hi' })).toThrow('positive integer "index"')
    })

    it('rejects insert with zero index', () => {
      expect(() => parseArgs({ action: 'insert', documentId: 'abc', text: 'Hi', index: 0 })).toThrow('positive integer "index"')
    })

    it('rejects insert with non-integer index', () => {
      expect(() => parseArgs({ action: 'insert', documentId: 'abc', text: 'Hi', index: 1.5 })).toThrow('positive integer "index"')
    })

    // replace
    it('parses replace action', () => {
      expect(parseArgs({ action: 'replace', documentId: 'abc', find: 'old', replace: 'new' })).toEqual({
        action: 'replace', documentId: 'abc', find: 'old', replace: 'new',
      })
    })

    it('rejects replace without find', () => {
      expect(() => parseArgs({ action: 'replace', documentId: 'abc', replace: 'new' })).toThrow('non-empty "find"')
    })

    it('rejects replace without replace string', () => {
      expect(() => parseArgs({ action: 'replace', documentId: 'abc', find: 'old' })).toThrow('"replace" string')
    })

    it('allows empty replace string (deletion)', () => {
      expect(parseArgs({ action: 'replace', documentId: 'abc', find: 'old', replace: '' })).toEqual({
        action: 'replace', documentId: 'abc', find: 'old', replace: '',
      })
    })
  })

  // -------------------------------------------------------------------------
  // Execution — read
  // -------------------------------------------------------------------------

  describe('execute read', () => {
    it('reads document and extracts plain text', async () => {
      mockFetchJson({
        documentId: 'doc1',
        title: 'Test Doc',
        body: {
          content: [{
            paragraph: {
              elements: [{ textRun: { content: 'Hello World' } }],
            },
          }],
        },
      })

      const result = await googleDocsTool.execute({ action: 'read', documentId: 'doc1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { documentId: string; title: string; text: string }

      expect(parsed.documentId).toBe('doc1')
      expect(parsed.title).toBe('Test Doc')
      expect(parsed.text).toBe('Hello World')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — create
  // -------------------------------------------------------------------------

  describe('execute create', () => {
    it('creates document without initial text', async () => {
      const mock = mockFetchJson({ documentId: 'newDoc', title: 'My Doc' })

      const result = await googleDocsTool.execute({ action: 'create', title: 'My Doc' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { documentId: string; title: string }

      expect(parsed.documentId).toBe('newDoc')
      expect(mock).toHaveBeenCalledTimes(1) // Only create, no batchUpdate
    })

    it('creates document with initial text (two API calls)', async () => {
      const mock = mockFetchSequence([
        { ok: true, status: 200, statusText: 'OK', data: { documentId: 'newDoc', title: 'My Doc' } },
        { ok: true, status: 200, statusText: 'OK', data: { replies: [] } },
      ])

      await googleDocsTool.execute({ action: 'create', title: 'My Doc', text: 'Initial content' })

      expect(mock).toHaveBeenCalledTimes(2)
      const secondCallUrl = (mock.mock.calls[1] as [string])[0]
      expect(secondCallUrl).toContain('batchUpdate')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — append
  // -------------------------------------------------------------------------

  describe('execute append', () => {
    it('appends text using batchUpdate with endOfSegmentLocation', async () => {
      const mock = mockFetchJson({ replies: [] })

      const result = await googleDocsTool.execute({ action: 'append', documentId: 'doc1', text: 'Appended text' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { documentId: string; appended: boolean }

      expect(parsed.appended).toBe(true)
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(callArgs[1].body as string) as { requests: Array<{ insertText: { endOfSegmentLocation: object } }> }
      expect(body.requests[0]?.insertText.endOfSegmentLocation).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // Execution — insert
  // -------------------------------------------------------------------------

  describe('execute insert', () => {
    it('inserts text at specified index', async () => {
      const mock = mockFetchJson({ replies: [] })

      const result = await googleDocsTool.execute({ action: 'insert', documentId: 'doc1', text: 'Inserted', index: 5 })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { documentId: string; inserted: boolean; index: number }

      expect(parsed.inserted).toBe(true)
      expect(parsed.index).toBe(5)
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(callArgs[1].body as string) as { requests: Array<{ insertText: { location: { index: number } } }> }
      expect(body.requests[0]?.insertText.location.index).toBe(5)
    })
  })

  // -------------------------------------------------------------------------
  // Execution — replace
  // -------------------------------------------------------------------------

  describe('execute replace', () => {
    it('replaces text using replaceAllText', async () => {
      const mock = mockFetchJson({
        replies: [{ replaceAllText: { occurrencesChanged: 3 } }],
      })

      const result = await googleDocsTool.execute({ action: 'replace', documentId: 'doc1', find: 'old', replace: 'new' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { documentId: string; replaced: boolean; occurrences: number }

      expect(parsed.replaced).toBe(true)
      expect(parsed.occurrences).toBe(3)
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(callArgs[1].body as string) as { requests: Array<{ replaceAllText: { containsText: { text: string }; replaceText: string } }> }
      expect(body.requests[0]?.replaceAllText.containsText.text).toBe('old')
      expect(body.requests[0]?.replaceAllText.replaceText).toBe('new')
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
        { ok: true, status: 200, statusText: 'OK', data: { documentId: 'doc1', title: 'Doc', body: { content: [] } } },
      ])

      const result = await googleDocsTool.execute({ action: 'read', documentId: 'doc1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { documentId: string }

      expect(parsed.documentId).toBe('doc1')
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
        'https://docs.googleapis.com',
      ])
    })
  })
})
