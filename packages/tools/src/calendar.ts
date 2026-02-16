/**
 * Google Calendar tool — list, create, update, and delete calendar events.
 * OAuth2 token from OS Keychain via keytar.
 *
 * URL policy: Only requests to https://www.googleapis.com are permitted.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarEvent {
  readonly id: string
  readonly summary: string
  readonly description: string
  readonly start: string
  readonly end: string
  readonly attendees: readonly string[]
}

interface GoogleDateTime {
  readonly dateTime?: string
  readonly date?: string
}

interface GoogleAttendee {
  readonly email?: string
}

interface GoogleEvent {
  readonly id?: string
  readonly summary?: string
  readonly description?: string
  readonly start?: GoogleDateTime
  readonly end?: GoogleDateTime
  readonly attendees?: readonly GoogleAttendee[]
}

interface GoogleEventsResponse {
  readonly items?: readonly GoogleEvent[]
}

interface GoogleTokenResponse {
  readonly access_token?: string
  readonly expires_in?: number
}

interface ListEventsArgs {
  readonly action: 'listEvents'
  readonly timeMin: string
  readonly timeMax: string
  readonly calendarId?: string
}

interface CreateEventArgs {
  readonly action: 'createEvent'
  readonly title: string
  readonly start: string
  readonly end: string
  readonly description?: string
  readonly attendees?: readonly string[]
}

interface UpdateEventArgs {
  readonly action: 'updateEvent'
  readonly eventId: string
  readonly updates: {
    readonly title?: string
    readonly start?: string
    readonly end?: string
    readonly description?: string
    readonly attendees?: readonly string[]
  }
}

interface DeleteEventArgs {
  readonly action: 'deleteEvent'
  readonly eventId: string
}

type CalendarArgs = ListEventsArgs | CreateEventArgs | UpdateEventArgs | DeleteEventArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 10_000
const DEFAULT_CALENDAR_ID = 'primary'

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function assertGoogleApisUrl(url: string): void {
  const parsed = new URL(url)
  if (
    parsed.hostname !== 'www.googleapis.com' &&
    parsed.hostname !== 'oauth2.googleapis.com'
  ) {
    throw new Error(
      `Blocked request to "${parsed.hostname}" — only googleapis.com is allowed`,
    )
  }
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

interface TokenStore {
  accessToken: string
  refreshToken: string
  clientId: string
  clientSecret: string
  expiresAt: number
}

function getTokenStore(): TokenStore {
  const accessToken = process.env['GOOGLE_ACCESS_TOKEN']
  if (!accessToken) {
    throw new Error('GOOGLE_ACCESS_TOKEN environment variable is required')
  }

  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN']
  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN environment variable is required')
  }

  const clientId = process.env['GOOGLE_CLIENT_ID']
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is required')
  }

  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
  if (!clientSecret) {
    throw new Error('GOOGLE_CLIENT_SECRET environment variable is required')
  }

  const expiresAtRaw = process.env['GOOGLE_TOKEN_EXPIRES_AT']
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0

  return { accessToken, refreshToken, clientId, clientSecret, expiresAt }
}

async function refreshAccessToken(store: TokenStore): Promise<string> {
  const url = TOKEN_URL
  assertGoogleApisUrl(url)

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: store.refreshToken,
    client_id: store.clientId,
    client_secret: store.clientSecret,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${String(response.status)} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as GoogleTokenResponse
  if (!data.access_token) {
    throw new Error('Token refresh response missing access_token')
  }

  return data.access_token
}

async function getValidAccessToken(): Promise<string> {
  const store = getTokenStore()

  if (store.expiresAt > 0 && Date.now() < store.expiresAt) {
    return store.accessToken
  }

  return refreshAccessToken(store)
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function calendarFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  assertGoogleApisUrl(url)

  const token = await getValidAccessToken()
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (response.status === 401) {
    const store = getTokenStore()
    const newToken = await refreshAccessToken(store)
    headers.set('Authorization', `Bearer ${newToken}`)

    const retryResponse = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!retryResponse.ok) {
      throw new Error(
        `Calendar API error: ${String(retryResponse.status)} ${retryResponse.statusText}`,
      )
    }

    return retryResponse
  }

  if (!response.ok) {
    throw new Error(
      `Calendar API error: ${String(response.status)} ${response.statusText}`,
    )
  }

  return response
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): CalendarArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'listEvents') {
    const timeMin = obj['timeMin']
    const timeMax = obj['timeMax']
    if (typeof timeMin !== 'string' || timeMin.trim() === '') {
      throw new Error('listEvents requires a non-empty "timeMin" string')
    }
    if (typeof timeMax !== 'string' || timeMax.trim() === '') {
      throw new Error('listEvents requires a non-empty "timeMax" string')
    }
    const calendarId = obj['calendarId']
    return {
      action: 'listEvents',
      timeMin: timeMin.trim(),
      timeMax: timeMax.trim(),
      calendarId: typeof calendarId === 'string' ? calendarId.trim() : undefined,
    }
  }

  if (action === 'createEvent') {
    const title = obj['title']
    const start = obj['start']
    const end = obj['end']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('createEvent requires a non-empty "title" string')
    }
    if (typeof start !== 'string' || start.trim() === '') {
      throw new Error('createEvent requires a non-empty "start" string')
    }
    if (typeof end !== 'string' || end.trim() === '') {
      throw new Error('createEvent requires a non-empty "end" string')
    }
    const description = obj['description']
    const attendees = obj['attendees']
    return {
      action: 'createEvent',
      title: title.trim(),
      start: start.trim(),
      end: end.trim(),
      description: typeof description === 'string' ? description.trim() : undefined,
      attendees: Array.isArray(attendees)
        ? attendees.filter((a): a is string => typeof a === 'string')
        : undefined,
    }
  }

  if (action === 'updateEvent') {
    const eventId = obj['eventId']
    if (typeof eventId !== 'string' || eventId.trim() === '') {
      throw new Error('updateEvent requires a non-empty "eventId" string')
    }
    const updates = obj['updates']
    if (typeof updates !== 'object' || updates === null) {
      throw new Error('updateEvent requires an "updates" object')
    }
    const u = updates as Record<string, unknown>
    return {
      action: 'updateEvent',
      eventId: eventId.trim(),
      updates: {
        title: typeof u['title'] === 'string' ? u['title'].trim() : undefined,
        start: typeof u['start'] === 'string' ? u['start'].trim() : undefined,
        end: typeof u['end'] === 'string' ? u['end'].trim() : undefined,
        description: typeof u['description'] === 'string' ? u['description'].trim() : undefined,
        attendees: Array.isArray(u['attendees'])
          ? (u['attendees'] as unknown[]).filter((a): a is string => typeof a === 'string')
          : undefined,
      },
    }
  }

  if (action === 'deleteEvent') {
    const eventId = obj['eventId']
    if (typeof eventId !== 'string' || eventId.trim() === '') {
      throw new Error('deleteEvent requires a non-empty "eventId" string')
    }
    return { action: 'deleteEvent', eventId: eventId.trim() }
  }

  throw new Error(
    'action must be "listEvents", "createEvent", "updateEvent", or "deleteEvent"',
  )
}

// ---------------------------------------------------------------------------
// Event formatting
// ---------------------------------------------------------------------------

function formatEvent(raw: GoogleEvent): CalendarEvent {
  return {
    id: raw.id ?? '',
    summary: raw.summary ?? '',
    description: raw.description ?? '',
    start: raw.start?.dateTime ?? raw.start?.date ?? '',
    end: raw.end?.dateTime ?? raw.end?.date ?? '',
    attendees: (raw.attendees ?? [])
      .map((a) => a.email)
      .filter((e): e is string => typeof e === 'string'),
  }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeListEvents(args: ListEventsArgs): Promise<AgentToolResult> {
  const calendarId = encodeURIComponent(args.calendarId ?? DEFAULT_CALENDAR_ID)
  const params = new URLSearchParams({
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const url = `${API_BASE}/calendars/${calendarId}/events?${params.toString()}`
  const response = await calendarFetch(url, { method: 'GET' })
  const data = (await response.json()) as GoogleEventsResponse
  const events = (data.items ?? []).map(formatEvent)

  return {
    content: [{ type: 'text', text: JSON.stringify({ events }) }],
  }
}

async function executeCreateEvent(args: CreateEventArgs): Promise<AgentToolResult> {
  const calendarId = encodeURIComponent(DEFAULT_CALENDAR_ID)
  const url = `${API_BASE}/calendars/${calendarId}/events`

  const body: Record<string, unknown> = {
    summary: args.title,
    start: { dateTime: args.start },
    end: { dateTime: args.end },
  }

  if (args.description !== undefined) {
    body['description'] = args.description
  }

  if (args.attendees !== undefined && args.attendees.length > 0) {
    body['attendees'] = args.attendees.map((email) => ({ email }))
  }

  const response = await calendarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as GoogleEvent
  const event = formatEvent(data)

  return {
    content: [{ type: 'text', text: JSON.stringify({ event }) }],
  }
}

async function executeUpdateEvent(args: UpdateEventArgs): Promise<AgentToolResult> {
  const calendarId = encodeURIComponent(DEFAULT_CALENDAR_ID)
  const eventId = encodeURIComponent(args.eventId)
  const url = `${API_BASE}/calendars/${calendarId}/events/${eventId}`

  const body: Record<string, unknown> = {}

  if (args.updates.title !== undefined) {
    body['summary'] = args.updates.title
  }
  if (args.updates.start !== undefined) {
    body['start'] = { dateTime: args.updates.start }
  }
  if (args.updates.end !== undefined) {
    body['end'] = { dateTime: args.updates.end }
  }
  if (args.updates.description !== undefined) {
    body['description'] = args.updates.description
  }
  if (args.updates.attendees !== undefined) {
    body['attendees'] = args.updates.attendees.map((email) => ({ email }))
  }

  const response = await calendarFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as GoogleEvent
  const event = formatEvent(data)

  return {
    content: [{ type: 'text', text: JSON.stringify({ event }) }],
  }
}

async function executeDeleteEvent(args: DeleteEventArgs): Promise<AgentToolResult> {
  const calendarId = encodeURIComponent(DEFAULT_CALENDAR_ID)
  const eventId = encodeURIComponent(args.eventId)
  const url = `${API_BASE}/calendars/${calendarId}/events/${eventId}`

  await calendarFetch(url, { method: 'DELETE' })

  return {
    content: [{ type: 'text', text: JSON.stringify({ deleted: true, eventId: args.eventId }) }],
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description:
        'Action to perform: "listEvents", "createEvent", "updateEvent", or "deleteEvent"',
      enum: ['listEvents', 'createEvent', 'updateEvent', 'deleteEvent'],
    },
    timeMin: {
      type: 'string',
      description: 'RFC3339 timestamp for earliest event start (listEvents)',
    },
    timeMax: {
      type: 'string',
      description: 'RFC3339 timestamp for latest event start (listEvents)',
    },
    calendarId: {
      type: 'string',
      description: 'Calendar ID (defaults to "primary")',
    },
    title: {
      type: 'string',
      description: 'Event title (createEvent)',
    },
    start: {
      type: 'string',
      description: 'Event start as ISO 8601 / RFC3339 dateTime (createEvent)',
    },
    end: {
      type: 'string',
      description: 'Event end as ISO 8601 / RFC3339 dateTime (createEvent)',
    },
    description: {
      type: 'string',
      description: 'Event description (createEvent, updateEvent)',
    },
    attendees: {
      type: 'array',
      description: 'List of attendee email addresses (createEvent, updateEvent)',
      items: { type: 'string' },
    },
    eventId: {
      type: 'string',
      description: 'Event ID (updateEvent, deleteEvent)',
    },
    updates: {
      type: 'object',
      description: 'Fields to update (updateEvent)',
      properties: {
        title: { type: 'string', description: 'New event title' },
        start: { type: 'string', description: 'New start dateTime' },
        end: { type: 'string', description: 'New end dateTime' },
        description: { type: 'string', description: 'New description' },
        attendees: {
          type: 'array',
          description: 'New attendee list',
          items: { type: 'string' },
        },
      },
    },
  },
  required: ['action'],
}

export const calendarTool: ExtendedAgentTool = {
  name: 'calendar',
  description:
    'Manage Google Calendar events. Actions: listEvents(timeMin, timeMax, calendarId?), createEvent(title, start, end, description?, attendees?), updateEvent(eventId, updates), deleteEvent(eventId).',
  parameters,
  permissions: ['oauth:google', 'net:http'],
  requiresConfirmation: true,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'listEvents':
        return executeListEvents(parsed)
      case 'createEvent':
        return executeCreateEvent(parsed)
      case 'updateEvent':
        return executeUpdateEvent(parsed)
      case 'deleteEvent':
        return executeDeleteEvent(parsed)
    }
  },
}

export { assertGoogleApisUrl, parseArgs, formatEvent, refreshAccessToken }
