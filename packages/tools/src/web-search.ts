/**
 * Web Search tool — search the web and fetch page content.
 * Backend: Configurable (SearXNG / Brave Search API / Serper).
 * API key from environment variable.
 *
 * URL policy: Only https:// URLs are permitted.
 * Blocked: file://, javascript:, data:, http://, and all other schemes.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
}

interface FetchPageResponse {
  readonly content: string
  readonly title: string
}

type SearchBackend = 'searxng' | 'brave' | 'serper'

interface SearchArgs {
  readonly action: 'search'
  readonly query: string
}

interface FetchPageArgs {
  readonly action: 'fetchPage'
  readonly url: string
}

type WebSearchArgs = SearchArgs | FetchPageArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000
const MAX_RESULTS = 10
const MAX_CONTENT_LENGTH = 50_000
const MAX_REDIRECTS = 5

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Checks whether a hostname resolves to a private/internal IP range.
 * Blocks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * 169.254.0.0/16 (link-local), 0.0.0.0, ::1, fd00::/8, fe80::/10.
 */
function isPrivateHostname(hostname: string): boolean {
  // IPv6 literal (brackets stripped by URL parser)
  if (hostname === '::1' || hostname === '[::1]') return true

  const parts = hostname.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number)
    const [a, b] = octets as [number, number, number, number]
    if (a === 127) return true                           // 127.0.0.0/8
    if (a === 10) return true                            // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true     // 172.16.0.0/12
    if (a === 192 && b === 168) return true              // 192.168.0.0/16
    if (a === 169 && b === 254) return true              // 169.254.0.0/16
    if (a === 0) return true                             // 0.0.0.0/8
  }

  // Common private hostnames
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true
  }

  // IPv6 private ranges (fd00::/8, fe80::/10)
  const lower = hostname.toLowerCase()
  if (lower.startsWith('fd') || lower.startsWith('fe80')) return true

  return false
}

/**
 * Validates that a URL uses the https: protocol.
 * Rejects file://, javascript:, data:, http://, and all other schemes.
 * Rejects private/internal IP ranges (SSRF protection).
 * Uses the WHATWG URL parser for normalization.
 */
function validateUrl(raw: string): URL {
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

function parseArgs(args: unknown): WebSearchArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'search') {
    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('search requires a non-empty "query" string')
    }
    return { action: 'search', query: query.trim() }
  }

  if (action === 'fetchPage') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('fetchPage requires a non-empty "url" string')
    }
    return { action: 'fetchPage', url: url.trim() }
  }

  throw new Error('action must be "search" or "fetchPage"')
}

// ---------------------------------------------------------------------------
// Backend configuration
// ---------------------------------------------------------------------------

interface BackendConfig {
  readonly backend: SearchBackend
  readonly apiKey: string
  readonly instanceUrl: string | undefined
}

function getBackendConfig(): BackendConfig {
  const raw = process.env['WEB_SEARCH_BACKEND'] ?? 'brave'

  if (raw !== 'searxng' && raw !== 'brave' && raw !== 'serper') {
    throw new Error(
      `Unknown search backend "${raw}". Use searxng, brave, or serper.`,
    )
  }

  const backend: SearchBackend = raw

  if (backend === 'searxng') {
    const instanceUrl = process.env['SEARXNG_INSTANCE_URL']
    if (!instanceUrl) {
      throw new Error(
        'SEARXNG_INSTANCE_URL environment variable is required for SearXNG backend',
      )
    }
    validateUrl(instanceUrl)
    return { backend, apiKey: '', instanceUrl }
  }

  const envKeyMap: Readonly<Record<'brave' | 'serper', string>> = {
    brave: 'BRAVE_SEARCH_API_KEY',
    serper: 'SERPER_API_KEY',
  }

  const envName = envKeyMap[backend]
  const apiKey = process.env[envName]
  if (!apiKey) {
    throw new Error(
      `${envName} environment variable is required for ${backend} backend`,
    )
  }

  return { backend, apiKey, instanceUrl: undefined }
}

// ---------------------------------------------------------------------------
// Backend implementations
// ---------------------------------------------------------------------------

interface BraveWebResult {
  readonly title?: string
  readonly url?: string
  readonly description?: string
}

