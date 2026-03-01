/**
 * Gmail tool — read, search, send, and reply to emails via Gmail REST API.
 * Factory pattern: createGmailTool(oauth) returns a per-user tool instance.
 *
 * URL policy: Only requests to gmail.googleapis.com and oauth2.googleapis.com.
 * Confirmable actions: sendEmail, replyToEmail.
 */

import type { AgentToolResult, ExtendedAgentTool, GoogleOAuthContext, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 15_000
const DEFAULT_INBOX_LIMIT = 10
const MAX_INBOX_LIMIT = 50

// ---------------------------------------------------------------------------
// Types — Gmail API responses
// ---------------------------------------------------------------------------

interface GmailHeader {
  readonly name: string
  readonly value: string
}

interface GmailMessagePart {
  readonly mimeType: string
  readonly headers?: readonly GmailHeader[]
  readonly body?: { readonly data?: string; readonly size?: number }
  readonly parts?: readonly GmailMessagePart[]
}

interface GmailMessage {
  readonly id: string
  readonly threadId: string
  readonly snippet: string
  readonly labelIds?: readonly string[]
  readonly payload?: GmailMessagePart
  readonly internalDate?: string
}

interface GmailListResponse {
  readonly messages?: readonly { readonly id: string; readonly threadId: string }[]
  readonly resultSizeEstimate?: number
}

interface TokenResponse {
  readonly access_token: string
  readonly expires_in: number
  readonly token_type: string
}

// ---------------------------------------------------------------------------
// Argument types
// ---------------------------------------------------------------------------

interface ReadInboxArgs {
  readonly action: 'readInbox'
  readonly limit: number
}

interface SearchEmailsArgs {
  readonly action: 'searchEmails'
  readonly query: string
}

interface SendEmailArgs {
  readonly action: 'sendEmail'
  readonly to: string
  readonly subject: string
  readonly body: string
}

interface ReplyToEmailArgs {
  readonly action: 'replyToEmail'
  readonly messageId: string
  readonly body: string
}

type GmailArgs = ReadInboxArgs | SearchEmailsArgs | SendEmailArgs | ReplyToEmailArgs

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'gmail.googleapis.com',
  'oauth2.googleapis.com',
])

function validateGmailUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Blocked URL scheme "${parsed.protocol}" — only https: is allowed`,
    )
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Blocked hostname "${parsed.hostname}" — only gmail.googleapis.com and oauth2.googleapis.com are allowed`,
    )
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): GmailArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'readInbox') {
    let limit = DEFAULT_INBOX_LIMIT
    if (obj['limit'] !== undefined) {
      if (
        typeof obj['limit'] !== 'number' ||
        !Number.isInteger(obj['limit']) ||
        obj['limit'] < 1
      ) {
        throw new Error('limit must be a positive integer')
      }
      limit = Math.min(obj['limit'], MAX_INBOX_LIMIT)
    }
    return { action: 'readInbox', limit }
  }

  if (action === 'searchEmails') {
    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('searchEmails requires a non-empty "query" string')
    }
    return { action: 'searchEmails', query: query.trim() }
  }

  if (action === 'sendEmail') {
    const to = obj['to']
    const subject = obj['subject']
    const body = obj['body']
    if (typeof to !== 'string' || to.trim() === '') {
      throw new Error('sendEmail requires a non-empty "to" string')
    }
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new Error('sendEmail requires a non-empty "subject" string')
    }
    if (typeof body !== 'string' || body.trim() === '') {
      throw new Error('sendEmail requires a non-empty "body" string')
    }
    return {
      action: 'sendEmail',
      to: to.trim(),
      subject: subject.trim(),
      body: body.trim(),
    }
  }

  if (action === 'replyToEmail') {
    const messageId = obj['messageId']
    const body = obj['body']
    if (typeof messageId !== 'string' || messageId.trim() === '') {
      throw new Error('replyToEmail requires a non-empty "messageId" string')
    }
    if (typeof body !== 'string' || body.trim() === '') {
      throw new Error('replyToEmail requires a non-empty "body" string')
    }
    return {
      action: 'replyToEmail',
      messageId: messageId.trim(),
      body: body.trim(),
    }
  }

  throw new Error(
    'action must be "readInbox", "searchEmails", "sendEmail", or "replyToEmail"',
  )
}

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

