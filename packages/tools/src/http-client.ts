/**
 * HTTP Client tool — make HTTP requests and GraphQL queries.
 * SSRF protection: private IPs blocked, each redirect hop validated.
 * Response size limited, timeouts enforced.
 *
 * No external dependencies.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestArgs {
  readonly action: 'request'
  readonly url: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly timeout?: number
}

interface GraphQLArgs {
  readonly action: 'graphql'
  readonly url: string
  readonly query: string
  readonly variables?: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout?: number
}

type HttpClientArgs = RequestArgs | GraphQLArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 30_000
const MAX_TIMEOUT = 60_000
const MAX_REDIRECTS = 5
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5 MB

const VALID_METHODS: ReadonlySet<string> = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
])

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

function isPrivateHostname(hostname: string): boolean {
  if (hostname === '::1' || hostname === '[::1]') return true

  const parts = hostname.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number)
    const [a, b] = octets as [number, number, number, number]
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true
  }

  const lower = hostname.toLowerCase()
  if (lower.startsWith('fd') || lower.startsWith('fe80')) return true

  return false
}

function validateRequestUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http: and https: are allowed`)
  }

  if (parsed.hostname === '') {
    throw new Error('URL must have a hostname')
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('URLs with embedded credentials are not allowed')
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`Blocked private/internal hostname: ${parsed.hostname}`)
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): HttpClientArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'request') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('request requires a non-empty "url" string')
    }

    const method = obj['method']
    if (method !== undefined) {
      if (typeof method !== 'string') {
        throw new Error('method must be a string')
      }
      if (!VALID_METHODS.has(method.toUpperCase())) {
        throw new Error(`Invalid method "${method}". Valid: ${[...VALID_METHODS].join(', ')}`)
      }
    }

    const headers = obj['headers']
    if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers))) {
      throw new Error('headers must be an object')
    }
    if (headers !== undefined) {
      for (const [key, val] of Object.entries(headers as Record<string, unknown>)) {
        if (typeof val !== 'string') {
          throw new Error(`headers["${key}"] must be a string`)
        }
      }
    }

    const body = obj['body']
    if (body !== undefined && typeof body !== 'string') {
      throw new Error('body must be a string')
    }

    const timeout = obj['timeout']
    if (timeout !== undefined) {
      if (typeof timeout !== 'number' || timeout <= 0 || timeout > MAX_TIMEOUT) {
        throw new Error(`timeout must be a positive number up to ${String(MAX_TIMEOUT)}ms`)
      }
    }

    return {
      action: 'request',
      url: url.trim(),
      method: typeof method === 'string' ? method.toUpperCase() : 'GET',
      headers: headers as Record<string, string> | undefined,
      body: typeof body === 'string' ? body : undefined,
      timeout: typeof timeout === 'number' ? timeout : DEFAULT_TIMEOUT,
    }
  }

  if (action === 'graphql') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('graphql requires a non-empty "url" string')
    }

    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('graphql requires a non-empty "query" string')
    }

    const variables = obj['variables']
    if (variables !== undefined && (typeof variables !== 'object' || variables === null || Array.isArray(variables))) {
      throw new Error('variables must be an object')
    }

    const headers = obj['headers']
    if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers))) {
      throw new Error('headers must be an object')
    }

    const timeout = obj['timeout']
    if (timeout !== undefined) {
      if (typeof timeout !== 'number' || timeout <= 0 || timeout > MAX_TIMEOUT) {
        throw new Error(`timeout must be a positive number up to ${String(MAX_TIMEOUT)}ms`)
      }
    }

    return {
      action: 'graphql',
      url: url.trim(),
      query: query.trim(),
      variables: variables as Record<string, unknown> | undefined,
      headers: headers as Record<string, string> | undefined,
      timeout: typeof timeout === 'number' ? timeout : DEFAULT_TIMEOUT,
    }
  }

  throw new Error('action must be "request" or "graphql"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

/**
 * Reads the response body with a size limit.
 * Throws if the body exceeds MAX_RESPONSE_SIZE.
 */
