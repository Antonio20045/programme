/**
 * Google Sheets tool — read, write, append, create, list sheets, and clear ranges.
 * Uses spreadsheets scope for full read/write access.
 *
 * URL policy: Only requests to sheets.googleapis.com.
 * Security: Formula injection protection on all cell values written.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
import { createGoogleApiClient, type GoogleApiClient } from './google-api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const MAX_CELLS = 10_000
const SPREADSHEET_ID_REGEX = /^[a-zA-Z0-9_-]+$/
const RANGE_REGEX = /^[A-Za-z0-9!:_' ]+$/

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'sheets.googleapis.com',
])

// ---------------------------------------------------------------------------
// Formula injection protection
// ---------------------------------------------------------------------------

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n']

function sanitizeCellValue(value: unknown): string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const str = String(value)
  if (FORMULA_PREFIXES.some((p) => str.startsWith(p))) return `'${str}`
  return str
}

function sanitizeRows(values: unknown): (string | number | boolean)[][] {
  if (!Array.isArray(values)) {
    throw new Error('values must be a 2D array')
  }

  let cellCount = 0
  const sanitized: (string | number | boolean)[][] = []

  for (const row of values) {
    if (!Array.isArray(row)) {
      throw new Error('Each row in values must be an array')
    }
    const sanitizedRow: (string | number | boolean)[] = []
    for (const cell of row) {
      cellCount++
      if (cellCount > MAX_CELLS) {
        throw new Error(`values exceed the ${String(MAX_CELLS)} cell limit`)
      }
      sanitizedRow.push(sanitizeCellValue(cell))
    }
    sanitized.push(sanitizedRow)
  }

  return sanitized
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadArgs { readonly action: 'read'; readonly spreadsheetId: string; readonly range: string }
interface WriteArgs { readonly action: 'write'; readonly spreadsheetId: string; readonly range: string; readonly values: unknown }
interface AppendArgs { readonly action: 'append'; readonly spreadsheetId: string; readonly range: string; readonly values: unknown }
interface CreateArgs { readonly action: 'create'; readonly title: string; readonly sheetName?: string }
interface SheetsArgs { readonly action: 'sheets'; readonly spreadsheetId: string }
interface ClearArgs { readonly action: 'clear'; readonly spreadsheetId: string; readonly range: string }

type SheetToolArgs = ReadArgs | WriteArgs | AppendArgs | CreateArgs | SheetsArgs | ClearArgs

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function getAccessToken(): Promise<string> {
  const token = process.env['GOOGLE_ACCESS_TOKEN']
  if (token) return Promise.resolve(token)
  throw new Error('GOOGLE_ACCESS_TOKEN environment variable is required')
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: GoogleApiClient | undefined

function getClient(): GoogleApiClient {
  if (!client) {
    client = createGoogleApiClient({
      getAccessToken,
      allowedHosts: ALLOWED_HOSTS,
    })
  }
  return client
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateSpreadsheetId(id: string): void {
  if (!SPREADSHEET_ID_REGEX.test(id)) {
    throw new Error('spreadsheetId contains invalid characters')
  }
}

function validateRange(range: string): void {
  if (!RANGE_REGEX.test(range)) {
    throw new Error('range contains invalid characters')
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): SheetToolArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'read') {
    const spreadsheetId = obj['spreadsheetId']
    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
      throw new Error('read requires a non-empty "spreadsheetId" string')
    }
    validateSpreadsheetId(spreadsheetId.trim())
    const range = obj['range']
    if (typeof range !== 'string' || range.trim() === '') {
      throw new Error('read requires a non-empty "range" string')
    }
    validateRange(range.trim())
    return { action: 'read', spreadsheetId: spreadsheetId.trim(), range: range.trim() }
  }

  if (action === 'write') {
    const spreadsheetId = obj['spreadsheetId']
    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
      throw new Error('write requires a non-empty "spreadsheetId" string')
    }
    validateSpreadsheetId(spreadsheetId.trim())
    const range = obj['range']
    if (typeof range !== 'string' || range.trim() === '') {
      throw new Error('write requires a non-empty "range" string')
    }
    validateRange(range.trim())
    if (obj['values'] === undefined || obj['values'] === null) {
      throw new Error('write requires a "values" array')
    }
    return { action: 'write', spreadsheetId: spreadsheetId.trim(), range: range.trim(), values: obj['values'] }
  }

  if (action === 'append') {
    const spreadsheetId = obj['spreadsheetId']
    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
      throw new Error('append requires a non-empty "spreadsheetId" string')
    }
    validateSpreadsheetId(spreadsheetId.trim())
    const range = obj['range']
    if (typeof range !== 'string' || range.trim() === '') {
      throw new Error('append requires a non-empty "range" string')
    }
    validateRange(range.trim())
    if (obj['values'] === undefined || obj['values'] === null) {
      throw new Error('append requires a "values" array')
    }
    return { action: 'append', spreadsheetId: spreadsheetId.trim(), range: range.trim(), values: obj['values'] }
  }

  if (action === 'create') {
    const title = obj['title']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('create requires a non-empty "title" string')
    }
    const sheetName = typeof obj['sheetName'] === 'string' && obj['sheetName'].trim() !== ''
      ? obj['sheetName'].trim()
      : undefined
    return { action: 'create', title: title.trim(), sheetName }
  }

  if (action === 'sheets') {
    const spreadsheetId = obj['spreadsheetId']
    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
      throw new Error('sheets requires a non-empty "spreadsheetId" string')
    }
    validateSpreadsheetId(spreadsheetId.trim())
    return { action: 'sheets', spreadsheetId: spreadsheetId.trim() }
  }

  if (action === 'clear') {
    const spreadsheetId = obj['spreadsheetId']
    if (typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
      throw new Error('clear requires a non-empty "spreadsheetId" string')
    }
    validateSpreadsheetId(spreadsheetId.trim())
    const range = obj['range']
    if (typeof range !== 'string' || range.trim() === '') {
      throw new Error('clear requires a non-empty "range" string')
    }
    validateRange(range.trim())
    return { action: 'clear', spreadsheetId: spreadsheetId.trim(), range: range.trim() }
  }

  throw new Error(
    'action must be "read", "write", "append", "create", "sheets", or "clear"',
  )
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeRead(spreadsheetId: string, range: string): Promise<AgentToolResult> {
  const api = getClient()
  const encodedId = encodeURIComponent(spreadsheetId)
  const encodedRange = encodeURIComponent(range)
  const result = await api.get(`${API_BASE}/${encodedId}/values/${encodedRange}`)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeWrite(spreadsheetId: string, range: string, values: unknown): Promise<AgentToolResult> {
  const api = getClient()
  const sanitized = sanitizeRows(values)
  const encodedId = encodeURIComponent(spreadsheetId)
  const encodedRange = encodeURIComponent(range)
  const result = await api.put(
    `${API_BASE}/${encodedId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    { range, values: sanitized },
  )
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeAppend(spreadsheetId: string, range: string, values: unknown): Promise<AgentToolResult> {
  const api = getClient()
  const sanitized = sanitizeRows(values)
  const encodedId = encodeURIComponent(spreadsheetId)
  const encodedRange = encodeURIComponent(range)
  const result = await api.post(
    `${API_BASE}/${encodedId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`,
    { range, values: sanitized },
  )
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeCreate(title: string, sheetName?: string): Promise<AgentToolResult> {
  const api = getClient()
  const body: Record<string, unknown> = {
    properties: { title },
  }
  if (sheetName) {
    body['sheets'] = [{ properties: { title: sheetName } }]
  }
  const result = await api.post(API_BASE, body)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeSheets(spreadsheetId: string): Promise<AgentToolResult> {
  const api = getClient()
  const encodedId = encodeURIComponent(spreadsheetId)
  const result = await api.get(`${API_BASE}/${encodedId}`, {
    fields: 'sheets.properties',
  })
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeClear(spreadsheetId: string, range: string): Promise<AgentToolResult> {
  const api = getClient()
  const encodedId = encodeURIComponent(spreadsheetId)
  const encodedRange = encodeURIComponent(range)
  const result = await api.post(`${API_BASE}/${encodedId}/values/${encodedRange}:clear`)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const sheetsParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform: read, write, append, create, sheets, or clear',
      enum: ['read', 'write', 'append', 'create', 'sheets', 'clear'],
    },
    spreadsheetId: {
      type: 'string',
      description: 'Google Sheets spreadsheet ID',
    },
    range: {
      type: 'string',
      description: 'Cell range in A1 notation e.g. "Sheet1!A1:B10"',
    },
    values: {
      type: 'array',
      description: '2D array of cell values (write, append — max 10,000 cells)',
      items: {
        type: 'array',
        description: 'Row of cell values',
        items: { type: 'string' },
      },
    },
    title: {
      type: 'string',
      description: 'Spreadsheet title (create)',
    },
    sheetName: {
      type: 'string',
      description: 'Initial sheet name (create, default "Sheet1")',
    },
  },
  required: ['action'],
}

export const googleSheetsTool: ExtendedAgentTool = {
  name: 'google-sheets',
  description:
    'Read and write Google Sheets. Actions: read(spreadsheetId, range), write(spreadsheetId, range, values), append(spreadsheetId, range, values), create(title, sheetName?), sheets(spreadsheetId), clear(spreadsheetId, range). Formula injection protection on all writes. Confirmation required.',
  parameters: sheetsParameters,
  permissions: ['net:http', 'google:sheets'],
  requiresConfirmation: true,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'read':
        return executeRead(parsed.spreadsheetId, parsed.range)
      case 'write':
        return executeWrite(parsed.spreadsheetId, parsed.range, parsed.values)
      case 'append':
        return executeAppend(parsed.spreadsheetId, parsed.range, parsed.values)
      case 'create':
        return executeCreate(parsed.title, parsed.sheetName)
      case 'sheets':
        return executeSheets(parsed.spreadsheetId)
      case 'clear':
        return executeClear(parsed.spreadsheetId, parsed.range)
    }
  },
}

export { parseArgs, sanitizeCellValue, sanitizeRows }

/** Test-only: resets the client instance. */
export function _resetClient(): void {
  client = undefined
}