function extractHeader(
  headers: readonly GmailHeader[] | undefined,
  name: string,
): string {
  if (!headers) return ''
  const lower = name.toLowerCase()
  const header = headers.find((h) => h.name.toLowerCase() === lower)
  return header?.value ?? ''
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function extractBody(payload: GmailMessagePart | undefined): string {
  if (!payload) return ''

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }

  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain')
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data)
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html')
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data)
    }

    for (const part of payload.parts) {
      const body = extractBody(part)
      if (body) return body
    }
  }

  return ''
}

interface ParsedEmail {
  readonly id: string
  readonly threadId: string
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly date: string
  readonly snippet: string
  readonly body: string
}

function parseMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: extractHeader(headers, 'From'),
    to: extractHeader(headers, 'To'),
    subject: extractHeader(headers, 'Subject'),
    date: extractHeader(headers, 'Date'),
    snippet: msg.snippet,
    body: extractBody(msg.payload),
  }
}

// ---------------------------------------------------------------------------
// MIME builder
// ---------------------------------------------------------------------------

function buildRawEmail(
  to: string,
  subject: string,
  body: string,
  extraHeaders?: Readonly<Record<string, string>>,
): string {
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ]

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      lines.push(`${key}: ${value}`)
    }
  }

  lines.push('', body)
  return encodeBase64Url(lines.join('\r\n'))
}

// ---------------------------------------------------------------------------
// FetchFn type + Action executors
// ---------------------------------------------------------------------------

type GmailFetchFn = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>

async function executeReadInbox(fetchFn: GmailFetchFn, limit: number): Promise<AgentToolResult> {
  const response = await fetchFn(
    `/messages?maxResults=${String(limit)}&labelIds=INBOX`,
  )
  const data = (await response.json()) as GmailListResponse

  const messageRefs = data.messages ?? []
  const emails: ParsedEmail[] = []

  for (const ref of messageRefs) {
    const msgResponse = await fetchFn(`/messages/${ref.id}?format=full`)
    const msg = (await msgResponse.json()) as GmailMessage
    emails.push(parseMessage(msg))
  }

  return {
    content: [
      { type: 'text', text: JSON.stringify({ emails, count: emails.length }) },
    ],
  }
}

async function executeSearchEmails(fetchFn: GmailFetchFn, query: string): Promise<AgentToolResult> {
  const params = new URLSearchParams({ q: query })
  const response = await fetchFn(`/messages?${params.toString()}`)
  const data = (await response.json()) as GmailListResponse

  const messageRefs = data.messages ?? []
  const emails: ParsedEmail[] = []

  for (const ref of messageRefs) {
    const msgResponse = await fetchFn(`/messages/${ref.id}?format=full`)
    const msg = (await msgResponse.json()) as GmailMessage
    emails.push(parseMessage(msg))
  }

  return {
    content: [
      { type: 'text', text: JSON.stringify({ emails, count: emails.length }) },
    ],
  }
}

async function executeSendEmail(
  fetchFn: GmailFetchFn,
  to: string,
  subject: string,
  body: string,
): Promise<AgentToolResult> {
  const raw = buildRawEmail(to, subject, body)

  const response = await fetchFn('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })

  const result = (await response.json()) as {
    readonly id: string
    readonly threadId: string
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sent: true,
          messageId: result.id,
          threadId: result.threadId,
        }),
      },
    ],
  }
}

