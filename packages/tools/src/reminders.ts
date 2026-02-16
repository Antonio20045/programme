/**
 * Reminders tool — manage local reminders stored in SQLite.
 * Uses node:sqlite (built-in, zero external deps).
 * All queries use prepared statements — no string concatenation in SQL.
 *
 * node:sqlite is loaded via createRequire to bypass Vite's module resolution
 * (Vite does not yet recognize sqlite as a known Node.js builtin).
 *
 * Exports:
 *  - createRemindersInstance(dbPath) — factory (use ':memory:' in tests)
 *  - ReminderRow, RemindersInstance — types
 */

import { createRequire } from 'node:module'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// SQLite loader (bypasses Vite module resolution)
// ---------------------------------------------------------------------------

interface StatementResult {
  readonly changes: number | bigint
  readonly lastInsertRowid: number | bigint
}

interface SqliteStatement {
  run(...params: (string | number | null)[]): StatementResult
  all(...params: (string | number | null)[]): Record<string, unknown>[]
  get(...params: (string | number | null)[]): Record<string, unknown> | undefined
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  close(): void
}

interface SqliteDatabaseConstructor {
  new (path: string): SqliteDatabase
}

const nodeRequire = createRequire(import.meta.url)

function loadDatabaseSync(): SqliteDatabaseConstructor {
  const mod = nodeRequire('node:sqlite') as {
    DatabaseSync: SqliteDatabaseConstructor
  }
  return mod.DatabaseSync
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReminderRow {
  readonly id: number
  readonly text: string
  readonly datetime: string
  readonly created_at: string
  readonly notified: number
}

type ReminderFilter = 'all' | 'pending' | 'past'

interface SetReminderArgs {
  readonly action: 'setReminder'
  readonly text: string
  readonly datetime: string
}

interface ListRemindersArgs {
  readonly action: 'listReminders'
  readonly filter: ReminderFilter
}

interface CancelReminderArgs {
  readonly action: 'cancelReminder'
  readonly id: number
}

type RemindersArgs = SetReminderArgs | ListRemindersArgs | CancelReminderArgs

interface RemindersInstance {
  readonly tool: ExtendedAgentTool
  readonly getDueReminders: (now: Date) => readonly ReminderRow[]
  readonly close: () => void
}

// ---------------------------------------------------------------------------
// Schema (static literal — safe for prepare)
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS reminders (' +
  'id INTEGER PRIMARY KEY,' +
  'text TEXT NOT NULL,' +
  'datetime TEXT NOT NULL,' +
  'created_at TEXT NOT NULL,' +
  'notified INTEGER NOT NULL DEFAULT 0' +
  ') STRICT'

// ---------------------------------------------------------------------------
// JSON Schema for LLM function calling
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description:
        'Action: "setReminder", "listReminders", or "cancelReminder"',
      enum: ['setReminder', 'listReminders', 'cancelReminder'],
    },
    text: {
      type: 'string',
      description: 'Reminder text (required for setReminder)',
    },
    datetime: {
      type: 'string',
      description:
        'ISO 8601 datetime for the reminder (required for setReminder)',
    },
    filter: {
      type: 'string',
      description:
        'Filter for listReminders: "all" (default), "pending", or "past"',
      enum: ['all', 'pending', 'past'],
    },
    id: {
      type: 'integer',
      description: 'Reminder ID (required for cancelReminder)',
    },
  },
  required: ['action'],
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): RemindersArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'setReminder') {
    const text = obj['text']
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('setReminder requires a non-empty "text" string')
    }
    const datetime = obj['datetime']
    if (typeof datetime !== 'string' || datetime.trim() === '') {
      throw new Error('setReminder requires a non-empty "datetime" string')
    }
    const parsed = new Date(datetime)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid datetime: ${datetime}`)
    }
    return {
      action: 'setReminder',
      text: text.trim(),
      datetime: parsed.toISOString(),
    }
  }

  if (action === 'listReminders') {
    const filter = obj['filter'] ?? 'all'
    if (filter !== 'all' && filter !== 'pending' && filter !== 'past') {
      throw new Error('filter must be "all", "pending", or "past"')
    }
    return { action: 'listReminders', filter }
  }

  if (action === 'cancelReminder') {
    const id = obj['id']
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new Error('cancelReminder requires a positive integer "id"')
    }
    return { action: 'cancelReminder', id }
  }

  throw new Error(
    'action must be "setReminder", "listReminders", or "cancelReminder"',
  )
}

// ---------------------------------------------------------------------------
// Row conversion (SQLite → typed ReminderRow)
// ---------------------------------------------------------------------------

function toReminderRow(row: Record<string, unknown>): ReminderRow {
  return {
    id: Number(row['id'] ?? 0),
    text: String(row['text'] ?? ''),
    datetime: String(row['datetime'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    notified: Number(row['notified'] ?? 0),
  }
}

function toReminderRows(
  rows: Record<string, unknown>[],
): readonly ReminderRow[] {
  return rows.map(toReminderRow)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createRemindersInstance(dbPath: string): RemindersInstance {
  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath)

  // Initialize schema — static SQL, no user input
  db.prepare(CREATE_TABLE_SQL).run()

  // --- Prepared statements (all parameterized) ---

  const insertStmt = db.prepare(
    'INSERT INTO reminders (text, datetime, created_at) VALUES (?, ?, ?)',
  )

  const selectAllStmt = db.prepare(
    'SELECT id, text, datetime, created_at, notified FROM reminders ORDER BY datetime ASC',
  )

  const selectPendingStmt = db.prepare(
    'SELECT id, text, datetime, created_at, notified FROM reminders WHERE notified = 0 ORDER BY datetime ASC',
  )

  const selectPastStmt = db.prepare(
    'SELECT id, text, datetime, created_at, notified FROM reminders WHERE datetime <= ? ORDER BY datetime ASC',
  )

  const selectByIdStmt = db.prepare(
    'SELECT id FROM reminders WHERE id = ?',
  )

  const deleteStmt = db.prepare('DELETE FROM reminders WHERE id = ?')

  const selectDueStmt = db.prepare(
    'SELECT id, text, datetime, created_at, notified FROM reminders WHERE datetime <= ? AND notified = 0 ORDER BY datetime ASC',
  )

  // --- Action executors ---

  function executeSetReminder(
    text: string,
    datetime: string,
  ): AgentToolResult {
    const now = new Date().toISOString()
    const result = insertStmt.run(text, datetime, now)
    const id = Number(result.lastInsertRowid)
    const reminder = { id, text, datetime, created_at: now }
    return {
      content: [{ type: 'text', text: JSON.stringify(reminder) }],
    }
  }

  function executeListReminders(filter: ReminderFilter): AgentToolResult {
    let rows: Record<string, unknown>[]
    switch (filter) {
      case 'all':
        rows = selectAllStmt.all() as Record<string, unknown>[]
        break
      case 'pending':
        rows = selectPendingStmt.all() as Record<string, unknown>[]
        break
      case 'past':
        rows = selectPastStmt.all(
          new Date().toISOString(),
        ) as Record<string, unknown>[]
        break
    }
    const reminders = toReminderRows(rows)
    return {
      content: [{ type: 'text', text: JSON.stringify({ reminders }) }],
    }
  }

  function executeCancelReminder(id: number): AgentToolResult {
    const existing = selectByIdStmt.get(id)
    if (!existing) {
      throw new Error(`Reminder with id ${String(id)} not found`)
    }
    deleteStmt.run(id)
    return {
      content: [{ type: 'text', text: JSON.stringify({ deleted: id }) }],
    }
  }

  // --- Tool instance ---

  const tool: ExtendedAgentTool = {
    name: 'reminders',
    description:
      'Manage reminders stored in local SQLite. Actions: setReminder(text, datetime) creates a reminder, listReminders(filter?) lists reminders, cancelReminder(id) deletes one.',
    parameters,
    permissions: [],
    requiresConfirmation: false,
    runsOn: 'server',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)
      switch (parsed.action) {
        case 'setReminder':
          return executeSetReminder(parsed.text, parsed.datetime)
        case 'listReminders':
          return executeListReminders(parsed.filter)
        case 'cancelReminder':
          return executeCancelReminder(parsed.id)
      }
    },
  }

  // --- getDueReminders (for cron) ---

  function getDueReminders(now: Date): readonly ReminderRow[] {
    const rows = selectDueStmt.all(
      now.toISOString(),
    ) as Record<string, unknown>[]
    return toReminderRows(rows)
  }

  function close(): void {
    db.close()
  }

  return { tool, getDueReminders, close }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createRemindersInstance }
export type { ReminderRow, RemindersInstance }
