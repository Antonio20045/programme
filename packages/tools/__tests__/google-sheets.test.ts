import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { googleSheetsTool, parseArgs, sanitizeCellValue, sanitizeRows, _resetClient } from '../src/google-sheets'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/google-sheets.ts')
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

describe('google-sheets tool', () => {
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
      expect(googleSheetsTool.name).toBe('google-sheets')
    })

    it('runs on server', () => {
      expect(googleSheetsTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(googleSheetsTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(googleSheetsTool.permissions).toContain('net:http')
      expect(googleSheetsTool.permissions).toContain('google:sheets')
    })

    it('has action enum in parameters', () => {
      const actionProp = googleSheetsTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual(['read', 'write', 'append', 'create', 'sheets', 'clear'])
    })
  })

  // -------------------------------------------------------------------------
  // Formula injection protection
  // -------------------------------------------------------------------------

  describe('sanitizeCellValue()', () => {
    it('passes through numbers', () => {
      expect(sanitizeCellValue(42)).toBe(42)
      expect(sanitizeCellValue(3.14)).toBe(3.14)
    })

    it('passes through booleans', () => {
      expect(sanitizeCellValue(true)).toBe(true)
      expect(sanitizeCellValue(false)).toBe(false)
    })

    it('passes through safe strings', () => {
      expect(sanitizeCellValue('Hello World')).toBe('Hello World')
    })

    it('escapes = prefix (formula)', () => {
      expect(sanitizeCellValue('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
    })

    it('escapes + prefix', () => {
      expect(sanitizeCellValue('+cmd|something')).toBe("'+cmd|something")
    })

    it('escapes - prefix', () => {
      expect(sanitizeCellValue('-cmd|something')).toBe("'-cmd|something")
    })

    it('escapes @ prefix', () => {
      expect(sanitizeCellValue('@SUM(A1)')).toBe("'@SUM(A1)")
    })

    it('escapes tab prefix', () => {
      expect(sanitizeCellValue('\tcmd')).toBe("'\tcmd")
    })

    it('escapes carriage return prefix', () => {
      expect(sanitizeCellValue('\rcmd')).toBe("'\rcmd")
    })

    it('escapes newline prefix', () => {
      expect(sanitizeCellValue('\ncmd')).toBe("'\ncmd")
    })

    it('converts non-string/number/boolean to string', () => {
      expect(sanitizeCellValue(null)).toBe('null')
      expect(sanitizeCellValue(undefined)).toBe('undefined')
    })
  })

  describe('sanitizeRows()', () => {
    it('sanitizes a 2D array', () => {
      const result = sanitizeRows([['Hello', '=EVIL'], [42, true]])
      expect(result).toEqual([['Hello', "'=EVIL"], [42, true]])
    })

    it('rejects non-array values', () => {
      expect(() => sanitizeRows('not an array')).toThrow('2D array')
    })

    it('rejects non-array rows', () => {
      expect(() => sanitizeRows(['not a row'])).toThrow('Each row')
    })

    it('rejects values exceeding 10,000 cells', () => {
      // 101 rows * 100 cols = 10,100 cells
      const bigValues = Array.from({ length: 101 }, () => Array.from({ length: 100 }, () => 'x'))
      expect(() => sanitizeRows(bigValues)).toThrow('10000 cell limit')
    })

    it('accepts exactly 10,000 cells', () => {
      const values = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 'x'))
      expect(() => sanitizeRows(values)).not.toThrow()
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

    // read
    it('parses read action', () => {
      expect(parseArgs({ action: 'read', spreadsheetId: 'abc', range: 'Sheet1!A1:B10' })).toEqual({
        action: 'read', spreadsheetId: 'abc', range: 'Sheet1!A1:B10',
      })
    })

    it('rejects read without spreadsheetId', () => {
      expect(() => parseArgs({ action: 'read', range: 'A1' })).toThrow('non-empty "spreadsheetId"')
    })

    it('rejects read without range', () => {
      expect(() => parseArgs({ action: 'read', spreadsheetId: 'abc' })).toThrow('non-empty "range"')
    })

    it('rejects spreadsheetId with invalid characters', () => {
      expect(() => parseArgs({ action: 'read', spreadsheetId: '../evil', range: 'A1' })).toThrow('invalid characters')
    })

    it('rejects range with invalid characters', () => {
      expect(() => parseArgs({ action: 'read', spreadsheetId: 'abc', range: 'A1;DROP' })).toThrow('invalid characters')
    })

    // write
    it('parses write action', () => {
      const result = parseArgs({ action: 'write', spreadsheetId: 'abc', range: 'A1', values: [['x']] })
      expect(result).toHaveProperty('action', 'write')
    })

    it('rejects write without values', () => {
      expect(() => parseArgs({ action: 'write', spreadsheetId: 'abc', range: 'A1' })).toThrow('"values" array')
    })

    // append
    it('parses append action', () => {
      const result = parseArgs({ action: 'append', spreadsheetId: 'abc', range: 'A1', values: [['x']] })
      expect(result).toHaveProperty('action', 'append')
    })

    it('rejects append without values', () => {
      expect(() => parseArgs({ action: 'append', spreadsheetId: 'abc', range: 'A1' })).toThrow('"values" array')
    })

    // create
    it('parses create action', () => {
      expect(parseArgs({ action: 'create', title: 'My Sheet' })).toEqual({
        action: 'create', title: 'My Sheet', sheetName: undefined,
      })
    })

    it('parses create with sheetName', () => {
      expect(parseArgs({ action: 'create', title: 'My Sheet', sheetName: 'Data' })).toEqual({
        action: 'create', title: 'My Sheet', sheetName: 'Data',
      })
    })

    it('rejects create without title', () => {
      expect(() => parseArgs({ action: 'create' })).toThrow('non-empty "title"')
    })

    // sheets
    it('parses sheets action', () => {
      expect(parseArgs({ action: 'sheets', spreadsheetId: 'abc' })).toEqual({
        action: 'sheets', spreadsheetId: 'abc',
      })
    })

    it('rejects sheets without spreadsheetId', () => {
      expect(() => parseArgs({ action: 'sheets' })).toThrow('non-empty "spreadsheetId"')
    })

    // clear
    it('parses clear action', () => {
      expect(parseArgs({ action: 'clear', spreadsheetId: 'abc', range: 'A1:B10' })).toEqual({
        action: 'clear', spreadsheetId: 'abc', range: 'A1:B10',
      })
    })

    it('rejects clear without range', () => {
      expect(() => parseArgs({ action: 'clear', spreadsheetId: 'abc' })).toThrow('non-empty "range"')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — read
  // -------------------------------------------------------------------------

  describe('execute read', () => {
    it('calls Sheets values endpoint', async () => {
      const mock = mockFetchJson({ range: 'Sheet1!A1:B2', values: [['a', 'b'], ['c', 'd']] })

      const result = await googleSheetsTool.execute({ action: 'read', spreadsheetId: 'abc', range: 'Sheet1!A1:B2' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { values: string[][] }

      expect(parsed.values).toEqual([['a', 'b'], ['c', 'd']])
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('spreadsheets/abc/values/')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — write
  // -------------------------------------------------------------------------

  describe('execute write', () => {
    it('writes values with USER_ENTERED and sanitized data', async () => {
      const mock = mockFetchJson({ updatedCells: 4 })

      await googleSheetsTool.execute({
        action: 'write', spreadsheetId: 'abc', range: 'A1',
        values: [['Hello', '=EVIL'], [42, true]],
      })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[0]).toContain('valueInputOption=USER_ENTERED')
      expect(callArgs[1].method).toBe('PUT')
      const body = JSON.parse(callArgs[1].body as string) as { values: unknown[][] }
      // Formula should be escaped
      expect(body.values[0]?.[1]).toBe("'=EVIL")
      // Numbers and booleans pass through
      expect(body.values[1]?.[0]).toBe(42)
      expect(body.values[1]?.[1]).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Execution — append
  // -------------------------------------------------------------------------

  describe('execute append', () => {
    it('appends values with sanitization', async () => {
      const mock = mockFetchJson({ updates: { updatedCells: 2 } })

      await googleSheetsTool.execute({
        action: 'append', spreadsheetId: 'abc', range: 'A1',
        values: [['+cmd', 'safe']],
      })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[0]).toContain(':append')
      expect(callArgs[0]).toContain('valueInputOption=USER_ENTERED')
      expect(callArgs[1].method).toBe('POST')
      const body = JSON.parse(callArgs[1].body as string) as { values: unknown[][] }
      expect(body.values[0]?.[0]).toBe("'+cmd")
    })
  })

  // -------------------------------------------------------------------------
  // Execution — create
  // -------------------------------------------------------------------------

  describe('execute create', () => {
    it('creates spreadsheet', async () => {
      const mock = mockFetchJson({ spreadsheetId: 'new123', properties: { title: 'Test' } })

      const result = await googleSheetsTool.execute({ action: 'create', title: 'Test' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { spreadsheetId: string }

      expect(parsed.spreadsheetId).toBe('new123')
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('POST')
      const body = JSON.parse(callArgs[1].body as string) as { properties: { title: string } }
      expect(body.properties.title).toBe('Test')
    })

    it('creates spreadsheet with custom sheet name', async () => {
      const mock = mockFetchJson({ spreadsheetId: 'new123' })

      await googleSheetsTool.execute({ action: 'create', title: 'Test', sheetName: 'Data' })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(callArgs[1].body as string) as { sheets?: Array<{ properties: { title: string } }> }
      expect(body.sheets?.[0]?.properties.title).toBe('Data')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — sheets
  // -------------------------------------------------------------------------

  describe('execute sheets', () => {
    it('lists sheet properties', async () => {
      const mock = mockFetchJson({
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      })

      const result = await googleSheetsTool.execute({ action: 'sheets', spreadsheetId: 'abc' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { sheets: unknown[] }

      expect(parsed.sheets).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('fields=sheets.properties')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — clear
  // -------------------------------------------------------------------------

  describe('execute clear', () => {
    it('clears a range via POST', async () => {
      const mock = mockFetchJson({ clearedRange: 'Sheet1!A1:B10' })

      const result = await googleSheetsTool.execute({ action: 'clear', spreadsheetId: 'abc', range: 'A1:B10' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { clearedRange: string }

      expect(parsed.clearedRange).toBe('Sheet1!A1:B10')
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[0]).toContain(':clear')
      expect(callArgs[1].method).toBe('POST')
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
        { ok: true, status: 200, statusText: 'OK', data: { values: [] } },
      ])

      const result = await googleSheetsTool.execute({ action: 'read', spreadsheetId: 'abc', range: 'A1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { values: unknown[] }

      expect(parsed.values).toEqual([])
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
        'https://sheets.googleapis.com',
      ])
    })
  })
})