async function executeReplyToEmail(
  fetchFn: GmailFetchFn,
  messageId: string,
  body: string,
): Promise<AgentToolResult> {
  // Fetch original message for threading info
  const msgResponse = await fetchFn(`/messages/${messageId}?format=full`)
  const original = (await msgResponse.json()) as GmailMessage

  const headers = original.payload?.headers
  const originalMessageIdHeader = extractHeader(headers, 'Message-ID')
  const originalSubject = extractHeader(headers, 'Subject')
  const originalFrom = extractHeader(headers, 'From')
  const references = extractHeader(headers, 'References')

  const replySubject = originalSubject.startsWith('Re:')
    ? originalSubject
    : `Re: ${originalSubject}`

  const replyReferences = references
    ? `${references} ${originalMessageIdHeader}`
    : originalMessageIdHeader

  const extraHeaders: Record<string, string> = {}
  if (originalMessageIdHeader) {
    extraHeaders['In-Reply-To'] = originalMessageIdHeader
  }
  if (replyReferences) {
    extraHeaders['References'] = replyReferences
  }

  const raw = buildRawEmail(originalFrom, replySubject, body, extraHeaders)

  const response = await fetchFn('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, threadId: original.threadId }),
  })

  const result = (await response.json()) as {
    readonly id: string
    readonly threadId: string
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sent: true,
          messageId: result.id,
          threadId: result.threadId,
          inReplyTo: originalMessageIdHeader,
        }),
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const gmailParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description:
        'Action to perform: readInbox, searchEmails, sendEmail, or replyToEmail',
      enum: ['readInbox', 'searchEmails', 'sendEmail', 'replyToEmail'],
    },
    limit: {
      type: 'integer',
      description: 'Max emails to return for readInbox (default 10, max 50)',
    },
    query: {
      type: 'string',
      description: 'Gmail search query (required for searchEmails)',
    },
    to: {
      type: 'string',
      description: 'Recipient email address (required for sendEmail)',
    },
    subject: {
      type: 'string',
      description: 'Email subject (required for sendEmail)',
    },
    body: {
      type: 'string',
      description: 'Email body text (required for sendEmail and replyToEmail)',
    },
    messageId: {
      type: 'string',
      description:
        'Gmail message ID to reply to (required for replyToEmail)',
    },
  },
  required: ['action'],
}

const GMAIL_DESCRIPTION =
  'Read, search, send, and reply to emails via Gmail. Actions: readInbox(limit) lists recent emails; searchEmails(query) searches with Gmail query syntax; sendEmail(to, subject, body) sends a new email; replyToEmail(messageId, body) replies to an existing email. Confirmation required for sendEmail and replyToEmail.'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGmailTool(oauth: GoogleOAuthContext): ExtendedAgentTool {
  let cachedToken = oauth.accessToken

  async function refreshToken(): Promise<string> {
    const url = validateGmailUrl(TOKEN_ENDPOINT)
    const params = new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
      grant_type: 'refresh_token',
    })

    const response = await fetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(
        `Token refresh failed: ${String(response.status)} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as TokenResponse
    cachedToken = data.access_token

    if (oauth.onTokenRefreshed) {
      const expiresAt = Date.now() + data.expires_in * 1000
      await oauth.onTokenRefreshed(data.access_token, expiresAt)
    }

    return data.access_token
  }

  const gmailFetch: GmailFetchFn = async (path, init?) => {
    const url = validateGmailUrl(`${GMAIL_API_BASE}${path}`)
    const makeHeaders = (t: string): Record<string, string> => ({
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${t}`,
    })

    const response = await fetch(url.href, {
      method: init?.method,
      headers: makeHeaders(cachedToken),
      body: init?.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status === 401) {
      const newToken = await refreshToken()
      const retryResponse = await fetch(url.href, {
        method: init?.method,
        headers: makeHeaders(newToken),
        body: init?.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!retryResponse.ok) {
        throw new Error(
          `Gmail API error: ${String(retryResponse.status)} ${retryResponse.statusText}`,
        )
      }
      return retryResponse
    }

    if (!response.ok) {
      throw new Error(
        `Gmail API error: ${String(response.status)} ${response.statusText}`,
      )
    }

    return response
  }

  return {
    name: 'gmail',
    description: GMAIL_DESCRIPTION,
    parameters: gmailParameters,
    permissions: ['oauth:google', 'net:http'],
    requiresConfirmation: true,
    defaultRiskTier: 3,
    riskTiers: { readInbox: 1, searchEmails: 1, sendEmail: 3, replyToEmail: 3 },
    runsOn: 'server',
    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'readInbox':
          return executeReadInbox(gmailFetch, parsed.limit)
        case 'searchEmails':
          return executeSearchEmails(gmailFetch, parsed.query)
        case 'sendEmail':
          return executeSendEmail(gmailFetch, parsed.to, parsed.subject, parsed.body)
        case 'replyToEmail':
          return executeReplyToEmail(gmailFetch, parsed.messageId, parsed.body)
      }
    },
  }
}

export {
  validateGmailUrl,
  parseArgs,
  buildRawEmail,
  encodeBase64Url,
  decodeBase64Url,
  extractHeader,
  extractBody,
  parseMessage,
}
