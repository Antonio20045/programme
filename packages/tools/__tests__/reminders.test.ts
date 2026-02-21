import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi, beforeEach, describe, expect, it } from 'vitest'
import { assertNoEval } from './helpers'
import type { DbPool } from '../src/types'
import type { RemindersInstance } from '../src/reminders'
import { createRemindersInstance, parseArgs } from '../src/reminders'

// ---------------------------------------------------------------------------
// Source code for security audit
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/reminders.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }
const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'

// ---------------------------------------------------------------------------
// Helper to parse tool result text
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): unknown {
  const first = result.content[0]
  if (first && 'text' in first && typeof first.text === 'string') {
    return JSON.parse(first.text) as unknown
  }
  throw new Error('Unexpected result format')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reminders tool', () => {
  let instance: RemindersInstance

  beforeEach(() => {
    mockQuery.mockReset()
    instance = createRemindersInstance(USER_A, mockPool)
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(instance.tool.name).toBe('reminders')
    })

    it('runs on server', () => {
      expect(instance.tool.runsOn).toBe('server')
    })

    it('has no permissions', () => {
      expect(instance.tool.permissions).toEqual([])
    })

    it('does not require confirmation', () => {
      expect(instance.tool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // CRUD: setReminder
  // -------------------------------------------------------------------------

  describe('setReminder', () => {
    it('creates a reminder and returns it with id', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Buy milk', datetime: '2026-03-01T10:00:00.000Z', created_at: '2026-02-18T12:00:00Z' }],
      })

      const result = await instance.tool.execute({
        action: 'setReminder',
        text: 'Buy milk',
        datetime: '2026-03-01T10:00:00Z',
      })

      const data = parseResult(result) as {
        id: number
        text: string
        datetime: string
        created_at: string
      }

      expect(data.id).toBe(1)
      expect(data.text).toBe('Buy milk')
      expect(data.datetime).toBe('2026-03-01T10:00:00.000Z')
      expect(data.created_at).toBeTruthy()
    })

    it('passes userId as first parameter', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'T', datetime: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01' }],
      })

      await instance.tool.execute({
        action: 'setReminder',
        text: 'Test',
        datetime: '2026-03-01T10:00:00Z',
      })

      const params = mockQuery.mock.calls[0]![1] as unknown[]
      expect(params[0]).toBe(USER_A)
    })

    it('normalizes datetime to ISO 8601', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Meeting', datetime: '2026-06-15T14:30:00.000Z', created_at: '2026-01-01' }],
      })

      await instance.tool.execute({
        action: 'setReminder',
        text: 'Meeting',
        datetime: '2026-06-15 14:30',
      })

      // parseArgs normalizes datetime before it reaches the DB
      const params = mockQuery.mock.calls[0]![1] as unknown[]
      const sentDatetime = params[2] as string
      expect(sentDatetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('throws when DB returns no rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(
        instance.tool.execute({
          action: 'setReminder',
          text: 'Test',
          datetime: '2026-03-01T10:00:00Z',
        }),
      ).rejects.toThrow('Failed to create reminder')
    })

    it('rejects empty text', async () => {
      await expect(
        instance.tool.execute({
          action: 'setReminder',
          text: '',
          datetime: '2026-03-01T10:00:00Z',
        }),
      ).rejects.toThrow('non-empty "text"')
    })

    it('rejects empty datetime', async () => {
      await expect(
        instance.tool.execute({
          action: 'setReminder',
          text: 'Test',
          datetime: '',
        }),
      ).rejects.toThrow('non-empty "datetime"')
    })

    it('rejects invalid datetime', async () => {
      await expect(
        instance.tool.execute({
          action: 'setReminder',
          text: 'Test',
          datetime: 'not-a-date',
        }),
      ).rejects.toThrow('Invalid datetime')
    })
  })

  // -------------------------------------------------------------------------
  // CRUD: listReminders
  // -------------------------------------------------------------------------

  describe('listReminders', () => {
    it('lists all reminders', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, text: 'A', datetime: '2026-03-01T10:00:00Z', created_at: '2026-01-01', notified: false },
          { id: 2, text: 'B', datetime: '2026-03-02T10:00:00Z', created_at: '2026-01-01', notified: false },
        ],
      })

      const result = await instance.tool.execute({ action: 'listReminders' })
      const data = parseResult(result) as { reminders: { text: string }[] }
      expect(data.reminders).toHaveLength(2)
      expect(data.reminders[0]?.text).toBe('A')
      expect(data.reminders[1]?.text).toBe('B')
    })

    it('returns empty list when no reminders exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await instance.tool.execute({ action: 'listReminders' })
      const data = parseResult(result) as { reminders: unknown[] }
      expect(data.reminders).toEqual([])
    })

    it('uses pending filter SQL (notified = FALSE)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Pending', datetime: '2026-03-01T10:00:00Z', created_at: '2026-01-01', notified: false }],
      })

      const result = await instance.tool.execute({
        action: 'listReminders',
        filter: 'pending',
      })

      const sql = mockQuery.mock.calls[0]![0] as string
      expect(sql).toContain('notified = FALSE')

      const data = parseResult(result) as { reminders: { notified: boolean }[] }
      expect(data.reminders).toHaveLength(1)
      expect(data.reminders[0]?.notified).toBe(false)
    })

    it('uses past filter SQL (datetime <= NOW())', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Past', datetime: '2020-01-01T00:00:00Z', created_at: '2019-01-01', notified: false }],
      })

      await instance.tool.execute({
        action: 'listReminders',
        filter: 'past',
      })

      const sql = mockQuery.mock.calls[0]![0] as string
      expect(sql).toContain('datetime <= NOW()')
    })

    it('defaults to "all" when no filter given', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Any', datetime: '2026-03-01T10:00:00Z', created_at: '2026-01-01', notified: false }],
      })

      const result = await instance.tool.execute({ action: 'listReminders' })
      const data = parseResult(result) as { reminders: unknown[] }
      expect(data.reminders).toHaveLength(1)

      // "all" query should NOT contain notified filter or NOW()
      const sql = mockQuery.mock.calls[0]![0] as string
      expect(sql).not.toContain('notified = FALSE')
      expect(sql).not.toContain('NOW()')
    })

    it('rejects invalid filter', async () => {
      await expect(
        instance.tool.execute({
          action: 'listReminders',
          filter: 'invalid',
        }),
      ).rejects.toThrow('filter must be')
    })
  })

  // -------------------------------------------------------------------------
  // CRUD: cancelReminder
  // -------------------------------------------------------------------------

  describe('cancelReminder', () => {
    it('deletes a reminder by id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })

      const deleteResult = await instance.tool.execute({
        action: 'cancelReminder',
        id: 1,
      })

      const data = parseResult(deleteResult) as { deleted: number }
      expect(data.deleted).toBe(1)
    })

    it('throws error for non-existent id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: 999 }),
      ).rejects.toThrow('not found')
    })

    it('throws error on double delete', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })
      await instance.tool.execute({ action: 'cancelReminder', id: 1 })

      mockQuery.mockResolvedValueOnce({ rows: [] })
      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: 1 }),
      ).rejects.toThrow('not found')
    })

    it('rejects non-integer id', async () => {
      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: 1.5 }),
      ).rejects.toThrow('positive integer')
    })

    it('rejects zero id', async () => {
      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: 0 }),
      ).rejects.toThrow('positive integer')
    })

    it('rejects negative id', async () => {
      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: -1 }),
      ).rejects.toThrow('positive integer')
    })
  })

  // -------------------------------------------------------------------------
  // getDueReminders (for cron) — now async
  // -------------------------------------------------------------------------

  describe('getDueReminders', () => {
    it('returns reminders due at or before the given time', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Due now', datetime: '2026-02-16T10:00:00Z', created_at: '2026-01-01', notified: false }],
      })

      const due = await instance.getDueReminders(new Date('2026-02-16T12:00:00Z'))

      expect(due).toHaveLength(1)
      expect(due[0]?.text).toBe('Due now')
    })

    it('passes userId and ISO datetime as parameters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const now = new Date('2026-02-16T12:00:00Z')
      await instance.getDueReminders(now)

      const params = mockQuery.mock.calls[0]![1] as unknown[]
      expect(params[0]).toBe(USER_A)
      expect(params[1]).toBe(now.toISOString())
    })

    it('returns empty array when nothing is due', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const due = await instance.getDueReminders(new Date('2026-01-01T00:00:00Z'))
      expect(due).toHaveLength(0)
    })

    it('filters by notified = FALSE in SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await instance.getDueReminders(new Date('2026-02-16T12:00:00Z'))

      const sql = mockQuery.mock.calls[0]![0] as string
      expect(sql).toContain('notified = FALSE')
    })

    it('returns rows with notified as boolean', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'Past due', datetime: '2020-01-01T00:00:00Z', created_at: '2019-01-01', notified: false }],
      })

      const due = await instance.getDueReminders(new Date('2026-02-16T12:00:00Z'))
      expect(due[0]?.notified).toBe(false)
    })

    it('returns multiple due reminders sorted by datetime', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 2, text: 'Earlier', datetime: '2026-02-16T08:00:00Z', created_at: '2026-01-01', notified: false },
          { id: 1, text: 'Later', datetime: '2026-02-16T12:00:00Z', created_at: '2026-01-01', notified: false },
        ],
      })

      const due = await instance.getDueReminders(new Date('2026-02-16T15:00:00Z'))

      expect(due).toHaveLength(2)
      expect(due[0]?.text).toBe('Earlier')
      expect(due[1]?.text).toBe('Later')
    })
  })

  // -------------------------------------------------------------------------
  // User isolation
  // -------------------------------------------------------------------------

  describe('user isolation', () => {
    it('every query includes userId as first parameter', async () => {
      const instanceB = createRemindersInstance(USER_B, mockPool)

      // setReminder
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: 'T', datetime: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01' }],
      })
      await instanceB.tool.execute({
        action: 'setReminder',
        text: 'Test',
        datetime: '2026-03-01T10:00:00Z',
      })
      expect((mockQuery.mock.calls[0]![1] as unknown[])[0]).toBe(USER_B)

      // listReminders
      mockQuery.mockResolvedValueOnce({ rows: [] })
      await instanceB.tool.execute({ action: 'listReminders' })
      expect((mockQuery.mock.calls[1]![1] as unknown[])[0]).toBe(USER_B)

      // cancelReminder
      mockQuery.mockResolvedValueOnce({ rows: [] })
      await instanceB.tool.execute({ action: 'cancelReminder', id: 1 }).catch(() => {})
      expect((mockQuery.mock.calls[2]![1] as unknown[])[0]).toBe(USER_B)

      // getDueReminders
      mockQuery.mockResolvedValueOnce({ rows: [] })
      await instanceB.getDueReminders(new Date())
      expect((mockQuery.mock.calls[3]![1] as unknown[])[0]).toBe(USER_B)
    })

    it('User B cannot cancel User A reminder (DB returns empty)', async () => {
      const instanceB = createRemindersInstance(USER_B, mockPool)
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(
        instanceB.tool.execute({ action: 'cancelReminder', id: 1 }),
      ).rejects.toThrow('not found')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(instance.tool.execute(null)).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects unknown action', async () => {
      await expect(
        instance.tool.execute({ action: 'destroy' }),
      ).rejects.toThrow('action must be')
    })
  })

  // -------------------------------------------------------------------------
  // SQL Injection — verify parameterized queries
  // -------------------------------------------------------------------------

  describe('SQL injection protection', () => {
    it('malicious text is passed as parameter, not interpolated', async () => {
      const malicious = "'; DROP TABLE reminders; --"
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: malicious, datetime: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01' }],
      })

      await instance.tool.execute({
        action: 'setReminder',
        text: malicious,
        datetime: '2026-03-01T10:00:00Z',
      })

      const sql = mockQuery.mock.calls[0]![0] as string
      const params = mockQuery.mock.calls[0]![1] as unknown[]
      expect(sql).toContain('$1')
      expect(sql).not.toContain(malicious)
      expect(params).toContain(malicious)
    })

    it('malicious datetime is rejected by parseArgs validation', async () => {
      await expect(
        instance.tool.execute({
          action: 'setReminder',
          text: 'Normal text',
          datetime: "2026-01-01'; DROP TABLE reminders;--",
        }),
      ).rejects.toThrow('Invalid datetime')
    })

    it('stores and retrieves special characters correctly', async () => {
      const special = "O'Reilly & \"Partners\" <test> (100%)"
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, text: special, datetime: '2026-03-01T10:00:00.000Z', created_at: '2026-01-01' }],
      })

      await instance.tool.execute({
        action: 'setReminder',
        text: special,
        datetime: '2026-03-01T10:00:00Z',
      })

      const params = mockQuery.mock.calls[0]![1] as unknown[]
      expect(params).toContain(special)
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('uses only parameterized queries (no string concat in SQL)', () => {
      const sqlConcatPattern = /(?:pool\.query)\s*\([^)]*\+/
      expect(sourceCode).not.toMatch(sqlConcatPattern)
    })

    it('uses $-placeholders in all SQL queries', () => {
      // Every pool.query call should use $N placeholders
      const queryCount = (sourceCode.match(/pool\.query\(/g) ?? []).length
      // setReminder, listReminders, cancelReminder, getDueReminders = 4
      expect(queryCount).toBeGreaterThanOrEqual(4)

      // No template literals in SQL
      const sqlTemplatePattern = /pool\.query\s*\(\s*`[^`]*\$\{/
      expect(sourceCode).not.toMatch(sqlTemplatePattern)
    })
  })

  // -------------------------------------------------------------------------
  // parseArgs (standalone)
  // -------------------------------------------------------------------------

  describe('parseArgs', () => {
    it('parses setReminder correctly', () => {
      const result = parseArgs({
        action: 'setReminder',
        text: 'Buy milk',
        datetime: '2026-03-01T10:00:00Z',
      })
      expect(result).toEqual({
        action: 'setReminder',
        text: 'Buy milk',
        datetime: '2026-03-01T10:00:00.000Z',
      })
    })

    it('parses listReminders with default filter', () => {
      const result = parseArgs({ action: 'listReminders' })
      expect(result).toEqual({ action: 'listReminders', filter: 'all' })
    })

    it('parses cancelReminder', () => {
      const result = parseArgs({ action: 'cancelReminder', id: 5 })
      expect(result).toEqual({ action: 'cancelReminder', id: 5 })
    })

    it('rejects non-object args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'explode' })).toThrow('action must be')
    })
  })
})
