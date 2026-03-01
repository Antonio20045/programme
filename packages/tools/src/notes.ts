/**
 * Notes tool — create, search, update, delete, and list notes.
 * Storage: PostgreSQL with tsvector full-text search (German config).
 *
 * All queries use parameterized $-placeholders — zero string concatenation in SQL.
 * User isolation: every query is scoped by userId.
 */

import type { AgentToolResult, DbPool, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

// ---------------------------------------------------------------------------
// Types — note rows
// ---------------------------------------------------------------------------

interface NoteRow {
  readonly id: number
  readonly title: string
  readonly content: string
  readonly created_at: string
  readonly updated_at: string
}

// ---------------------------------------------------------------------------
// Argument types
// ---------------------------------------------------------------------------

interface CreateNoteArgs {
  readonly action: 'createNote'
  readonly title: string
  readonly content: string
}

interface SearchNotesArgs {
  readonly action: 'searchNotes'
  readonly query: string
}

interface UpdateNoteArgs {
  readonly action: 'updateNote'
  readonly id: number
  readonly content: string
}

interface DeleteNoteArgs {
  readonly action: 'deleteNote'
  readonly id: number
}

interface ListNotesArgs {
  readonly action: 'listNotes'
  readonly limit: number
}

type NotesArgs =
  | CreateNoteArgs
  | SearchNotesArgs
  | UpdateNoteArgs
  | DeleteNoteArgs
  | ListNotesArgs

// ---------------------------------------------------------------------------
// Row conversion (pg → typed NoteRow)
// ---------------------------------------------------------------------------

function toNoteRow(row: Record<string, unknown>): NoteRow {
  return {
    id: Number(row['id']),
    title: String(row['title'] ?? ''),
    content: String(row['content'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): NotesArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'createNote') {
    const title = obj['title']
    const content = obj['content']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('createNote requires a non-empty "title" string')
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('createNote requires a non-empty "content" string')
    }
    return { action: 'createNote', title: title.trim(), content: content.trim() }
  }

  if (action === 'searchNotes') {
    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('searchNotes requires a non-empty "query" string')
    }
    return { action: 'searchNotes', query: query.trim() }
  }

  if (action === 'updateNote') {
    const id = obj['id']
    const content = obj['content']
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
      throw new Error('updateNote requires a positive integer "id"')
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('updateNote requires a non-empty "content" string')
    }
    return { action: 'updateNote', id, content: content.trim() }
  }

  if (action === 'deleteNote') {
    const id = obj['id']
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
      throw new Error('deleteNote requires a positive integer "id"')
    }
    return { action: 'deleteNote', id }
  }

  if (action === 'listNotes') {
    let limit = DEFAULT_LIST_LIMIT
    if (obj['limit'] !== undefined) {
      if (
        typeof obj['limit'] !== 'number' ||
        !Number.isInteger(obj['limit']) ||
        obj['limit'] < 1
      ) {
        throw new Error('limit must be a positive integer')
      }
      limit = Math.min(obj['limit'], MAX_LIST_LIMIT)
    }
    return { action: 'listNotes', limit }
  }

  throw new Error(
    'action must be "createNote", "searchNotes", "updateNote", "deleteNote", or "listNotes"',
  )
}

// ---------------------------------------------------------------------------
// Action executors (async, parameterized, user-scoped)
// ---------------------------------------------------------------------------

async function executeCreateNote(
  pool: DbPool, userId: string, title: string, content: string,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    `INSERT INTO notes (user_id, title, content)
     VALUES ($1, $2, $3)
     RETURNING id, title, content, created_at, updated_at`,
    [userId, title, content],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to retrieve created note')
  return { content: [{ type: 'text', text: JSON.stringify({ note: toNoteRow(row) }) }] }
}

async function executeSearchNotes(
  pool: DbPool, userId: string, query: string,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    `SELECT id, title, content, created_at, updated_at
     FROM notes
     WHERE user_id = $1 AND search_vector @@ plainto_tsquery('german', $2)
     ORDER BY ts_rank(search_vector, plainto_tsquery('german', $2)) DESC
     LIMIT 20`,
    [userId, query],
  )
  const notes = rows.map(toNoteRow)
  return { content: [{ type: 'text', text: JSON.stringify({ notes, count: notes.length }) }] }
}

async function executeUpdateNote(
  pool: DbPool, userId: string, id: number, content: string,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    `UPDATE notes SET content = $3, updated_at = NOW()
     WHERE id = $2 AND user_id = $1
     RETURNING id, title, content, created_at, updated_at`,
    [userId, id, content],
  )
  const row = rows[0]
  if (!row) throw new Error(`Note with id ${String(id)} not found`)
  return { content: [{ type: 'text', text: JSON.stringify({ note: toNoteRow(row) }) }] }
}

async function executeDeleteNote(
  pool: DbPool, userId: string, id: number,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    'DELETE FROM notes WHERE id = $2 AND user_id = $1 RETURNING id',
    [userId, id],
  )
  if (rows.length === 0) throw new Error(`Note with id ${String(id)} not found`)
  return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }) }] }
}

async function executeListNotes(
  pool: DbPool, userId: string, limit: number,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    'SELECT id, title, content, created_at, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
    [userId, limit],
  )
  const notes = rows.map(toNoteRow)
  return { content: [{ type: 'text', text: JSON.stringify({ notes, count: notes.length }) }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const notesParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description:
        'Action to perform: createNote, searchNotes, updateNote, deleteNote, or listNotes',
      enum: [
        'createNote',
        'searchNotes',
        'updateNote',
        'deleteNote',
        'listNotes',
      ],
    },
    title: {
      type: 'string',
      description: 'Note title (required for createNote)',
    },
    content: {
      type: 'string',
      description: 'Note content (required for createNote and updateNote)',
    },
    query: {
      type: 'string',
      description: 'Full-text search query (required for searchNotes)',
    },
    id: {
      type: 'integer',
      description: 'Note ID (required for updateNote and deleteNote)',
    },
    limit: {
      type: 'integer',
      description: 'Max notes to return for listNotes (default 20, max 100)',
    },
  },
  required: ['action'],
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createNotesTool(userId: string, pool: DbPool): ExtendedAgentTool {
  return {
    name: 'notes',
    description:
      'Create, search, update, delete, and list personal notes with full-text search. Actions: createNote(title, content); searchNotes(query) full-text search; updateNote(id, content); deleteNote(id) requires confirmation; listNotes(limit?) lists recent notes.',
    parameters: notesParameters,
    permissions: [],
    requiresConfirmation: true,
    defaultRiskTier: 2,
    riskTiers: { searchNotes: 1, listNotes: 1, createNote: 2, updateNote: 2, deleteNote: 4 },
    runsOn: 'server',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)
      switch (parsed.action) {
        case 'createNote':
          return executeCreateNote(pool, userId, parsed.title, parsed.content)
        case 'searchNotes':
          return executeSearchNotes(pool, userId, parsed.query)
        case 'updateNote':
          return executeUpdateNote(pool, userId, parsed.id, parsed.content)
        case 'deleteNote':
          return executeDeleteNote(pool, userId, parsed.id)
        case 'listNotes':
          return executeListNotes(pool, userId, parsed.limit)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createNotesTool, parseArgs }