interface BraveResponse {
  readonly web?: { readonly results?: readonly BraveWebResult[] }
}

async function searchBrave(
  query: string,
  apiKey: string,
): Promise<readonly SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(MAX_RESULTS) })
  const response = await fetch(
    'https://api.search.brave.com/res/v1/web/search?' + params.toString(),
    {
      headers: {
        'X-Subscription-Token': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Brave Search API error: ${String(response.status)} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as BraveResponse
  const webResults = data.web?.results ?? []

  return webResults.slice(0, MAX_RESULTS).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }))
}

interface SerperOrganicResult {
  readonly title?: string
  readonly link?: string
  readonly snippet?: string
}

interface SerperResponse {
  readonly organic?: readonly SerperOrganicResult[]
}

async function searchSerper(
  query: string,
  apiKey: string,
): Promise<readonly SearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: MAX_RESULTS }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `Serper API error: ${String(response.status)} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as SerperResponse
  const organic = data.organic ?? []

  return organic.slice(0, MAX_RESULTS).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
  }))
}

interface SearXNGResult {
  readonly title?: string
  readonly url?: string
  readonly content?: string
}

interface SearXNGResponse {
  readonly results?: readonly SearXNGResult[]
}

async function searchSearXNG(
  query: string,
  instanceUrl: string,
): Promise<readonly SearchResult[]> {
  const searchUrl = new URL('/search', instanceUrl)
  searchUrl.searchParams.set('q', query)
  searchUrl.searchParams.set('format', 'json')

  const response = await fetch(searchUrl.href, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `SearXNG error: ${String(response.status)} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as SearXNGResponse
  const results = data.results ?? []

  return results.slice(0, MAX_RESULTS).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }))
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeSearch(query: string): Promise<AgentToolResult> {
  const config = getBackendConfig()

  let results: readonly SearchResult[]
  switch (config.backend) {
    case 'brave':
      results = await searchBrave(query, config.apiKey)
      break
    case 'serper':
      results = await searchSerper(query, config.apiKey)
      break
    case 'searxng':
      results = await searchSearXNG(query, config.instanceUrl as string)
      break
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ results }) }],
  }
}

async function fetchWithSsrfCheck(
  initialUrl: URL,
  headers: Record<string, string>,
): Promise<Response> {
  let currentUrl = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl.href, {
      headers: hop === 0 ? headers : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    })

    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) return response

    // Validate each redirect hop against SSRF
    currentUrl = validateUrl(new URL(location, currentUrl.href).href)
  }

  throw new Error(`Too many redirects (max ${String(MAX_REDIRECTS)})`)
}

async function executeFetchPage(rawUrl: string): Promise<AgentToolResult> {
  const parsed = validateUrl(rawUrl)

  const response = await fetchWithSsrfCheck(parsed, {
    Accept: 'text/html,application/xhtml+xml,text/plain',
  })

  if (!response.ok) {
    throw new Error(
      `Fetch failed: ${String(response.status)} ${response.statusText}`,
    )
  }

  const text = await response.text()

  const titlePattern = /<title[^>]*>([^<]*)<\/title>/i
  const titleMatch = text.match(titlePattern)
  const title = titleMatch?.[1]?.trim() ?? ''

  const content = text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTENT_LENGTH)

  const result: FetchPageResponse = { content, title }
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
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
      description: 'Action to perform: "search" or "fetchPage"',
      enum: ['search', 'fetchPage'],
    },
    query: {
      type: 'string',
      description: 'Search query (required when action is "search")',
    },
    url: {
      type: 'string',
      description:
        'URL to fetch (required when action is "fetchPage", must be https://)',
    },
  },
  required: ['action'],
}

export const webSearchTool: ExtendedAgentTool = {
  name: 'web-search',
  description:
    'Search the internet for current information and fetch web page text. Use for knowledge questions and research. ' +
    'Actions: search(query) returns titles, URLs, and snippets; fetchPage(url) returns page text. Only HTTPS URLs allowed.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: true,
  defaultRiskTier: 1,
  riskTiers: { search: 1, fetchPage: 1 },
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'search':
        return executeSearch(parsed.query)
      case 'fetchPage':
        return executeFetchPage(parsed.url)
    }
  },
}

export { validateUrl }
