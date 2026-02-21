import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { datetimeTool, easterSunday, parseIsoDate, getDeHolidays } from '../src/datetime'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/datetime.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): unknown {
  const first = result.content[0] as { type: 'text'; text: string }
  return JSON.parse(first.text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('datetime tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(datetimeTool.name).toBe('datetime')
    })

    it('runs on server', () => {
      expect(datetimeTool.runsOn).toBe('server')
    })

    it('has no permissions', () => {
      expect(datetimeTool.permissions).toEqual([])
    })

    it('does not require confirmation', () => {
      expect(datetimeTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // now()
  // -------------------------------------------------------------------------

  describe('now()', () => {
    it('returns current time in UTC', async () => {
      const result = parseResult(await datetimeTool.execute({ action: 'now' })) as {
        iso: string; timezone: string; timestamp: number
      }
      expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(result.timezone).toBe('UTC')
      expect(typeof result.timestamp).toBe('number')
    })

    it('accepts timezone parameter', async () => {
      const result = parseResult(await datetimeTool.execute({ action: 'now', timezone: 'Europe/Berlin' })) as {
        timezone: string
      }
      expect(result.timezone).toBe('Europe/Berlin')
    })

    it('rejects invalid timezone', async () => {
      await expect(
        datetimeTool.execute({ action: 'now', timezone: 'Invalid/Zone' }),
      ).rejects.toThrow('Invalid timezone')
    })
  })

  // -------------------------------------------------------------------------
  // convert()
  // -------------------------------------------------------------------------

  describe('convert()', () => {
    it('converts between timezones', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'convert',
        date: '2024-06-15T12:00:00Z',
        fromTimezone: 'UTC',
        toTimezone: 'Europe/Berlin',
      })) as { from: { timezone: string }; to: { timezone: string; formatted: string } }
      expect(result.from.timezone).toBe('UTC')
      expect(result.to.timezone).toBe('Europe/Berlin')
      // Berlin is UTC+2 in summer
      expect(result.to.formatted).toContain('14:00:00')
    })

    it('rejects invalid fromTimezone', async () => {
      await expect(
        datetimeTool.execute({ action: 'convert', date: '2024-01-01', fromTimezone: 'Bad/TZ', toTimezone: 'UTC' }),
      ).rejects.toThrow('Invalid timezone')
    })
  })

  // -------------------------------------------------------------------------
  // diff()
  // -------------------------------------------------------------------------

  describe('diff()', () => {
    it('calculates difference in days', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'diff',
        date1: '2024-01-01',
        date2: '2024-01-11',
      })) as { totalDays: number; direction: string }
      expect(result.totalDays).toBe(10)
      expect(result.direction).toBe('forward')
    })

    it('handles backward direction', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'diff',
        date1: '2024-01-11',
        date2: '2024-01-01',
      })) as { totalDays: number; direction: string }
      expect(result.totalDays).toBe(10)
      expect(result.direction).toBe('backward')
    })

    it('returns zero for same dates', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'diff',
        date1: '2024-06-15T12:00:00Z',
        date2: '2024-06-15T12:00:00Z',
      })) as { totalDays: number; diffMs: number }
      expect(result.diffMs).toBe(0)
      expect(result.totalDays).toBe(0)
    })

    it('calculates hours and minutes', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'diff',
        date1: '2024-01-01T10:00:00Z',
        date2: '2024-01-01T13:30:00Z',
      })) as { hours: number; minutes: number; totalHours: number }
      expect(result.totalHours).toBe(3)
      expect(result.minutes).toBe(30)
    })
  })

  // -------------------------------------------------------------------------
  // add()
  // -------------------------------------------------------------------------

  describe('add()', () => {
    it('adds days', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'add',
        date: '2024-01-01T00:00:00Z',
        days: 10,
      })) as { result: string }
      expect(result.result).toBe('2024-01-11T00:00:00.000Z')
    })

    it('adds months with overflow handling (Jan 31 + 1 month)', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'add',
        date: '2024-01-31T00:00:00Z',
        months: 1,
      })) as { result: string }
      // Should be Feb 29 (2024 is leap year), not March
      expect(result.result).toBe('2024-02-29T00:00:00.000Z')
    })

    it('adds years', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'add',
        date: '2024-03-15T00:00:00Z',
        years: 1,
      })) as { result: string }
      expect(result.result).toContain('2025-03-15')
    })

    it('adds negative days (subtract)', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'add',
        date: '2024-01-11T00:00:00Z',
        days: -10,
      })) as { result: string }
      expect(result.result).toBe('2024-01-01T00:00:00.000Z')
    })

    it('adds hours and minutes', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'add',
        date: '2024-01-01T10:00:00Z',
        hours: 3,
        minutes: 30,
      })) as { result: string }
      expect(result.result).toBe('2024-01-01T13:30:00.000Z')
    })
  })

  // -------------------------------------------------------------------------
  // format()
  // -------------------------------------------------------------------------

  describe('format()', () => {
    it('formats date with template', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'format',
        date: '2024-03-15T00:00:00Z',
        template: '{YYYY}-{MM}-{DD}',
      })) as { formatted: string }
      expect(result.formatted).toBe('2024-03-15')
    })

    it('includes weekday token', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'format',
        date: '2024-03-15T00:00:00Z',
        template: '{weekday}, {YYYY}-{MM}-{DD}',
      })) as { formatted: string }
      expect(result.formatted).toContain('Friday')
    })

    it('formats time components', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'format',
        date: '2024-03-15T14:30:45Z',
        template: '{HH}:{mm}:{ss}',
      })) as { formatted: string }
      expect(result.formatted).toBe('14:30:45')
    })
  })

  // -------------------------------------------------------------------------
  // weekday()
  // -------------------------------------------------------------------------

  describe('weekday()', () => {
    it('returns correct weekday for known date', async () => {
      // 2024-03-15 is a Friday
      const result = parseResult(await datetimeTool.execute({
        action: 'weekday',
        date: '2024-03-15',
      })) as { weekday: string; dayIndex: number }
      expect(result.weekday).toBe('Friday')
      expect(result.dayIndex).toBe(5)
    })

    it('returns Sunday for a known Sunday', async () => {
      // 2024-03-17 is a Sunday
      const result = parseResult(await datetimeTool.execute({
        action: 'weekday',
        date: '2024-03-17',
      })) as { weekday: string }
      expect(result.weekday).toBe('Sunday')
    })
  })

  // -------------------------------------------------------------------------
  // calendar()
  // -------------------------------------------------------------------------

  describe('calendar()', () => {
    it('returns German holidays for 2024', async () => {
      const result = parseResult(await datetimeTool.execute({
        action: 'calendar',
        year: 2024,
      })) as { holidays: { date: string; name: string }[] }
      expect(result.holidays.length).toBeGreaterThan(0)
      const names = result.holidays.map((h) => h.name)
      expect(names).toContain('Neujahr')
      expect(names).toContain('Karfreitag')
      expect(names).toContain('Tag der Deutschen Einheit')
    })

    it('rejects year out of range', async () => {
      await expect(
        datetimeTool.execute({ action: 'calendar', year: 1000 }),
      ).rejects.toThrow('between 1583 and 9999')
    })

    it('rejects unsupported country', async () => {
      await expect(
        datetimeTool.execute({ action: 'calendar', year: 2024, country: 'us' }),
      ).rejects.toThrow('only "de"')
    })
  })

  // -------------------------------------------------------------------------
  // Gauss Easter algorithm — exported
  // -------------------------------------------------------------------------

  describe('easterSunday()', () => {
    it('returns correct Easter 2024 (March 31)', () => {
      const easter = easterSunday(2024)
      expect(easter.month).toBe(3)
      expect(easter.day).toBe(31)
    })

    it('returns correct Easter 2025 (April 20)', () => {
      const easter = easterSunday(2025)
      expect(easter.month).toBe(4)
      expect(easter.day).toBe(20)
    })

    it('returns correct Easter 2026 (April 5)', () => {
      const easter = easterSunday(2026)
      expect(easter.month).toBe(4)
      expect(easter.day).toBe(5)
    })
  })

  // -------------------------------------------------------------------------
  // parseIsoDate() — exported
  // -------------------------------------------------------------------------

  describe('parseIsoDate()', () => {
    it('parses date-only format', () => {
      const d = parseIsoDate('2024-03-15')
      expect(d.getFullYear()).toBe(2024)
    })

    it('parses full ISO format', () => {
      const d = parseIsoDate('2024-03-15T10:30:00Z')
      expect(d.getUTCHours()).toBe(10)
    })

    it('rejects invalid format', () => {
      expect(() => parseIsoDate('March 15, 2024')).toThrow('Invalid date format')
    })

    it('rejects invalid date values', () => {
      expect(() => parseIsoDate('2024-13-45')).toThrow('Invalid date')
    })
  })

  // -------------------------------------------------------------------------
  // getDeHolidays() — exported
  // -------------------------------------------------------------------------

  describe('getDeHolidays()', () => {
    it('returns sorted holidays', () => {
      const holidays = getDeHolidays(2024)
      for (let i = 1; i < holidays.length; i++) {
        const prev = holidays[i - 1] as { date: string }
        const curr = holidays[i] as { date: string }
        expect(prev.date <= curr.date).toBe(true)
      }
    })

    it('includes Karfreitag two days before Easter', () => {
      const holidays = getDeHolidays(2024)
      const karfreitag = holidays.find((h) => h.name === 'Karfreitag')
      // Easter 2024 = March 31, so Karfreitag = March 29
      expect(karfreitag?.date).toBe('2024-03-29')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(datetimeTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(datetimeTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        datetimeTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects diff without date1', async () => {
      await expect(
        datetimeTool.execute({ action: 'diff', date2: '2024-01-01' }),
      ).rejects.toThrow('non-empty "date1"')
    })

    it('rejects add without date', async () => {
      await expect(
        datetimeTool.execute({ action: 'add', days: 5 }),
      ).rejects.toThrow('non-empty "date"')
    })

    it('rejects format without template', async () => {
      await expect(
        datetimeTool.execute({ action: 'format', date: '2024-01-01' }),
      ).rejects.toThrow('non-empty "template"')
    })

    it('rejects calendar without year', async () => {
      await expect(
        datetimeTool.execute({ action: 'calendar' }),
      ).rejects.toThrow('integer "year"')
    })

    it('rejects calendar with non-integer year', async () => {
      await expect(
        datetimeTool.execute({ action: 'calendar', year: 2024.5 }),
      ).rejects.toThrow('integer "year"')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })
  })
})
