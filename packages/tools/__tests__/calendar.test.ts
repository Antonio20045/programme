import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createCalendarTool,
  parseArgs,
  formatEvent,
  assertGoogleApisUrl,
} from '../src/calendar'
import type { GoogleOAuthContext } from '../src/types'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/calendar.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextContent(result: import('../src/types').AgentToolResult): string {
  const first = result.content[0]
  if (first === undefined || first.type !== 'text') {
    throw new Error('Expected text content in result')
  }
  return first.text
}

function mockJsonResponse(data: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => data,
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => mockJsonResponse(data, status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob([]),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(data),
  } as Response
}

function makeOAuthContext(overrides?: Partial<GoogleOAuthContext>): GoogleOAuthContext {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calendar tool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // parseArgs
  // -------------------------------------------------------------------------

  describe('parseArgs', () => {
    it('parses listEvents args', () => {
      const result = parseArgs({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
      })
      expect(result).toEqual({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
        calendarId: undefined,
      })
    })

    it('parses listEvents with calendarId', () => {
      const result = parseArgs({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
        calendarId: 'work@example.com',
      })
      expect(result).toEqual({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
        calendarId: 'work@example.com',
      })
    })

    it('parses createEvent args', () => {
      const result = parseArgs({
        action: 'createEvent',
        title: 'Team Meeting',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        description: 'Weekly sync',
        attendees: ['alice@example.com', 'bob@example.com'],
      })
      expect(result).toEqual({
        action: 'createEvent',
        title: 'Team Meeting',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        description: 'Weekly sync',
        attendees: ['alice@example.com', 'bob@example.com'],
      })
    })

    it('parses updateEvent args', () => {
      const result = parseArgs({
        action: 'updateEvent',
        eventId: 'evt-123',
        updates: { title: 'New Title', start: '2024-01-15T14:00:00Z' },
      })
      expect(result).toEqual({
        action: 'updateEvent',
        eventId: 'evt-123',
        updates: {
          title: 'New Title',
          start: '2024-01-15T14:00:00Z',
          end: undefined,
          description: undefined,
          attendees: undefined,
        },
      })
    })

    it('parses deleteEvent args', () => {
      const result = parseArgs({ action: 'deleteEvent', eventId: 'evt-456' })
      expect(result).toEqual({ action: 'deleteEvent', eventId: 'evt-456' })
    })

    it('rejects non-object args', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })

    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'unknown' })).toThrow('action must be')
    })

    it('rejects listEvents without timeMin', () => {
      expect(() =>
        parseArgs({ action: 'listEvents', timeMax: '2024-01-31T23:59:59Z' }),
      ).toThrow('timeMin')
    })

    it('rejects createEvent without title', () => {
      expect(() =>
        parseArgs({
          action: 'createEvent',
          start: '2024-01-15T10:00:00Z',
          end: '2024-01-15T11:00:00Z',
        }),
      ).toThrow('title')
    })

    it('rejects deleteEvent without eventId', () => {
      expect(() => parseArgs({ action: 'deleteEvent' })).toThrow('eventId')
    })

    it('rejects updateEvent without updates object', () => {
      expect(() =>
        parseArgs({ action: 'updateEvent', eventId: 'evt-1' }),
      ).toThrow('updates')
    })

    it('filters non-string attendees', () => {
      const result = parseArgs({
        action: 'createEvent',
        title: 'Test',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        attendees: ['valid@example.com', 123, null, 'also@valid.com'],
      })
      expect(result).toHaveProperty('attendees', ['valid@example.com', 'also@valid.com'])
    })
  })

  // -------------------------------------------------------------------------
  // formatEvent
  // -------------------------------------------------------------------------

  describe('formatEvent', () => {
    it('formats a full event', () => {
      const result = formatEvent({
        id: 'evt-1',
        summary: 'Meeting',
        description: 'Discuss goals',
        start: { dateTime: '2024-01-15T10:00:00-07:00' },
        end: { dateTime: '2024-01-15T11:00:00-07:00' },
        attendees: [{ email: 'alice@example.com' }, { email: 'bob@example.com' }],
      })
      expect(result).toEqual({
        id: 'evt-1',
        summary: 'Meeting',
        description: 'Discuss goals',
        start: '2024-01-15T10:00:00-07:00',
        end: '2024-01-15T11:00:00-07:00',
        attendees: ['alice@example.com', 'bob@example.com'],
      })
    })

    it('handles all-day events (date instead of dateTime)', () => {
      const result = formatEvent({
        id: 'evt-2',
        summary: 'Holiday',
        start: { date: '2024-12-25' },
        end: { date: '2024-12-26' },
      })
      expect(result.start).toBe('2024-12-25')
      expect(result.end).toBe('2024-12-26')
    })

    it('handles missing fields gracefully', () => {
      const result = formatEvent({})
      expect(result).toEqual({
        id: '',
        summary: '',
        description: '',
        start: '',
        end: '',
        attendees: [],
      })
    })
  })

  // -------------------------------------------------------------------------
  // assertGoogleApisUrl
  // -------------------------------------------------------------------------

  describe('assertGoogleApisUrl', () => {
    it('allows www.googleapis.com', () => {
      expect(() =>
        assertGoogleApisUrl('https://www.googleapis.com/calendar/v3/calendars/primary/events'),
      ).not.toThrow()
    })

    it('allows oauth2.googleapis.com', () => {
      expect(() =>
        assertGoogleApisUrl('https://oauth2.googleapis.com/token'),
      ).not.toThrow()
    })

    it('blocks other hosts', () => {
      expect(() =>
        assertGoogleApisUrl('https://evil.com/steal'),
      ).toThrow('only googleapis.com is allowed')
    })

    it('blocks non-google subdomains', () => {
      expect(() =>
        assertGoogleApisUrl('https://fake-googleapis.com/test'),
      ).toThrow('only googleapis.com is allowed')
    })
  })

  // -------------------------------------------------------------------------
  // listEvents
  // -------------------------------------------------------------------------

  describe('listEvents', () => {
    it('parses results correctly', async () => {
      const apiResponse = {
        items: [
          {
            id: 'evt-1',
            summary: 'Standup',
            description: 'Daily sync',
            start: { dateTime: '2024-01-15T09:00:00Z' },
            end: { dateTime: '2024-01-15T09:15:00Z' },
            attendees: [{ email: 'team@example.com' }],
          },
          {
            id: 'evt-2',
            summary: 'Lunch',
            start: { dateTime: '2024-01-15T12:00:00Z' },
            end: { dateTime: '2024-01-15T13:00:00Z' },
          },
        ],
      }

      mockFetch.mockResolvedValueOnce(mockJsonResponse(apiResponse))

      const tool = createCalendarTool(makeOAuthContext())
      const result = await tool.execute({
        action: 'listEvents',
        timeMin: '2024-01-15T00:00:00Z',
        timeMax: '2024-01-15T23:59:59Z',
      })

      const parsed = JSON.parse(getTextContent(result)) as {
        events: Array<{
          id: string
          summary: string
          description: string
          start: string
          end: string
          attendees: string[]
        }>
      }
      expect(parsed.events).toHaveLength(2)
      expect(parsed.events[0]?.summary).toBe('Standup')
      expect(parsed.events[0]?.attendees).toEqual(['team@example.com'])
      expect(parsed.events[1]?.summary).toBe('Lunch')
      expect(parsed.events[1]?.attendees).toEqual([])
    })

    it('sends request to correct URL with query parameters', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ items: [] }))

      const tool = createCalendarTool(makeOAuthContext())
      await tool.execute({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
        calendarId: 'work@example.com',
      })

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('/calendars/work%40example.com/events')
      expect(calledUrl).toContain('timeMin=2024-01-01T00%3A00%3A00Z')
      expect(calledUrl).toContain('timeMax=2024-01-31T23%3A59%3A59Z')
      expect(calledUrl).toContain('singleEvents=true')
      expect(calledUrl).toContain('orderBy=startTime')
    })

    it('handles empty event list', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ items: [] }))

      const tool = createCalendarTool(makeOAuthContext())
      const result = await tool.execute({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
      })

      const parsed = JSON.parse(getTextContent(result)) as { events: unknown[] }
      expect(parsed.events).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // createEvent
  // -------------------------------------------------------------------------

  describe('createEvent', () => {
    it('builds correct request with ISO date format', async () => {
      const created = {
        id: 'new-evt-1',
        summary: 'Team Meeting',
        description: 'Weekly sync',
        start: { dateTime: '2024-01-15T10:00:00Z' },
        end: { dateTime: '2024-01-15T11:00:00Z' },
        attendees: [{ email: 'alice@example.com' }],
      }
      mockFetch.mockResolvedValueOnce(mockJsonResponse(created))

      const tool = createCalendarTool(makeOAuthContext())
      await tool.execute({
        action: 'createEvent',
        title: 'Team Meeting',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        description: 'Weekly sync',
        attendees: ['alice@example.com'],
      })

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('/calendars/primary/events')
      expect(calledUrl).not.toContain('?')

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body as string) as Record<string, unknown>
      expect(body).toEqual({
        summary: 'Team Meeting',
        start: { dateTime: '2024-01-15T10:00:00Z' },
        end: { dateTime: '2024-01-15T11:00:00Z' },
        description: 'Weekly sync',
        attendees: [{ email: 'alice@example.com' }],
      })
    })

    it('creates event without optional fields', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          id: 'new-evt-2',
          summary: 'Quick Chat',
          start: { dateTime: '2024-02-01T14:00:00Z' },
          end: { dateTime: '2024-02-01T14:30:00Z' },
        }),
      )

      const tool = createCalendarTool(makeOAuthContext())
      const result = await tool.execute({
        action: 'createEvent',
        title: 'Quick Chat',
        start: '2024-02-01T14:00:00Z',
        end: '2024-02-01T14:30:00Z',
      })

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit
      const body = JSON.parse(options.body as string) as Record<string, unknown>
      expect(body).not.toHaveProperty('description')
      expect(body).not.toHaveProperty('attendees')

      const parsed = JSON.parse(getTextContent(result)) as {
        event: { id: string; summary: string }
      }
      expect(parsed.event.id).toBe('new-evt-2')
      expect(parsed.event.summary).toBe('Quick Chat')
    })

    it('returns formatted event in response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          id: 'new-evt-3',
          summary: 'Lunch',
          description: '',
          start: { dateTime: '2024-01-15T12:00:00Z' },
          end: { dateTime: '2024-01-15T13:00:00Z' },
          attendees: [{ email: 'bob@example.com' }],
        }),
      )

      const tool = createCalendarTool(makeOAuthContext())
      const result = await tool.execute({
        action: 'createEvent',
        title: 'Lunch',
        start: '2024-01-15T12:00:00Z',
        end: '2024-01-15T13:00:00Z',
      })

      const parsed = JSON.parse(getTextContent(result)) as {
        event: { attendees: string[] }
      }
      expect(parsed.event.attendees).toEqual(['bob@example.com'])
    })
  })

  // -------------------------------------------------------------------------
  // updateEvent
  // -------------------------------------------------------------------------

  describe('updateEvent', () => {
    it('sends PATCH to correct URL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          id: 'evt-123',
          summary: 'Updated Title',
          start: { dateTime: '2024-01-15T14:00:00Z' },
          end: { dateTime: '2024-01-15T15:00:00Z' },
        }),
      )

      const tool = createCalendarTool(makeOAuthContext())
      await tool.execute({
        action: 'updateEvent',
        eventId: 'evt-123',
        updates: { title: 'Updated Title' },
      })

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('/calendars/primary/events/evt-123')

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(options.method).toBe('PATCH')

      const body = JSON.parse(options.body as string) as Record<string, unknown>
      expect(body).toEqual({ summary: 'Updated Title' })
    })

    it('only includes provided update fields', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          id: 'evt-123',
          summary: 'Meeting',
          description: 'New description',
          start: { dateTime: '2024-01-15T10:00:00Z' },
          end: { dateTime: '2024-01-15T11:00:00Z' },
        }),
      )

      const tool = createCalendarTool(makeOAuthContext())
      await tool.execute({
        action: 'updateEvent',
        eventId: 'evt-123',
        updates: { description: 'New description' },
      })

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit
      const body = JSON.parse(options.body as string) as Record<string, unknown>
      expect(body).toEqual({ description: 'New description' })
      expect(body).not.toHaveProperty('summary')
      expect(body).not.toHaveProperty('start')
    })
  })

  // -------------------------------------------------------------------------
  // deleteEvent
  // -------------------------------------------------------------------------

  describe('deleteEvent', () => {
    it('sends DELETE to correct URL', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 204, 'No Content'))

      const tool = createCalendarTool(makeOAuthContext())
      const result = await tool.execute({
        action: 'deleteEvent',
        eventId: 'evt-to-delete',
      })

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('/calendars/primary/events/evt-to-delete')

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(options.method).toBe('DELETE')

      const parsed = JSON.parse(getTextContent(result)) as {
        deleted: boolean
        eventId: string
      }
      expect(parsed.deleted).toBe(true)
      expect(parsed.eventId).toBe('evt-to-delete')
    })

    it('URL-encodes eventId with special characters', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 204, 'No Content'))

      const tool = createCalendarTool(makeOAuthContext())
      await tool.execute({
        action: 'deleteEvent',
        eventId: 'evt/special+chars',
      })

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(calledUrl).toContain('evt%2Fspecial%2Bchars')
    })
  })

  // -------------------------------------------------------------------------
  // Token refresh flow
  // -------------------------------------------------------------------------

  describe('token refresh', () => {
    it('refreshes token on 401 and retries', async () => {
      // First call: 401
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ error: 'unauthorized' }, 401, 'Unauthorized'))
      // Token refresh call
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'new-token', expires_in: 3600 }),
      )
      // Retry with new token
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ items: [] }))

      const tool = createCalendarTool(makeOAuthContext())
      const result = await tool.execute({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
      })

      expect(mockFetch).toHaveBeenCalledTimes(3)

      // Second call should be to token endpoint
      const tokenCallUrl = mockFetch.mock.calls[1]?.[0] as string
      expect(tokenCallUrl).toBe('https://oauth2.googleapis.com/token')

      // Third call should have the new token
      const retryOptions = mockFetch.mock.calls[2]?.[1] as RequestInit
      const retryHeaders = retryOptions.headers as Headers
      expect(retryHeaders.get('Authorization')).toBe('Bearer new-token')

      const parsed = JSON.parse(getTextContent(result)) as { events: unknown[] }
      expect(parsed.events).toEqual([])
    })

    it('refreshes when token is expired', async () => {
      // Token refresh call
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'refreshed-token', expires_in: 3600 }),
      )
      // Actual API call
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ items: [] }))

      const tool = createCalendarTool(makeOAuthContext({ expiresAt: Date.now() - 1000 }))
      await tool.execute({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const tokenCallUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(tokenCallUrl).toBe('https://oauth2.googleapis.com/token')
    })

    it('throws on failed token refresh', async () => {
      // First call: 401
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 401, 'Unauthorized'))
      // Token refresh: fails
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 400, 'Bad Request'))

      const tool = createCalendarTool(makeOAuthContext())
      await expect(
        tool.execute({
          action: 'listEvents',
          timeMin: '2024-01-01T00:00:00Z',
          timeMax: '2024-01-31T23:59:59Z',
        }),
      ).rejects.toThrow('Token refresh failed')
    })

    it('calls onTokenRefreshed on 401 refresh', async () => {
      const onRefresh = vi.fn()

      // First call: 401
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 401, 'Unauthorized'))
      // Token refresh call
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'new-token', expires_in: 3600 }),
      )
      // Retry
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ items: [] }))

      const tool = createCalendarTool(makeOAuthContext({ onTokenRefreshed: onRefresh }))
      await tool.execute({
        action: 'listEvents',
        timeMin: '2024-01-01T00:00:00Z',
        timeMax: '2024-01-31T23:59:59Z',
      })

      expect(onRefresh).toHaveBeenCalledWith('new-token', expect.any(Number))
    })
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('tool metadata', () => {
    it('has correct name', () => {
      const tool = createCalendarTool(makeOAuthContext())
      expect(tool.name).toBe('calendar')
    })

    it('has permissions', () => {
      const tool = createCalendarTool(makeOAuthContext())
      expect(tool.permissions).toEqual(['oauth:google', 'net:http'])
    })

    it('requires confirmation', () => {
      const tool = createCalendarTool(makeOAuthContext())
      expect(tool.requiresConfirmation).toBe(true)
    })

    it('runs on server', () => {
      const tool = createCalendarTool(makeOAuthContext())
      expect(tool.runsOn).toBe('server')
    })
  })

  // -------------------------------------------------------------------------
  // API error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}, 500, 'Internal Server Error'))

      const tool = createCalendarTool(makeOAuthContext())
      await expect(
        tool.execute({
          action: 'listEvents',
          timeMin: '2024-01-01T00:00:00Z',
          timeMax: '2024-01-31T23:59:59Z',
        }),
      ).rejects.toThrow('Calendar API error: 500 Internal Server Error')
    })
  })
})

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe('calendar security', () => {
  it('contains no eval or code-execution patterns', () => {
    assertNoEval(sourceCode)
  })

  it('only fetches from googleapis.com', () => {
    assertNoUnauthorizedFetch(sourceCode, [
      'https://www.googleapis.com',
      'https://oauth2.googleapis.com',
    ])
  })
})
