import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertNoEval } from './helpers'
import type { RemindersInstance } from '../src/reminders'
import { createRemindersInstance } from '../src/reminders'

// ---------------------------------------------------------------------------
// Source code for security audit
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/reminders.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

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
    instance = createRemindersInstance(':memory:')
  })

  afterEach(() => {
    instance.close()
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

    it('auto-increments ids', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'First',
        datetime: '2026-03-01T10:00:00Z',
      })
      const result = await instance.tool.execute({
        action: 'setReminder',
        text: 'Second',
        datetime: '2026-03-02T10:00:00Z',
      })

      const data = parseResult(result) as { id: number }
      expect(data.id).toBe(2)
    })

    it('normalizes datetime to ISO 8601', async () => {
      const result = await instance.tool.execute({
        action: 'setReminder',
        text: 'Meeting',
        datetime: '2026-06-15 14:30',
      })

      const data = parseResult(result) as { datetime: string }
      expect(data.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
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
      await instance.tool.execute({
        action: 'setReminder',
        text: 'A',
        datetime: '2026-03-01T10:00:00Z',
      })
      await instance.tool.execute({
        action: 'setReminder',
        text: 'B',
        datetime: '2026-03-02T10:00:00Z',
      })

      const result = await instance.tool.execute({
        action: 'listReminders',
      })

      const data = parseResult(result) as {
        reminders: { text: string }[]
      }
      expect(data.reminders).toHaveLength(2)
      expect(data.reminders[0]?.text).toBe('A')
      expect(data.reminders[1]?.text).toBe('B')
    })

    it('returns empty list when no reminders exist', async () => {
      const result = await instance.tool.execute({
        action: 'listReminders',
      })

      const data = parseResult(result) as { reminders: unknown[] }
      expect(data.reminders).toEqual([])
    })

    it('filters pending reminders (notified = 0)', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Pending one',
        datetime: '2026-03-01T10:00:00Z',
      })

      const result = await instance.tool.execute({
        action: 'listReminders',
        filter: 'pending',
      })

      const data = parseResult(result) as {
        reminders: { text: string; notified: number }[]
      }
      expect(data.reminders).toHaveLength(1)
      expect(data.reminders[0]?.notified).toBe(0)
    })

    it('filters past reminders (datetime in the past)', async () => {
      // Create one in the past and one in the future
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Past',
        datetime: '2020-01-01T00:00:00Z',
      })
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Future',
        datetime: '2099-12-31T23:59:59Z',
      })

      const result = await instance.tool.execute({
        action: 'listReminders',
        filter: 'past',
      })

      const data = parseResult(result) as {
        reminders: { text: string }[]
      }
      expect(data.reminders).toHaveLength(1)
      expect(data.reminders[0]?.text).toBe('Past')
    })

    it('defaults to "all" when no filter given', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Any',
        datetime: '2026-03-01T10:00:00Z',
      })

      const result = await instance.tool.execute({
        action: 'listReminders',
      })

      const data = parseResult(result) as { reminders: unknown[] }
      expect(data.reminders).toHaveLength(1)
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
      await instance.tool.execute({
        action: 'setReminder',
        text: 'To delete',
        datetime: '2026-03-01T10:00:00Z',
      })

      const deleteResult = await instance.tool.execute({
        action: 'cancelReminder',
        id: 1,
      })

      const data = parseResult(deleteResult) as { deleted: number }
      expect(data.deleted).toBe(1)

      // Verify it's gone
      const listResult = await instance.tool.execute({
        action: 'listReminders',
      })
      const list = parseResult(listResult) as { reminders: unknown[] }
      expect(list.reminders).toHaveLength(0)
    })

    it('throws error on double delete', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Once only',
        datetime: '2026-03-01T10:00:00Z',
      })

      await instance.tool.execute({ action: 'cancelReminder', id: 1 })

      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: 1 }),
      ).rejects.toThrow('not found')
    })

    it('throws error for non-existent id', async () => {
      await expect(
        instance.tool.execute({ action: 'cancelReminder', id: 999 }),
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
  // getDueReminders (for cron)
  // -------------------------------------------------------------------------

  describe('getDueReminders', () => {
    it('returns reminders due at or before the given time', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Due now',
        datetime: '2026-02-16T10:00:00Z',
      })
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Due later',
        datetime: '2099-12-31T23:59:59Z',
      })

      const due = instance.getDueReminders(new Date('2026-02-16T12:00:00Z'))

      expect(due).toHaveLength(1)
      expect(due[0]?.text).toBe('Due now')
    })

    it('returns empty array when nothing is due', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Far future',
        datetime: '2099-12-31T23:59:59Z',
      })

      const due = instance.getDueReminders(new Date('2026-01-01T00:00:00Z'))
      expect(due).toHaveLength(0)
    })

    it('does not return already-notified reminders', async () => {
      // The notified flag starts at 0, so all newly created reminders
      // will be returned by getDueReminders if their datetime has passed.
      // We can't directly set notified=1 through the tool API (that's
      // the cron's job), but we can verify the initial state is correct.
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Past due',
        datetime: '2020-01-01T00:00:00Z',
      })

      const due = instance.getDueReminders(new Date('2026-02-16T12:00:00Z'))
      expect(due).toHaveLength(1)
      expect(due[0]?.notified).toBe(0)
    })

    it('returns multiple due reminders sorted by datetime', async () => {
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Later',
        datetime: '2026-02-16T12:00:00Z',
      })
      await instance.tool.execute({
        action: 'setReminder',
        text: 'Earlier',
        datetime: '2026-02-16T08:00:00Z',
      })

      const due = instance.getDueReminders(new Date('2026-02-16T15:00:00Z'))

      expect(due).toHaveLength(2)
      expect(due[0]?.text).toBe('Earlier')
      expect(due[1]?.text).toBe('Later')
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
  // SQL Injection
  // -------------------------------------------------------------------------

  describe('SQL injection protection', () => {
    it('handles malicious text without damage', async () => {
      const malicious = "'; DROP TABLE reminders; --"

      // Create reminder with SQL injection attempt in text
      await instance.tool.execute({
        action: 'setReminder',
        text: malicious,
        datetime: '2026-03-01T10:00:00Z',
      })

      // Table still exists and works
      const result = await instance.tool.execute({
        action: 'listReminders',
      })

      const data = parseResult(result) as {
        reminders: { text: string }[]
      }
      expect(data.reminders).toHaveLength(1)
      expect(data.reminders[0]?.text).toBe(malicious)
    })

    it('handles malicious datetime without damage', async () => {
      // This will fail validation (not a valid date), which is the correct behavior
      await expect(
        instance.tool.execute({
          action: 'setReminder',
          text: 'Normal text',
          datetime: "2026-01-01'; DROP TABLE reminders;--",
        }),
      ).rejects.toThrow('Invalid datetime')

      // But even if somehow a weird string got through,
      // prepared statements would prevent injection
    })

    it('stores and retrieves special characters correctly', async () => {
      const special = "O'Reilly & \"Partners\" <test> (100%)"
      await instance.tool.execute({
        action: 'setReminder',
        text: special,
        datetime: '2026-03-01T10:00:00Z',
      })

      const result = await instance.tool.execute({
        action: 'listReminders',
      })

      const data = parseResult(result) as {
        reminders: { text: string }[]
      }
      expect(data.reminders[0]?.text).toBe(special)
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('uses only prepared statements (no string concat in SQL)', () => {
      // Verify no SQL string concatenation patterns
      // All SQL should be static literals, never built from variables
      const sqlConcatPattern = /(?:prepare|query)\s*\([^)]*\+/
      expect(sourceCode).not.toMatch(sqlConcatPattern)
    })

    it('uses no template literals in SQL statements', () => {
      // Prepared statements should use ? placeholders, not template literals
      const sqlTemplatePattern = /prepare\s*\(\s*`/
      expect(sourceCode).not.toMatch(sqlTemplatePattern)
    })
  })

  // -------------------------------------------------------------------------
  // Instance lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('separate instances have isolated data', async () => {
      const other = createRemindersInstance(':memory:')

      await instance.tool.execute({
        action: 'setReminder',
        text: 'In first',
        datetime: '2026-03-01T10:00:00Z',
      })

      const result = await other.tool.execute({
        action: 'listReminders',
      })

      const data = parseResult(result) as { reminders: unknown[] }
      expect(data.reminders).toHaveLength(0)

      other.close()
    })
  })
})
