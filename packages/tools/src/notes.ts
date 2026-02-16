/**
 * Notes tool — create, search, update, delete, and list notes.
 * Storage: SQLite via built-in node:sqlite with FTS5 full-text search.
 *
 * All queries use prepared statements — zero string concatenation in SQL.
 * Database path configurable via NOTES_DB_PATH environment variable.
 * Confirmable actions: deleteNote.
 */

// Type-only import — erased at compile time, does not trigger Vite resolution
import type { DatabaseSync } from 'node:sqlite'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
// createRequire from node:module is a well-known core module that Vite externalizes.
// We use it to load node:sqlite via Node's native require, bypassing Vite's bundler.
import { createRequire } from 'node:module'

// ---------------------------------------------------------------------------
// Runtime loader — bypasses Vite's module resolution for node:sqlite
// ---------------------------------------------------------------------------

const nodeRequire = createRequire(import.meta.url)

interface SqliteModule {
  DatabaseSync: typeof import('node:sqlite').DatabaseSync
}

function loadSqliteSync(): SqliteModule {
  return nodeRequire('node:sqlite') as SqliteModule
}

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
// Database initialization
// ---------------------------------------------------------------------------

const INIT_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, content, content=notes, content_rowid=id
  )`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END`,
]

function initDb(dbPath: string): DatabaseSync {
  const { DatabaseSync: DbSync } = loadSqliteSync()
  const db = new DbSync(dbPath)
  for (const sql of INIT_STATEMENTS) {
    db.prepare(sql).run()
  }
  return db
}

// ---------------------------------------------------------------------------
// Row type guard
// ---------------------------------------------------------------------------

function isNoteRow(row: Record<string, unknown>): row is Record<string, unknown> & NoteRow {
  return (
    typeof row['id'] === 'number' &&
    typeof row['title'] === 'string' &&
    typeof row['content'] === 'string' &&
    typeof row['created_at'] === 'string' &&
    typeof row['updated_at'] === 'string'
  )
}

function toNoteRow(row: Record<string, unknown>): NoteRow {
  if (!isNoteRow(row)) {
    throw new Error('Unexpected row format from database')
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
// Action executors
// ---------------------------------------------------------------------------

function executeCreateNote(
  db: DatabaseSync,
  title: string,
  content: string,
): AgentToolResult {
  const stmt = db.prepare(
    'INSERT INTO notes (title, content) VALUES (?, ?)',
  )
  const result = stmt.run(title, content)
  const id = result.lastInsertRowid as number

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!row) {
    throw new Error('Failed to retrieve created note')
  }

  const note = toNoteRow(row as Record<string, unknown>)
  return {
    content: [{ type: 'text', text: JSON.stringify({ note }) }],
  }
}

function executeSearchNotes(
  db: DatabaseSync,
  query: string,
): AgentToolResult {
  const stmt = db.prepare(
    `SELECT notes.id, notes.title, notes.content, notes.created_at, notes.updated_at
     FROM notes_fts
     JOIN notes ON notes.id = notes_fts.rowid
     WHERE notes_fts MATCH ?
     ORDER BY rank`,
  )

  const rows = stmt.all(query)
  const notes = rows.map((row) => toNoteRow(row as Record<string, unknown>))

  return {
    content: [
      { type: 'text', text: JSON.stringify({ notes, count: notes.length }) },
    ],
  }
}

function executeUpdateNote(
  db: DatabaseSync,
  id: number,
  content: string,
): AgentToolResult {
  const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(id)
  if (!existing) {
    throw new Error(`Note with id ${String(id)} not found`)
  }

  db.prepare(
    "UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(content, id)

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  if (!row) {
    throw new Error('Failed to retrieve updated note')
  }

  const note = toNoteRow(row as Record<string, unknown>)
  return {
    content: [{ type: 'text', text: JSON.stringify({ note }) }],
  }
}

function executeDeleteNote(db: DatabaseSync, id: number): AgentToolResult {
  const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(id)
  if (!existing) {
    throw new Error(`Note with id ${String(id)} not found`)
  }

  db.prepare('DELETE FROM notes WHERE id = ?').run(id)

  return {
    content: [
      { type: 'text', text: JSON.stringify({ deleted: true, id }) },
    ],
  }
}

function executeListNotes(
  db: DatabaseSync,
  limit: number,
): AgentToolResult {
  const stmt = db.prepare(
    'SELECT * FROM notes ORDER BY created_at DESC LIMIT ?',
  )
  const rows = stmt.all(limit)
  const notes = rows.map((row) => toNoteRow(row as Record<string, unknown>))

  return {
    content: [
      { type: 'text', text: JSON.stringify({ notes, count: notes.length }) },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

function createNotesTool(dbPath: string): ExtendedAgentTool {
  const db = initDb(dbPath)

  return {
    name: 'notes',
    description:
      'Create, search, update, delete, and list personal notes with full-text search. Actions: createNote(title, content); searchNotes(query) full-text search; updateNote(id, content); deleteNote(id) requires confirmation; listNotes(limit?) lists recent notes.',
    parameters: notesParameters,
    permissions: [],
    requiresConfirmation: true,
    runsOn: 'server',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'createNote':
          return executeCreateNote(db, parsed.title, parsed.content)
        case 'searchNotes':
          return executeSearchNotes(db, parsed.query)
        case 'updateNote':
          return executeUpdateNote(db, parsed.id, parsed.content)
        case 'deleteNote':
          return executeDeleteNote(db, parsed.id)
        case 'listNotes':
          return executeListNotes(db, parsed.limit)
      }
    },
  }
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

const defaultDbPath = process.env['NOTES_DB_PATH'] ?? ':memory:'
export const notesTool: ExtendedAgentTool = createNotesTool(defaultDbPath)

export { createNotesTool, parseArgs, initDb }
