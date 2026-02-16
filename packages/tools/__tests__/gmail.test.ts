import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  gmailTool,
  validateGmailUrl,
  parseArgs,
  buildRawEmail,
  encodeBase64Url,
  decodeBase64Url,
  extractHeader,
  extractBody,
  parseMessage,
  _resetTokenCache,
} from '../src/gmail'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/gmail.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>()

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  _resetTokenCache()

  // Default env vars for auth
  process.env['GMAIL_ACCESS_TOKEN'] = 'test-access-token'
  process.env['GMAIL_REFRESH_TOKEN'] = 'test-refresh-token'
  process.env['GOOGLE_CLIENT_ID'] = 'test-client-id'
  process.env['GOOGLE_CLIENT_SECRET'] = 'test-client-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env['GMAIL_ACCESS_TOKEN']
  delete process.env['GMAIL_REFRESH_TOKEN']
  delete process.env['GOOGLE_CLIENT_ID']
  delete process.env['GOOGLE_CLIENT_SECRET']
})

// ---------------------------------------------------------------------------
// Base64 URL helpers
// ---------------------------------------------------------------------------

describe('encodeBase64Url / decodeBase64Url', () => {
  it('round-trips correctly', () => {
    const original = 'Hello, World! Ümlauts: äöü'
    expect(decodeBase64Url(encodeBase64Url(original))).toBe(original)
  })

  it('produces URL-safe output (no +, /, or =)', () => {
    const encoded = encodeBase64Url('binary data with special chars: /+==')
    expect(encoded).not.toMatch(/[+/=]/)
  })
})

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe('validateGmailUrl', () => {
  it('accepts gmail.googleapis.com', () => {
    const url = validateGmailUrl('https://gmail.googleapis.com/gmail/v1/users/me/messages')
    expect(url.hostname).toBe('gmail.googleapis.com')
  })

  it('accepts oauth2.googleapis.com', () => {
    const url = validateGmailUrl('https://oauth2.googleapis.com/token')
    expect(url.hostname).toBe('oauth2.googleapis.com')
  })

  it('rejects non-https', () => {
    expect(() => validateGmailUrl('http://gmail.googleapis.com/x')).toThrow('Blocked URL scheme')
  })

  it('rejects unknown hosts', () => {
    expect(() => validateGmailUrl('https://evil.com/steal')).toThrow('Blocked hostname')
  })

  it('rejects invalid URLs', () => {
    expect(() => validateGmailUrl('not-a-url')).toThrow('Invalid URL')
  })
})

// ---------------------------------------------------------------------------
// extractHeader
// ---------------------------------------------------------------------------

