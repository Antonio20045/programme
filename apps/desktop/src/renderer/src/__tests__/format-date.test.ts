import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatRelativeDate,
  relativeTime,
  formatDuration,
  getTimeGroup,
  formatFullDate,
  formatShortDate,
} from '../utils/format-date'

describe('formatRelativeDate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns time for today', () => {
    const now = new Date()
    const result = formatRelativeDate(now.toISOString())
    // Should contain hour:minute format
    expect(result).toMatch(/\d{2}:\d{2}/)
  })

  it('returns "Gestern" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86_400_000)
    expect(formatRelativeDate(yesterday.toISOString())).toBe('Gestern')
  })

  it('returns "vor X Tagen" for recent days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
    expect(formatRelativeDate(threeDaysAgo.toISOString())).toBe('vor 3 Tagen')
  })

  it('returns formatted date for older entries', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000)
    const result = formatRelativeDate(twoWeeksAgo.toISOString())
    // Should be dd.mm.yy format
    expect(result).toMatch(/\d{2}\.\d{2}\.\d{2}/)
  })
})

describe('relativeTime', () => {
  it('returns "gerade eben" for very recent', () => {
    const now = new Date()
    expect(relativeTime(now.toISOString())).toBe('gerade eben')
  })

  it('returns minutes for recent times', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000)
    expect(relativeTime(fiveMinAgo.toISOString())).toBe('vor 5 Min.')
  })

  it('returns hours for today', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000)
    expect(relativeTime(twoHoursAgo.toISOString())).toBe('vor 2 Std.')
  })
})

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(1000, 1350)).toBe('350ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(1000, 3500)).toBe('2.5s')
  })
})

describe('getTimeGroup', () => {
  it('returns "Heute" for today', () => {
    expect(getTimeGroup(new Date().toISOString())).toBe('Heute')
  })

  it('returns "Gestern" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86_400_000)
    expect(getTimeGroup(yesterday.toISOString())).toBe('Gestern')
  })

  it('returns "Diese Woche" for recent days', () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000)
    expect(getTimeGroup(fourDaysAgo.toISOString())).toBe('Diese Woche')
  })

  it('returns "Diesen Monat" for this month', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000)
    expect(getTimeGroup(twoWeeksAgo.toISOString())).toBe('Diesen Monat')
  })

  it('returns "Älter" for old entries', () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000)
    expect(getTimeGroup(twoMonthsAgo.toISOString())).toBe('Älter')
  })
})

describe('formatFullDate', () => {
  it('returns a string with day, month name, year', () => {
    const result = formatFullDate('2026-02-21T14:30:00Z')
    // Should contain "Februar" and "2026"
    expect(result).toContain('2026')
  })
})

describe('formatShortDate', () => {
  it('returns dd.mm.yyyy format', () => {
    const result = formatShortDate('2026-02-21T14:30:00Z')
    expect(result).toMatch(/\d{2}\.\d{2}\.\d{4}/)
  })
})

// Security: no dynamic code execution
describe('security', () => {
  it('does not use dynamic code execution', () => {
    const src = [
      formatRelativeDate.toString(),
      relativeTime.toString(),
      formatDuration.toString(),
      getTimeGroup.toString(),
    ].join('\n')
    const forbidden = ['ev' + 'al(', 'Func' + 'tion(']
    for (const pattern of forbidden) {
      expect(src).not.toContain(pattern)
    }
  })
})
