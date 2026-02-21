/**
 * URL Tools — parse, validate, extract metadata, resolve redirects, build URLs.
 * SSRF protection for all network-facing actions (validate, metadata, resolve).
 *
 * No external dependencies.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParseArgs {
  readonly action: 'parse'
  readonly url: string
}

interface ValidateArgs {
  readonly action: 'validate'
  readonly url: string
}

interface MetadataArgs {
  readonly action: 'metadata'
  readonly url: string
}

interface ResolveArgs {
  readonly action: 'resolve'
  readonly url: string
}

interface BuildArgs {
  readonly action: 'build'
  readonly base: string
  readonly path?: string
  readonly params?: Record<string, string>
}

type UrlToolsArgs = ParseArgs | ValidateArgs | MetadataArgs | ResolveArgs | BuildArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 10
const TIMEOUT_MS = 10_000
const MAX_HEAD_BYTES = 102_400 // 100 KB for metadata extraction

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

/**
 * Checks whether a hostname resolves to a private/internal IP range.
 * Blocks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * 169.254.0.0/16 (link-local), 0.0.0.0, ::1, fd00::/8, fe80::/10.
 */
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

/**
 * Validates a URL for HTTP(S) access. Rejects private hostnames,
 * non-http(s) schemes, and embedded credentials.
 */
function validateHttpUrl(raw: string): URL {
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

function parseArgs(args: unknown): UrlToolsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'parse') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('parse requires a non-empty "url" string')
    }
    return { action: 'parse', url: url.trim() }
  }

  if (action === 'validate') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('validate requires a non-empty "url" string')
    }
    return { action: 'validate', url: url.trim() }
  }

  if (action === 'metadata') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('metadata requires a non-empty "url" string')
    }
    return { action: 'metadata', url: url.trim() }
  }

  if (action === 'resolve') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('resolve requires a non-empty "url" string')
    }
    return { action: 'resolve', url: url.trim() }
  }

  if (action === 'build') {
    const base = obj['base']
    if (typeof base !== 'string' || base.trim() === '') {
      throw new Error('build requires a non-empty "base" string')
    }
    const pathVal = obj['path']
    const params = obj['params']
    if (pathVal !== undefined && typeof pathVal !== 'string') {
      throw new Error('build "path" must be a string if provided')
    }
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      throw new Error('build "params" must be an object if provided')
    }
    // Validate all param values are strings
    if (params !== undefined) {
      for (const [key, val] of Object.entries(params as Record<string, unknown>)) {
        if (typeof val !== 'string') {
          throw new Error(`build params["${key}"] must be a string`)
        }
      }
    }
    return {
      action: 'build',
      base: base.trim(),
      path: typeof pathVal === 'string' ? pathVal : undefined,
      params: params as Record<string, string> | undefined,
    }
  }

  throw new Error('action must be "parse", "validate", "metadata", "resolve", or "build"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

function extractMetaContent(html: string, nameOrProperty: string): string | undefined {
  // Match both name= and property= attributes
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${nameOrProperty}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${nameOrProperty}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1]
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function executeParse(rawUrl: string): AgentToolResult {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  const searchParams: Record<string, string> = {}
  for (const [key, value] of parsed.searchParams.entries()) {
    searchParams[key] = value
  }

  return textResult(JSON.stringify({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    searchParams,
    hash: parsed.hash,
  }))
}

async function executeValidate(rawUrl: string): Promise<AgentToolResult> {
  const parsed = validateHttpUrl(rawUrl)

  try {
    const response = await fetch(parsed.href, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    return textResult(JSON.stringify({
      reachable: true,
      status: response.status,
      statusText: response.statusText,
      url: parsed.href,
    }))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return textResult(JSON.stringify({
      reachable: false,
      error: message,
      url: parsed.href,
    }))
  }
}

async function executeMetadata(rawUrl: string): Promise<AgentToolResult> {
  const parsed = validateHttpUrl(rawUrl)

  const response = await fetch(parsed.href, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'text/html,application/xhtml+xml' },
  })

  if (!response.ok) {
    throw new Error(`Fetch failed: ${String(response.status)} ${response.statusText}`)
  }

  // Read only the first MAX_HEAD_BYTES
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  let html = ''
  let bytesRead = 0
  const decoder = new TextDecoder()

  try {
    while (bytesRead < MAX_HEAD_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      bytesRead += value.byteLength
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  // Extract metadata
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch?.[1]?.trim() ?? ''

  const ogTitle = extractMetaContent(html, 'og:title')
  const ogDescription = extractMetaContent(html, 'og:description')
  const ogImage = extractMetaContent(html, 'og:image')
  const description = extractMetaContent(html, 'description') ?? ogDescription

  return textResult(JSON.stringify({
    title: ogTitle ?? title,
    description: description ?? '',
    image: ogImage ?? '',
    url: parsed.href,
  }))
}

async function executeResolve(rawUrl: string): Promise<AgentToolResult> {
  let currentUrl = validateHttpUrl(rawUrl)
  const chain: string[] = [currentUrl.href]

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl.href, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status < 300 || response.status >= 400) {
      return textResult(JSON.stringify({
        finalUrl: currentUrl.href,
        hops: hop,
        chain,
      }))
    }

    const location = response.headers.get('location')
    if (!location) {
      return textResult(JSON.stringify({
        finalUrl: currentUrl.href,
        hops: hop,
        chain,
        warning: 'Redirect response without Location header',
      }))
    }

    // Resolve relative redirects
    const nextUrl = new URL(location, currentUrl.href)
    // Validate each redirect target for SSRF
    currentUrl = validateHttpUrl(nextUrl.href)
    chain.push(currentUrl.href)
  }

  throw new Error(`Too many redirects (max ${String(MAX_REDIRECTS)})`)
}

function executeBuild(base: string, urlPath?: string, params?: Record<string, string>): AgentToolResult {
  let url: URL
  try {
    if (urlPath) {
      url = new URL(urlPath, base)
    } else {
      url = new URL(base)
    }
  } catch {
    throw new Error(`Invalid base URL: ${base}`)
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  return textResult(JSON.stringify({ url: url.href }))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "parse", "validate", "metadata", "resolve", or "build"',
      enum: ['parse', 'validate', 'metadata', 'resolve', 'build'],
    },
    url: {
      type: 'string',
      description: 'URL to process (parse, validate, metadata, resolve)',
    },
    base: {
      type: 'string',
      description: 'Base URL (build)',
    },
    path: {
      type: 'string',
      description: 'Path to append to base URL (build, optional)',
    },
    params: {
      type: 'object',
      description: 'Query parameters to add (build, optional)',
    },
  },
  required: ['action'],
}

export const urlToolsTool: ExtendedAgentTool = {
  name: 'url-tools',
  description:
    'Parse, validate, extract metadata, resolve redirects, and build URLs. Actions: parse(url) breaks down URL components; validate(url) checks reachability; metadata(url) extracts title, description, OG tags; resolve(url) follows redirect chain; build(base, path?, params?) constructs URLs.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: false,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'parse':
        return executeParse(parsed.url)
      case 'validate':
        return executeValidate(parsed.url)
      case 'metadata':
        return executeMetadata(parsed.url)
      case 'resolve':
        return executeResolve(parsed.url)
      case 'build':
        return executeBuild(parsed.base, parsed.path, parsed.params)
    }
  },
}

export { validateHttpUrl, isPrivateHostname, parseArgs }
