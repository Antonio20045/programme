/**
 * DateTime tool — date/time operations using native Intl/Date APIs.
 * Includes German holiday calculation via Gauss Easter algorithm.
 * No external dependencies, no network, no file I/O.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NowArgs {
  readonly action: 'now'
  readonly timezone?: string
}

interface ConvertArgs {
  readonly action: 'convert'
  readonly date: string
  readonly fromTimezone: string
  readonly toTimezone: string
}

interface DiffArgs {
  readonly action: 'diff'
  readonly date1: string
  readonly date2: string
}

interface AddArgs {
  readonly action: 'add'
  readonly date: string
  readonly years?: number
  readonly months?: number
  readonly days?: number
  readonly hours?: number
  readonly minutes?: number
  readonly seconds?: number
}

interface FormatArgs {
  readonly action: 'format'
  readonly date: string
  readonly template: string
  readonly timezone?: string
}

interface WeekdayArgs {
  readonly action: 'weekday'
  readonly date: string
}

interface CalendarArgs {
  readonly action: 'calendar'
  readonly year: number
  readonly country?: string
}

type DateTimeArgs = NowArgs | ConvertArgs | DiffArgs | AddArgs | FormatArgs | WeekdayArgs | CalendarArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const WEEKDAY_NAMES: readonly string[] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

// ---------------------------------------------------------------------------
// Date parsing & timezone validation
// ---------------------------------------------------------------------------

function parseIsoDate(input: string): Date {
  if (!ISO_DATE_REGEX.test(input)) {
    throw new Error(`Invalid date format: "${input}" — use ISO 8601 (e.g. 2024-03-15 or 2024-03-15T10:30:00Z)`)
  }
  const d = new Date(input)
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: "${input}"`)
  }
  return d
}

function validateTimezone(tz: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
  } catch {
    throw new Error(`Invalid timezone: "${tz}"`)
  }
}

// ---------------------------------------------------------------------------
// Gauss Easter Algorithm
// ---------------------------------------------------------------------------

function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

// ---------------------------------------------------------------------------
// German holidays
// ---------------------------------------------------------------------------

interface Holiday {
  readonly date: string
  readonly name: string
}

function getDeHolidays(year: number): Holiday[] {
  const easter = easterSunday(year)
  const easterDate = new Date(year, easter.month - 1, easter.day)

  function addDays(base: Date, days: number): Date {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d
  }

  function fmt(d: Date): string {
    const y = String(d.getFullYear())
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const holidays: Holiday[] = [
    // Fixed holidays
    { date: `${String(year)}-01-01`, name: 'Neujahr' },
    { date: `${String(year)}-05-01`, name: 'Tag der Arbeit' },
    { date: `${String(year)}-10-03`, name: 'Tag der Deutschen Einheit' },
    { date: `${String(year)}-12-25`, name: '1. Weihnachtstag' },
    { date: `${String(year)}-12-26`, name: '2. Weihnachtstag' },
    // Easter-relative holidays
    { date: fmt(addDays(easterDate, -2)), name: 'Karfreitag' },
    { date: fmt(addDays(easterDate, 1)), name: 'Ostermontag' },
    { date: fmt(addDays(easterDate, 39)), name: 'Christi Himmelfahrt' },
    { date: fmt(addDays(easterDate, 50)), name: 'Pfingstmontag' },
  ]

  holidays.sort((a, b) => a.date.localeCompare(b.date))
  return holidays
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function executeNow(args: NowArgs): AgentToolResult {
  if (args.timezone) {
    validateTimezone(args.timezone)
  }
  const now = new Date()
  const tz = args.timezone ?? 'UTC'
  const formatted = now.toLocaleString('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return textResult(JSON.stringify({
    iso: now.toISOString(),
    formatted,
    timezone: tz,
    timestamp: now.getTime(),
  }))
}

function executeConvert(args: ConvertArgs): AgentToolResult {
  validateTimezone(args.fromTimezone)
  validateTimezone(args.toTimezone)
  const date = parseIsoDate(args.date)

  const fromFormatted = date.toLocaleString('en-GB', {
    timeZone: args.fromTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const toFormatted = date.toLocaleString('en-GB', {
    timeZone: args.toTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })

  return textResult(JSON.stringify({
    original: args.date,
    from: { timezone: args.fromTimezone, formatted: fromFormatted },
    to: { timezone: args.toTimezone, formatted: toFormatted },
  }))
}

function executeDiff(args: DiffArgs): AgentToolResult {
  const d1 = parseIsoDate(args.date1)
  const d2 = parseIsoDate(args.date2)
  const diffMs = d2.getTime() - d1.getTime()
  const absDiff = Math.abs(diffMs)

  const totalSeconds = Math.floor(absDiff / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)

  return textResult(JSON.stringify({
    date1: args.date1,
    date2: args.date2,
    diffMs,
    days: totalDays,
    hours: totalHours % 24,
    minutes: totalMinutes % 60,
    seconds: totalSeconds % 60,
    totalDays,
    totalHours,
    totalMinutes,
    totalSeconds,
    direction: diffMs >= 0 ? 'forward' : 'backward',
  }))
}

function executeAdd(args: AddArgs): AgentToolResult {
  const date = parseIsoDate(args.date)

  if (args.years) {
    date.setFullYear(date.getFullYear() + args.years)
  }
  if (args.months) {
    // Handle month overflow: Jan 31 + 1 month = Feb 28
    const targetMonth = date.getMonth() + args.months
    const dayBefore = date.getDate()
    date.setMonth(targetMonth)
    // If the day rolled over (e.g. 31 March -> 3 April), clamp to last day of target month
    if (date.getDate() !== dayBefore) {
      date.setDate(0) // Go to last day of previous month (= the target month)
    }
  }
  if (args.days) {
    date.setDate(date.getDate() + args.days)
  }
  if (args.hours) {
    date.setHours(date.getHours() + args.hours)
  }
  if (args.minutes) {
    date.setMinutes(date.getMinutes() + args.minutes)
  }
  if (args.seconds) {
    date.setSeconds(date.getSeconds() + args.seconds)
  }

  return textResult(JSON.stringify({
    original: args.date,
    result: date.toISOString(),
  }))
}

function executeFormat(args: FormatArgs): AgentToolResult {
  if (args.timezone) {
    validateTimezone(args.timezone)
  }
  const date = parseIsoDate(args.date)
  const tz = args.timezone ?? 'UTC'

  // Use Intl.DateTimeFormat.formatToParts for template tokens
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
  }).formatToParts(date)

  const partMap: Record<string, string> = {}
  for (const p of parts) {
    partMap[p.type] = p.value
  }

  const formatted = args.template
    .replace(/\{YYYY\}/g, partMap['year'] ?? '')
    .replace(/\{MM\}/g, partMap['month'] ?? '')
    .replace(/\{DD\}/g, partMap['day'] ?? '')
    .replace(/\{HH\}/g, partMap['hour'] ?? '')
    .replace(/\{mm\}/g, partMap['minute'] ?? '')
    .replace(/\{ss\}/g, partMap['second'] ?? '')
    .replace(/\{weekday\}/g, partMap['weekday'] ?? '')

  return textResult(JSON.stringify({
    original: args.date,
    template: args.template,
    formatted,
    timezone: tz,
  }))
}

function executeWeekday(args: WeekdayArgs): AgentToolResult {
  const date = parseIsoDate(args.date)
  const dayIndex = date.getUTCDay()
  const weekday = WEEKDAY_NAMES[dayIndex] as string

  return textResult(JSON.stringify({
    date: args.date,
    weekday,
    dayIndex,
  }))
}

function executeCalendar(args: CalendarArgs): AgentToolResult {
  const year = args.year
  if (year < 1583 || year > 9999) {
    throw new Error('Year must be between 1583 and 9999')
  }
  const country = (args.country ?? 'de').toLowerCase()
  if (country !== 'de') {
    throw new Error('Currently only "de" (Germany) is supported')
  }

  const holidays = getDeHolidays(year)
  return textResult(JSON.stringify({ year, country, holidays }))
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): DateTimeArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'now') {
    const timezone = obj['timezone']
    return {
      action: 'now',
      timezone: typeof timezone === 'string' && timezone.trim() !== '' ? timezone.trim() : undefined,
    }
  }

  if (action === 'convert') {
    const date = obj['date']
    const fromTimezone = obj['fromTimezone']
    const toTimezone = obj['toTimezone']
    if (typeof date !== 'string' || date.trim() === '') {
      throw new Error('convert requires a non-empty "date" string')
    }
    if (typeof fromTimezone !== 'string' || fromTimezone.trim() === '') {
      throw new Error('convert requires a non-empty "fromTimezone" string')
    }
    if (typeof toTimezone !== 'string' || toTimezone.trim() === '') {
      throw new Error('convert requires a non-empty "toTimezone" string')
    }
    return { action: 'convert', date: date.trim(), fromTimezone: fromTimezone.trim(), toTimezone: toTimezone.trim() }
  }

  if (action === 'diff') {
    const date1 = obj['date1']
    const date2 = obj['date2']
    if (typeof date1 !== 'string' || date1.trim() === '') {
      throw new Error('diff requires a non-empty "date1" string')
    }
    if (typeof date2 !== 'string' || date2.trim() === '') {
      throw new Error('diff requires a non-empty "date2" string')
    }
    return { action: 'diff', date1: date1.trim(), date2: date2.trim() }
  }

  if (action === 'add') {
    const date = obj['date']
    if (typeof date !== 'string' || date.trim() === '') {
      throw new Error('add requires a non-empty "date" string')
    }
    const years = typeof obj['years'] === 'number' ? obj['years'] : undefined
    const months = typeof obj['months'] === 'number' ? obj['months'] : undefined
    const days = typeof obj['days'] === 'number' ? obj['days'] : undefined
    const hours = typeof obj['hours'] === 'number' ? obj['hours'] : undefined
    const minutes = typeof obj['minutes'] === 'number' ? obj['minutes'] : undefined
    const seconds = typeof obj['seconds'] === 'number' ? obj['seconds'] : undefined
    return { action: 'add', date: date.trim(), years, months, days, hours, minutes, seconds }
  }

  if (action === 'format') {
    const date = obj['date']
    const template = obj['template']
    const timezone = obj['timezone']
    if (typeof date !== 'string' || date.trim() === '') {
      throw new Error('format requires a non-empty "date" string')
    }
    if (typeof template !== 'string' || template.trim() === '') {
      throw new Error('format requires a non-empty "template" string')
    }
    return {
      action: 'format',
      date: date.trim(),
      template: template.trim(),
      timezone: typeof timezone === 'string' && timezone.trim() !== '' ? timezone.trim() : undefined,
    }
  }

  if (action === 'weekday') {
    const date = obj['date']
    if (typeof date !== 'string' || date.trim() === '') {
      throw new Error('weekday requires a non-empty "date" string')
    }
    return { action: 'weekday', date: date.trim() }
  }

  if (action === 'calendar') {
    const year = obj['year']
    if (typeof year !== 'number' || !Number.isInteger(year)) {
      throw new Error('calendar requires an integer "year"')
    }
    const country = obj['country']
    return {
      action: 'calendar',
      year,
      country: typeof country === 'string' && country.trim() !== '' ? country.trim() : undefined,
    }
  }

  throw new Error('action must be "now", "convert", "diff", "add", "format", "weekday", or "calendar"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "now", "convert", "diff", "add", "format", "weekday", or "calendar"',
      enum: ['now', 'convert', 'diff', 'add', 'format', 'weekday', 'calendar'],
    },
    date: {
      type: 'string',
      description: 'ISO 8601 date string (e.g. 2024-03-15 or 2024-03-15T10:30:00Z)',
    },
    date1: {
      type: 'string',
      description: 'First date for diff (ISO 8601)',
    },
    date2: {
      type: 'string',
      description: 'Second date for diff (ISO 8601)',
    },
    timezone: {
      type: 'string',
      description: 'IANA timezone (e.g. Europe/Berlin, America/New_York)',
    },
    fromTimezone: {
      type: 'string',
      description: 'Source timezone for convert (IANA)',
    },
    toTimezone: {
      type: 'string',
      description: 'Target timezone for convert (IANA)',
    },
    template: {
      type: 'string',
      description: 'Format template with tokens: {YYYY}, {MM}, {DD}, {HH}, {mm}, {ss}, {weekday}',
    },
    years: { type: 'number', description: 'Years to add (add action)' },
    months: { type: 'number', description: 'Months to add (add action)' },
    days: { type: 'number', description: 'Days to add (add action)' },
    hours: { type: 'number', description: 'Hours to add (add action)' },
    minutes: { type: 'number', description: 'Minutes to add (add action)' },
    seconds: { type: 'number', description: 'Seconds to add (add action)' },
    year: {
      type: 'integer',
      description: 'Year for calendar (1583-9999)',
    },
    country: {
      type: 'string',
      description: 'Country code for calendar (currently only "de")',
    },
  },
  required: ['action'],
}

export const datetimeTool: ExtendedAgentTool = {
  name: 'datetime',
  description:
    'Date and time operations. Actions: now(timezone?) gets current time; convert(date, fromTimezone, toTimezone) converts between timezones; diff(date1, date2) calculates difference; add(date, years?, months?, days?, hours?, minutes?, seconds?) adds duration; format(date, template, timezone?) formats with template; weekday(date) gets day of week; calendar(year, country?) lists holidays.',
  parameters,
  permissions: [],
  requiresConfirmation: false,
  defaultRiskTier: 0,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'now':
        return executeNow(parsed)
      case 'convert':
        return executeConvert(parsed)
      case 'diff':
        return executeDiff(parsed)
      case 'add':
        return executeAdd(parsed)
      case 'format':
        return executeFormat(parsed)
      case 'weekday':
        return executeWeekday(parsed)
      case 'calendar':
        return executeCalendar(parsed)
    }
  },
}

export { easterSunday, parseIsoDate, getDeHolidays }