describe('extractHeader', () => {
  const headers = [
    { name: 'From', value: 'alice@example.com' },
    { name: 'Subject', value: 'Test Subject' },
    { name: 'Message-ID', value: '<msg-123@example.com>' },
  ] as const

  it('finds header case-insensitively', () => {
    expect(extractHeader(headers, 'from')).toBe('alice@example.com')
    expect(extractHeader(headers, 'FROM')).toBe('alice@example.com')
    expect(extractHeader(headers, 'Subject')).toBe('Test Subject')
  })

  it('returns empty string for missing headers', () => {
    expect(extractHeader(headers, 'X-Missing')).toBe('')
  })

  it('returns empty string for undefined headers', () => {
    expect(extractHeader(undefined, 'From')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// extractBody
// ---------------------------------------------------------------------------

describe('extractBody', () => {
  it('extracts direct body data', () => {
    const payload = {
      mimeType: 'text/plain',
      body: { data: encodeBase64Url('Hello body') },
    }
    expect(extractBody(payload)).toBe('Hello body')
  })

  it('prefers text/plain in multipart', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: encodeBase64Url('Plain text') } },
        { mimeType: 'text/html', body: { data: encodeBase64Url('<b>HTML</b>') } },
      ],
    }
    expect(extractBody(payload)).toBe('Plain text')
  })

  it('falls back to text/html if no text/plain', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: encodeBase64Url('<b>HTML</b>') } },
      ],
    }
    expect(extractBody(payload)).toBe('<b>HTML</b>')
  })

  it('returns empty string for no payload', () => {
    expect(extractBody(undefined)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// parseMessage
// ---------------------------------------------------------------------------

describe('parseMessage', () => {
  it('parses a full Gmail message', () => {
    const msg = {
      id: 'msg-1',
      threadId: 'thread-1',
      snippet: 'Hello...',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'alice@example.com' },
          { name: 'To', value: 'bob@example.com' },
          { name: 'Subject', value: 'Test' },
          { name: 'Date', value: 'Mon, 1 Jan 2024 12:00:00 +0000' },
        ],
        body: { data: encodeBase64Url('Hello Bob') },
      },
    }

    const parsed = parseMessage(msg)
    expect(parsed.id).toBe('msg-1')
    expect(parsed.threadId).toBe('thread-1')
    expect(parsed.from).toBe('alice@example.com')
    expect(parsed.to).toBe('bob@example.com')
    expect(parsed.subject).toBe('Test')
    expect(parsed.body).toBe('Hello Bob')
  })
})

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('rejects non-object args', () => {
    expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    expect(() => parseArgs('string')).toThrow('Arguments must be an object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'delete' })).toThrow('action must be')
  })

  it('parses readInbox with default limit', () => {
    const result = parseArgs({ action: 'readInbox' })
    expect(result).toEqual({ action: 'readInbox', limit: 10 })
  })

  it('parses readInbox with custom limit', () => {
    const result = parseArgs({ action: 'readInbox', limit: 5 })
    expect(result).toEqual({ action: 'readInbox', limit: 5 })
  })

  it('caps readInbox limit at 50', () => {
    const result = parseArgs({ action: 'readInbox', limit: 100 })
    expect(result).toEqual({ action: 'readInbox', limit: 50 })
  })

  it('rejects non-integer limit', () => {
    expect(() => parseArgs({ action: 'readInbox', limit: 1.5 })).toThrow('positive integer')
  })

  it('parses searchEmails', () => {
    const result = parseArgs({ action: 'searchEmails', query: 'from:alice' })
    expect(result).toEqual({ action: 'searchEmails', query: 'from:alice' })
  })

  it('rejects searchEmails without query', () => {
    expect(() => parseArgs({ action: 'searchEmails' })).toThrow('non-empty "query"')
  })

  it('parses sendEmail', () => {
    const result = parseArgs({
      action: 'sendEmail',
      to: 'bob@example.com',
      subject: 'Hi',
      body: 'Hello',
    })
    expect(result).toEqual({
      action: 'sendEmail',
      to: 'bob@example.com',
      subject: 'Hi',
      body: 'Hello',
    })
  })

  it('rejects sendEmail with missing fields', () => {
    expect(() => parseArgs({ action: 'sendEmail' })).toThrow('"to"')
    expect(() => parseArgs({ action: 'sendEmail', to: 'a@b.com' })).toThrow('"subject"')
    expect(() =>
      parseArgs({ action: 'sendEmail', to: 'a@b.com', subject: 'Hi' }),
    ).toThrow('"body"')
  })

  it('parses replyToEmail', () => {
    const result = parseArgs({ action: 'replyToEmail', messageId: 'msg-1', body: 'Thanks' })
    expect(result).toEqual({ action: 'replyToEmail', messageId: 'msg-1', body: 'Thanks' })
  })

  it('rejects replyToEmail with missing fields', () => {
    expect(() => parseArgs({ action: 'replyToEmail' })).toThrow('"messageId"')
    expect(() => parseArgs({ action: 'replyToEmail', messageId: 'x' })).toThrow('"body"')
  })
})

// ---------------------------------------------------------------------------
// buildRawEmail
// ---------------------------------------------------------------------------