async function readResponseBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const size = parseInt(contentLength, 10)
    if (!isNaN(size) && size > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (${String(size)} bytes, max ${String(MAX_RESPONSE_SIZE)})`)
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    return ''
  }

  const chunks: Uint8Array[] = []
  let totalSize = 0
  const decoder = new TextDecoder()

  try {
    let done = false
    while (!done) {
      const result = await reader.read()
      done = result.done
      if (done) break
      totalSize += result.value.byteLength
      if (totalSize > MAX_RESPONSE_SIZE) {
        throw new Error(`Response too large (exceeded ${String(MAX_RESPONSE_SIZE)} bytes)`)
      }
      chunks.push(result.value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') +
    decoder.decode()
}

/**
 * Performs a fetch with manual redirect following.
 * Validates each redirect target for SSRF.
 */
async function fetchWithRedirects(
  url: URL,
  options: {
    method: string
    headers?: Record<string, string>
    body?: string
    timeout: number
  },
): Promise<{ response: Response; redirectChain: string[] }> {
  let currentUrl = url
  const redirectChain: string[] = []

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const fetchOptions: RequestInit = {
      method: hop === 0 ? options.method : 'GET',
      headers: hop === 0 ? options.headers : undefined,
      body: hop === 0 ? options.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeout),
    }

    const response = await fetch(currentUrl.href, fetchOptions)

    if (response.status < 300 || response.status >= 400) {
      return { response, redirectChain }
    }

    const location = response.headers.get('location')
    if (!location) {
      return { response, redirectChain }
    }

    const nextUrl = new URL(location, currentUrl.href)
    // SSRF validation on each redirect
    currentUrl = validateRequestUrl(nextUrl.href)
    redirectChain.push(currentUrl.href)
  }

  throw new Error(`Too many redirects (max ${String(MAX_REDIRECTS)})`)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function executeRequest(args: RequestArgs): Promise<AgentToolResult> {
  const validatedUrl = validateRequestUrl(args.url)

  const { response, redirectChain } = await fetchWithRedirects(validatedUrl, {
    method: args.method ?? 'GET',
    headers: args.headers,
    body: args.body,
    timeout: args.timeout ?? DEFAULT_TIMEOUT,
  })

  const body = await readResponseBody(response)

  const result: Record<string, unknown> = {
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    body,
  }

  if (redirectChain.length > 0) {
    result['redirects'] = redirectChain
  }

  return textResult(JSON.stringify(result))
}

async function executeGraphQL(args: GraphQLArgs): Promise<AgentToolResult> {
  const validatedUrl = validateRequestUrl(args.url)

  const graphqlBody = JSON.stringify({
    query: args.query,
    variables: args.variables,
  })

  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...args.headers,
  }

  const { response } = await fetchWithRedirects(validatedUrl, {
    method: 'POST',
    headers: mergedHeaders,
    body: graphqlBody,
    timeout: args.timeout ?? DEFAULT_TIMEOUT,
  })

  const body = await readResponseBody(response)

  return textResult(JSON.stringify({
    status: response.status,
    statusText: response.statusText,
    body,
  }))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "request" or "graphql"',
      enum: ['request', 'graphql'],
    },
    url: {
      type: 'string',
      description: 'Target URL (http/https only)',
    },
    method: {
      type: 'string',
      description: 'HTTP method (request, default GET)',
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    },
    headers: {
      type: 'object',
      description: 'Request headers',
    },
    body: {
      type: 'string',
      description: 'Request body (request)',
    },
    query: {
      type: 'string',
      description: 'GraphQL query string (graphql)',
    },
    variables: {
      type: 'object',
      description: 'GraphQL variables (graphql)',
    },
    timeout: {
      type: 'number',
      description: 'Request timeout in ms (default 30000, max 60000)',
    },
  },
  required: ['action'],
}

export const httpClientTool: ExtendedAgentTool = {
  name: 'http-client',
  description:
    'Make HTTP requests and GraphQL queries. Actions: request(url, method?, headers?, body?, timeout?) sends an HTTP request; graphql(url, query, variables?, headers?, timeout?) sends a GraphQL query. SSRF-protected: private IPs blocked, redirects validated. Requires user confirmation.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: true,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'request':
        return executeRequest(parsed)
      case 'graphql':
        return executeGraphQL(parsed)
    }
  },
}

export { validateRequestUrl, isPrivateHostname, parseArgs }
