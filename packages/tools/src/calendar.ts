/**
 * Google Calendar tool — list, create, update, and delete calendar events.
 * Factory pattern: createCalendarTool(oauth) returns a per-user tool instance.
 *
 * URL policy: Only requests to https://www.googleapis.com and https://oauth2.googleapis.com.
 */

import type { AgentToolResult, ExtendedAgentTool, GoogleOAuthContext, JSONSchema } from './types'

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
// FetchFn type + Action executors
// ---------------------------------------------------------------------------

type CalendarFetchFn = (url: string, options: RequestInit) => Promise<Response>

async function executeListEvents(fetchFn: CalendarFetchFn, args: ListEventsArgs): Promise<AgentToolResult> {
  const calendarId = encodeURIComponent(args.calendarId ?? DEFAULT_CALENDAR_ID)
  const params = new URLSearchParams({
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const url = `${API_BASE}/calendars/${calendarId}/events?${params.toString()}`
  const response = await fetchFn(url, { method: 'GET' })
  const data = (await response.json()) as GoogleEventsResponse
  const events = (data.items ?? []).map(formatEvent)

  return {
    content: [{ type: 'text', text: JSON.stringify({ events }) }],
  }
}

async function executeCreateEvent(fetchFn: CalendarFetchFn, args: CreateEventArgs): Promise<AgentToolResult> {
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

  const response = await fetchFn(url, {
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

async function executeUpdateEvent(fetchFn: CalendarFetchFn, args: UpdateEventArgs): Promise<AgentToolResult> {
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

  const response = await fetchFn(url, {
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

async function executeDeleteEvent(fetchFn: CalendarFetchFn, args: DeleteEventArgs): Promise<AgentToolResult> {
  const calendarId = encodeURIComponent(DEFAULT_CALENDAR_ID)
  const eventId = encodeURIComponent(args.eventId)
  const url = `${API_BASE}/calendars/${calendarId}/events/${eventId}`

  await fetchFn(url, { method: 'DELETE' })

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

const CALENDAR_DESCRIPTION =
  'Manage Google Calendar events. Actions: listEvents(timeMin, timeMax, calendarId?), createEvent(title, start, end, description?, attendees?), updateEvent(eventId, updates), deleteEvent(eventId).'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCalendarTool(oauth: GoogleOAuthContext): ExtendedAgentTool {
  let cachedToken = oauth.accessToken

  async function refreshToken(): Promise<string> {
    assertGoogleApisUrl(TOKEN_URL)
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
    })

    const response = await fetch(TOKEN_URL, {
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

    cachedToken = data.access_token

    if (oauth.onTokenRefreshed && data.expires_in) {
      const expiresAt = Date.now() + data.expires_in * 1000
      await oauth.onTokenRefreshed(data.access_token, expiresAt)
    }

    return data.access_token
  }

  const calendarFetch: CalendarFetchFn = async (url, options) => {
    assertGoogleApisUrl(url)

    // Pre-check expiry
    const token = (oauth.expiresAt > 0 && Date.now() >= oauth.expiresAt)
      ? await refreshToken()
      : cachedToken

    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status === 401) {
      const newToken = await refreshToken()
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

  return {
    name: 'calendar',
    description: CALENDAR_DESCRIPTION,
    parameters,
    permissions: ['oauth:google', 'net:http'],
    requiresConfirmation: true,
    defaultRiskTier: 3,
    riskTiers: { listEvents: 1, createEvent: 3, updateEvent: 3, deleteEvent: 4 },
    runsOn: 'server',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'listEvents':
          return executeListEvents(calendarFetch, parsed)
        case 'createEvent':
          return executeCreateEvent(calendarFetch, parsed)
        case 'updateEvent':
          return executeUpdateEvent(calendarFetch, parsed)
        case 'deleteEvent':
          return executeDeleteEvent(calendarFetch, parsed)
      }
    },
  }
}

export { assertGoogleApisUrl, parseArgs, formatEvent }