describe('buildRawEmail', () => {
  it('builds correct MIME structure for sendEmail', () => {
    const raw = buildRawEmail('bob@example.com', 'Test Subject', 'Hello Bob')
    const decoded = decodeBase64Url(raw)

    expect(decoded).toContain('To: bob@example.com')
    expect(decoded).toContain('Subject: Test Subject')
    expect(decoded).toContain('MIME-Version: 1.0')
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(decoded).toContain('Hello Bob')
  })

  it('includes extra headers for replies', () => {
    const raw = buildRawEmail('alice@example.com', 'Re: Test', 'Reply body', {
      'In-Reply-To': '<msg-123@example.com>',
      References: '<msg-123@example.com>',
    })
    const decoded = decodeBase64Url(raw)

    expect(decoded).toContain('In-Reply-To: <msg-123@example.com>')
    expect(decoded).toContain('References: <msg-123@example.com>')
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('gmailTool metadata', () => {
  it('has correct name', () => {
    expect(gmailTool.name).toBe('gmail')
  })

  it('has correct permissions', () => {
    expect(gmailTool.permissions).toEqual(['oauth:google', 'net:http'])
  })

  it('requires confirmation', () => {
    expect(gmailTool.requiresConfirmation).toBe(true)
  })

  it('runs on server', () => {
    expect(gmailTool.runsOn).toBe('server')
  })

  it('has valid parameter schema', () => {
    expect(gmailTool.parameters.type).toBe('object')
    expect(gmailTool.parameters.required).toEqual(['action'])
  })
})

// ---------------------------------------------------------------------------
// readInbox — execute
// ---------------------------------------------------------------------------

describe('readInbox', () => {
  it('parses inbox results correctly', async () => {
    // List messages response
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        messages: [
          { id: 'msg-1', threadId: 'thread-1' },
          { id: 'msg-2', threadId: 'thread-2' },
        ],
      }),
    )

    // Individual message responses
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'msg-1',
        threadId: 'thread-1',
        snippet: 'Hello...',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'To', value: 'me@example.com' },
            { name: 'Subject', value: 'First email' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 12:00:00 +0000' },
          ],
          body: { data: encodeBase64Url('First body') },
        },
      }),
    )

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'msg-2',
        threadId: 'thread-2',
        snippet: 'World...',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'bob@example.com' },
            { name: 'To', value: 'me@example.com' },
            { name: 'Subject', value: 'Second email' },
            { name: 'Date', value: 'Tue, 2 Jan 2024 12:00:00 +0000' },
          ],
          body: { data: encodeBase64Url('Second body') },
        },
      }),
    )

    const result = await gmailTool.execute({ action: 'readInbox', limit: 2 })
    const content = result.content[0]
    expect(content).toBeDefined()
    expect(content?.type).toBe('text')

    const parsed = JSON.parse((content as { text: string }).text) as {
      emails: Array<{ id: string; from: string; subject: string; body: string }>
      count: number
    }

    expect(parsed.count).toBe(2)
    expect(parsed.emails).toHaveLength(2)
    expect(parsed.emails[0]?.from).toBe('alice@example.com')
    expect(parsed.emails[0]?.subject).toBe('First email')
    expect(parsed.emails[0]?.body).toBe('First body')
    expect(parsed.emails[1]?.from).toBe('bob@example.com')

    // Verify fetch was called with correct URL
    const firstCallUrl = String(mockFetch.mock.calls[0]?.[0] ?? '')
    expect(firstCallUrl).toContain('gmail.googleapis.com')
    expect(firstCallUrl).toContain('maxResults=2')
    expect(firstCallUrl).toContain('labelIds=INBOX')
  })
})

// ---------------------------------------------------------------------------
// sendEmail — execute
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  it('builds correct request', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'sent-1', threadId: 'thread-new' }),
    )

    const result = await gmailTool.execute({
      action: 'sendEmail',
      to: 'bob@example.com',
      subject: 'Test Subject',
      body: 'Hello Bob',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)

    const callArgs = mockFetch.mock.calls[0]
    const url = String(callArgs?.[0] ?? '')
    expect(url).toContain('gmail.googleapis.com/gmail/v1/users/me/messages/send')

    const init = callArgs?.[1] as RequestInit | undefined
    expect(init?.method).toBe('POST')

    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['Content-Type']).toBe('application/json')
    expect(headers?.['Authorization']).toBe('Bearer test-access-token')

    // Verify the raw email is properly encoded
    const body = JSON.parse(String(init?.body ?? '{}')) as { raw: string }
    const decoded = decodeBase64Url(body.raw)
    expect(decoded).toContain('To: bob@example.com')
    expect(decoded).toContain('Subject: Test Subject')
    expect(decoded).toContain('Hello Bob')

    // Verify response
    const content = result.content[0]
    const parsed = JSON.parse((content as { text: string }).text) as {
      sent: boolean
      messageId: string
    }
    expect(parsed.sent).toBe(true)
    expect(parsed.messageId).toBe('sent-1')
  })
})

// ---------------------------------------------------------------------------
// replyToEmail — execute
// ---------------------------------------------------------------------------

