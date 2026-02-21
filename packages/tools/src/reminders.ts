/**
 * Reminders tool — manage reminders stored in PostgreSQL.
 * All queries use parameterized $-placeholders — no string concatenation in SQL.
 * User isolation: every query is scoped by userId.
 *
 * Exports:
 *  - createRemindersInstance(userId, pool) — factory
 *  - ReminderRow, RemindersInstance — types
 */

import type { AgentToolResult, DbPool, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReminderRow {
  readonly id: number
  readonly text: string
  readonly datetime: string
  readonly created_at: string
  readonly notified: boolean
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
  readonly getDueReminders: (now: Date) => Promise<readonly ReminderRow[]>
}

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
// Row conversion (pg → typed ReminderRow)
// ---------------------------------------------------------------------------

function toReminderRow(row: Record<string, unknown>): ReminderRow {
  return {
    id: Number(row['id'] ?? 0),
    text: String(row['text'] ?? ''),
    datetime: String(row['datetime'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    notified: Boolean(row['notified']),
  }
}

// ---------------------------------------------------------------------------
// Action executors (async, parameterized, user-scoped)
// ---------------------------------------------------------------------------

async function executeSetReminder(
  pool: DbPool, userId: string, text: string, datetime: string,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    `INSERT INTO reminders (user_id, text, datetime)
     VALUES ($1, $2, $3)
     RETURNING id, text, datetime, created_at`,
    [userId, text, datetime],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to create reminder')
  return {
    content: [{ type: 'text', text: JSON.stringify({
      id: Number(row['id']),
      text: String(row['text']),
      datetime: String(row['datetime']),
      created_at: String(row['created_at']),
    }) }],
  }
}

async function executeListReminders(
  pool: DbPool, userId: string, filter: ReminderFilter,
): Promise<AgentToolResult> {
  let sql: string
  let params: unknown[]
  switch (filter) {
    case 'pending':
      sql = 'SELECT id, text, datetime, created_at, notified FROM reminders WHERE user_id = $1 AND notified = FALSE ORDER BY datetime ASC'
      params = [userId]
      break
    case 'past':
      sql = 'SELECT id, text, datetime, created_at, notified FROM reminders WHERE user_id = $1 AND datetime <= NOW() ORDER BY datetime DESC'
      params = [userId]
      break
    default: // 'all'
      sql = 'SELECT id, text, datetime, created_at, notified FROM reminders WHERE user_id = $1 ORDER BY datetime ASC'
      params = [userId]
      break
  }
  const { rows } = await pool.query(sql, params)
  const reminders = rows.map(toReminderRow)
  return { content: [{ type: 'text', text: JSON.stringify({ reminders }) }] }
}

async function executeCancelReminder(
  pool: DbPool, userId: string, id: number,
): Promise<AgentToolResult> {
  const { rows } = await pool.query(
    'DELETE FROM reminders WHERE id = $2 AND user_id = $1 RETURNING id',
    [userId, id],
  )
  if (rows.length === 0) throw new Error(`Reminder with id ${String(id)} not found`)
  return { content: [{ type: 'text', text: JSON.stringify({ deleted: Number(rows[0]!['id']) }) }] }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createRemindersInstance(userId: string, pool: DbPool): RemindersInstance {
  const tool: ExtendedAgentTool = {
    name: 'reminders',
    description:
      'Manage reminders. Actions: setReminder(text, datetime) creates a reminder, listReminders(filter?) lists reminders, cancelReminder(id) deletes one.',
    parameters,
    permissions: [],
    requiresConfirmation: false,
    runsOn: 'server',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)
      switch (parsed.action) {
        case 'setReminder':
          return executeSetReminder(pool, userId, parsed.text, parsed.datetime)
        case 'listReminders':
          return executeListReminders(pool, userId, parsed.filter)
        case 'cancelReminder':
          return executeCancelReminder(pool, userId, parsed.id)
      }
    },
  }

  async function getDueReminders(now: Date): Promise<readonly ReminderRow[]> {
    const { rows } = await pool.query(
      `SELECT id, text, datetime, created_at, notified
       FROM reminders WHERE user_id = $1 AND datetime <= $2 AND notified = FALSE
       ORDER BY datetime ASC`,
      [userId, now.toISOString()],
    )
    return rows.map(toReminderRow)
  }

  return { tool, getDueReminders }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createRemindersInstance, parseArgs }
export type { ReminderRow, RemindersInstance }
