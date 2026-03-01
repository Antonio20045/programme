/**
 * Google Docs tool — read, create, append, insert, and replace text in documents.
 * Uses documents scope for full read/write access.
 *
 * URL policy: Only requests to docs.googleapis.com.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
import { createGoogleApiClient, type GoogleApiClient } from './google-api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://docs.googleapis.com/v1/documents'
const MAX_TEXT_LENGTH = 100_000
const MAX_REPLACEMENTS = 1_000
const DOCUMENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'docs.googleapis.com',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadArgs { readonly action: 'read'; readonly documentId: string }
interface CreateArgs { readonly action: 'create'; readonly title: string; readonly text?: string }
interface AppendArgs { readonly action: 'append'; readonly documentId: string; readonly text: string }
interface InsertArgs { readonly action: 'insert'; readonly documentId: string; readonly text: string; readonly index: number }
interface ReplaceArgs { readonly action: 'replace'; readonly documentId: string; readonly find: string; readonly replace: string }

type DocsArgs = ReadArgs | CreateArgs | AppendArgs | InsertArgs | ReplaceArgs

// Google Docs API response types
interface TextRun {
  readonly content?: string
}

interface ParagraphElement {
  readonly textRun?: TextRun
}

interface Paragraph {
  readonly elements?: readonly ParagraphElement[]
}

interface StructuralElement {
  readonly paragraph?: Paragraph
}

interface DocumentBody {
  readonly content?: readonly StructuralElement[]
}

interface DocumentResponse {
  readonly documentId?: string
  readonly title?: string
  readonly body?: DocumentBody
}

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

function validateDocumentId(documentId: string): void {
  if (!DOCUMENT_ID_REGEX.test(documentId)) {
    throw new Error('documentId contains invalid characters')
  }
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

function extractPlainText(body: DocumentBody | undefined): string {
  if (!body?.content) return ''

  const parts: string[] = []
  for (const element of body.content) {
    if (element.paragraph?.elements) {
      for (const pe of element.paragraph.elements) {
        if (pe.textRun?.content) {
          parts.push(pe.textRun.content)
        }
      }
    }
  }
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): DocsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'read') {
    const documentId = obj['documentId']
    if (typeof documentId !== 'string' || documentId.trim() === '') {
      throw new Error('read requires a non-empty "documentId" string')
    }
    validateDocumentId(documentId.trim())
    return { action: 'read', documentId: documentId.trim() }
  }

  if (action === 'create') {
    const title = obj['title']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('create requires a non-empty "title" string')
    }
    const text = typeof obj['text'] === 'string' ? obj['text'] : undefined
    if (text !== undefined && text.length > MAX_TEXT_LENGTH) {
      throw new Error(`text must be at most ${String(MAX_TEXT_LENGTH)} characters`)
    }
    return { action: 'create', title: title.trim(), text }
  }

  if (action === 'append') {
    const documentId = obj['documentId']
    if (typeof documentId !== 'string' || documentId.trim() === '') {
      throw new Error('append requires a non-empty "documentId" string')
    }
    validateDocumentId(documentId.trim())
    const text = obj['text']
    if (typeof text !== 'string' || text === '') {
      throw new Error('append requires a non-empty "text" string')
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error(`text must be at most ${String(MAX_TEXT_LENGTH)} characters`)
    }
    return { action: 'append', documentId: documentId.trim(), text }
  }

  if (action === 'insert') {
    const documentId = obj['documentId']
    if (typeof documentId !== 'string' || documentId.trim() === '') {
      throw new Error('insert requires a non-empty "documentId" string')
    }
    validateDocumentId(documentId.trim())
    const text = obj['text']
    if (typeof text !== 'string' || text === '') {
      throw new Error('insert requires a non-empty "text" string')
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error(`text must be at most ${String(MAX_TEXT_LENGTH)} characters`)
    }
    const index = obj['index']
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) {
      throw new Error('insert requires a positive integer "index"')
    }
    return { action: 'insert', documentId: documentId.trim(), text, index }
  }

  if (action === 'replace') {
    const documentId = obj['documentId']
    if (typeof documentId !== 'string' || documentId.trim() === '') {
      throw new Error('replace requires a non-empty "documentId" string')
    }
    validateDocumentId(documentId.trim())
    const find = obj['find']
    if (typeof find !== 'string' || find === '') {
      throw new Error('replace requires a non-empty "find" string')
    }
    const replace = obj['replace']
    if (typeof replace !== 'string') {
      throw new Error('replace requires a "replace" string')
    }
    return { action: 'replace', documentId: documentId.trim(), find, replace }
  }

  throw new Error(
    'action must be "read", "create", "append", "insert", or "replace"',
  )
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeRead(documentId: string): Promise<AgentToolResult> {
  const api = getClient()
  const doc = (await api.get(`${API_BASE}/${encodeURIComponent(documentId)}`)) as DocumentResponse
  const plainText = extractPlainText(doc.body)

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        documentId: doc.documentId,
        title: doc.title,
        text: plainText,
      }),
    }],
  }
}

async function executeCreate(title: string, text?: string): Promise<AgentToolResult> {
  const api = getClient()
  const doc = (await api.post(API_BASE, { title })) as DocumentResponse

  if (text && doc.documentId) {
    await api.post(`${API_BASE}/${encodeURIComponent(doc.documentId)}:batchUpdate`, {
      requests: [{
        insertText: {
          text,
          endOfSegmentLocation: {},
        },
      }],
    })
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        documentId: doc.documentId,
        title: doc.title,
      }),
    }],
  }
}

async function executeAppend(documentId: string, text: string): Promise<AgentToolResult> {
  const api = getClient()
  await api.post(`${API_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
    requests: [{
      insertText: {
        text,
        endOfSegmentLocation: {},
      },
    }],
  })

  return {
    content: [{ type: 'text', text: JSON.stringify({ documentId, appended: true }) }],
  }
}

async function executeInsert(documentId: string, text: string, index: number): Promise<AgentToolResult> {
  const api = getClient()
  await api.post(`${API_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
    requests: [{
      insertText: {
        text,
        location: { index },
      },
    }],
  })

  return {
    content: [{ type: 'text', text: JSON.stringify({ documentId, inserted: true, index }) }],
  }
}

async function executeReplace(documentId: string, find: string, replace: string): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.post(`${API_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
    requests: [{
      replaceAllText: {
        containsText: { text: find, matchCase: true },
        replaceText: replace,
      },
    }],
  })

  const replies = result as { replies?: readonly { replaceAllText?: { occurrencesChanged?: number } }[] }
  const occurrences = replies.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0

  if (occurrences > MAX_REPLACEMENTS) {
    throw new Error(`Replace affected ${String(occurrences)} occurrences, exceeding the ${String(MAX_REPLACEMENTS)} limit`)
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ documentId, replaced: true, occurrences }) }],
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const docsParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform: read, create, append, insert, or replace',
      enum: ['read', 'create', 'append', 'insert', 'replace'],
    },
    documentId: {
      type: 'string',
      description: 'Google Docs document ID (read, append, insert, replace)',
    },
    title: {
      type: 'string',
      description: 'Document title (create)',
    },
    text: {
      type: 'string',
      description: 'Text content (create, append, insert — max 100,000 chars)',
    },
    index: {
      type: 'integer',
      description: 'Insertion index (insert — 1-based)',
    },
    find: {
      type: 'string',
      description: 'Text to find (replace)',
    },
    replace: {
      type: 'string',
      description: 'Replacement text (replace)',
    },
  },
  required: ['action'],
}

export const googleDocsTool: ExtendedAgentTool = {
  name: 'google-docs',
  description:
    'Read and edit Google Docs. Actions: read(documentId) extracts plain text, create(title, text?) creates new doc, append(documentId, text) adds text at end, insert(documentId, text, index) inserts at position, replace(documentId, find, replace) replaces all matches. Confirmation required.',
  parameters: docsParameters,
  permissions: ['net:http', 'google:docs'],
  requiresConfirmation: true,
  defaultRiskTier: 2,
  riskTiers: { read: 1, create: 2, append: 2, insert: 2, replace: 2 },
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'read':
        return executeRead(parsed.documentId)
      case 'create':
        return executeCreate(parsed.title, parsed.text)
      case 'append':
        return executeAppend(parsed.documentId, parsed.text)
      case 'insert':
        return executeInsert(parsed.documentId, parsed.text, parsed.index)
      case 'replace':
        return executeReplace(parsed.documentId, parsed.find, parsed.replace)
    }
  },
}

export { parseArgs, extractPlainText }

/** Test-only: resets the client instance. */
export function _resetClient(): void {
  client = undefined
}