describe('replyToEmail', () => {
  it('sets correct In-Reply-To header', async () => {
    // Fetch original message
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'msg-original',
        threadId: 'thread-1',
        snippet: 'Original...',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'To', value: 'me@example.com' },
            { name: 'Subject', value: 'Original Subject' },
            { name: 'Message-ID', value: '<original-msg-id@example.com>' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 12:00:00 +0000' },
          ],
          body: { data: encodeBase64Url('Original body') },
        },
      }),
    )

    // Send reply response
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'reply-1', threadId: 'thread-1' }),
    )

    const result = await gmailTool.execute({
      action: 'replyToEmail',
      messageId: 'msg-original',
      body: 'Thanks for your email!',
    })

    // Second call is the send
    const sendCallArgs = mockFetch.mock.calls[1]
    const init = sendCallArgs?.[1] as RequestInit | undefined
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      raw: string
      threadId: string
    }

    // Verify threadId is set
    expect(body.threadId).toBe('thread-1')

    // Verify In-Reply-To and References headers
    const decoded = decodeBase64Url(body.raw)
    expect(decoded).toContain('In-Reply-To: <original-msg-id@example.com>')
    expect(decoded).toContain('References: <original-msg-id@example.com>')
    expect(decoded).toContain('Subject: Re: Original Subject')
    expect(decoded).toContain('To: alice@example.com')
    expect(decoded).toContain('Thanks for your email!')

    // Verify response
    const content = result.content[0]
    const parsed = JSON.parse((content as { text: string }).text) as {
      sent: boolean
      inReplyTo: string
    }
    expect(parsed.sent).toBe(true)
    expect(parsed.inReplyTo).toBe('<original-msg-id@example.com>')
  })

  it('chains References header for deep threads', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'msg-3',
        threadId: 'thread-1',
        snippet: 'Third...',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'Subject', value: 'Re: Original' },
            { name: 'Message-ID', value: '<msg-3@example.com>' },
            { name: 'References', value: '<msg-1@example.com> <msg-2@example.com>' },
          ],
          body: { data: encodeBase64Url('Third message') },
        },
      }),
    )

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'reply-3', threadId: 'thread-1' }),
    )

    await gmailTool.execute({
      action: 'replyToEmail',
      messageId: 'msg-3',
      body: 'Reply to third',
    })

    const sendCallArgs = mockFetch.mock.calls[1]
    const init = sendCallArgs?.[1] as RequestInit | undefined
    const body = JSON.parse(String(init?.body ?? '{}')) as { raw: string }
    const decoded = decodeBase64Url(body.raw)

    expect(decoded).toContain(
      'References: <msg-1@example.com> <msg-2@example.com> <msg-3@example.com>',
    )
  })
})

// ---------------------------------------------------------------------------
// Token expired → refresh flow
// ---------------------------------------------------------------------------

describe('token refresh flow', () => {
  it('refreshes token on 401 and retries', async () => {
    // First call returns 401
    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    )

    // Refresh token call
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    )

    // Retry with new token
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        messages: [{ id: 'msg-1', threadId: 'thread-1' }],
      }),
    )

    // Individual message fetch
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'msg-1',
        threadId: 'thread-1',
        snippet: 'Hello',
        payload: {
          mimeType: 'text/plain',
          headers: [{ name: 'From', value: 'alice@example.com' }],
          body: { data: encodeBase64Url('Hello') },
        },
      }),
    )

    const result = await gmailTool.execute({ action: 'readInbox', limit: 1 })
    const content = result.content[0]
    const parsed = JSON.parse((content as { text: string }).text) as {
      count: number
    }

    expect(parsed.count).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(4)

    // Verify refresh token call went to correct endpoint
    const refreshCallUrl = String(mockFetch.mock.calls[1]?.[0] ?? '')
    expect(refreshCallUrl).toContain('oauth2.googleapis.com/token')

    // Verify retry used new token
    const retryCallArgs = mockFetch.mock.calls[2]
    const retryHeaders = (retryCallArgs?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string> | undefined
    expect(retryHeaders?.['Authorization']).toBe('Bearer new-access-token')
  })

  it('uses refresh token when no access token in env', async () => {
    delete process.env['GMAIL_ACCESS_TOKEN']
    _resetTokenCache()

    // Refresh token call
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    )

    // List messages
    mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [] }))

    await gmailTool.execute({ action: 'readInbox' })

    const refreshCallUrl = String(mockFetch.mock.calls[0]?.[0] ?? '')
    expect(refreshCallUrl).toContain('oauth2.googleapis.com/token')

    const listCallArgs = mockFetch.mock.calls[1]
    const headers = (listCallArgs?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer refreshed-token')
  })
})

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no ev' + 'al or dynamic code execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('only fetches from gmail.googleapis.com and oauth2.googleapis.com', () => {
    assertNoUnauthorizedFetch(SOURCE_CODE, [
      'https://gmail.googleapis.com',
      'https://oauth2.googleapis.com',
    ])
  })

  it('validates all URLs against allowlist', () => {
    expect(() => validateGmailUrl('https://evil.com/exfil')).toThrow('Blocked hostname')
    expect(() => validateGmailUrl('https://gmail.googleapis.com.evil.com/x')).toThrow(
      'Blocked hostname',
    )
    expect(() => validateGmailUrl('http://gmail.googleapis.com/x')).toThrow('Blocked URL scheme')
  })

  it('rejects javascript: and data: schemes', () => {
    expect(() => validateGmailUrl('javascript:alert(1)')).toThrow()
    expect(() => validateGmailUrl('data:text/html,<script>alert(1)</script>')).toThrow()
  })
})
