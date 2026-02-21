/**
 * Summarizer tool — summarize web pages, text, and YouTube videos.
 * Fetches content and returns it with a summary hint for the LLM.
 *
 * Security:
 * - SSRF protection: only HTTPS, no private IPs, no embedded credentials
 * - YouTube: only public timedtext API, video ID validated via regex
 * - HTML stripping: script/style/tag removal before returning content
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SummarizeUrlArgs {
  readonly action: 'summarizeUrl'
  readonly url: string
}

interface SummarizeTextArgs {
  readonly action: 'summarizeText'
  readonly text: string
}

interface SummarizeYoutubeArgs {
  readonly action: 'summarizeYoutube'
  readonly url: string
}

type SummarizerArgs = SummarizeUrlArgs | SummarizeTextArgs | SummarizeYoutubeArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000
const MAX_URL_CONTENT = 50_000
const MAX_TEXT_INPUT = 100_000
const MAX_REDIRECTS = 5
const MAX_CAPTION_LENGTH = 50_000

// ---------------------------------------------------------------------------
// SSRF Protection (same logic as web-search.ts)
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
// YouTube helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a YouTube video ID from various URL formats:
 * - youtube.com/watch?v=ID
 * - youtu.be/ID
 * - youtube.com/embed/ID
 * - m.youtube.com/watch?v=ID
 */
function extractYoutubeId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()

  // youtu.be/ID
  if (hostname === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id
    return null
  }

  // youtube.com variants
  if (
    hostname === 'www.youtube.com' ||
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com'
  ) {
    // /watch?v=ID
    const vParam = parsed.searchParams.get('v')
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam

    // /embed/ID
    const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/)
    if (embedMatch?.[1]) return embedMatch[1]

    return null
  }

  return null
}

// ---------------------------------------------------------------------------
// HTML stripping
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): SummarizerArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'summarizeUrl') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('summarizeUrl requires a non-empty "url" string')
    }
    return { action: 'summarizeUrl', url: url.trim() }
  }

  if (action === 'summarizeText') {
    const text = obj['text']
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('summarizeText requires a non-empty "text" string')
    }
    return { action: 'summarizeText', text: text.trim() }
  }

  if (action === 'summarizeYoutube') {
    const url = obj['url']
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('summarizeYoutube requires a non-empty "url" string')
    }
    return { action: 'summarizeYoutube', url: url.trim() }
  }

  throw new Error('action must be "summarizeUrl", "summarizeText", or "summarizeYoutube"')
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
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

async function executeSummarizeUrl(rawUrl: string): Promise<AgentToolResult> {
  const parsed = validateUrl(rawUrl)

  const response = await fetchWithSsrfCheck(parsed, {
    Accept: 'text/html,application/xhtml+xml,text/plain',
  })

  if (!response.ok) {
    throw new Error(`Fetch failed: ${String(response.status)} ${response.statusText}`)
  }

  const html = await response.text()
  const text = stripHtml(html).slice(0, MAX_URL_CONTENT)

  return textResult(JSON.stringify({
    source: rawUrl,
    instruction: 'Fasse folgenden Text zusammen:',
    content: text,
  }))
}

function executeSummarizeText(text: string): AgentToolResult {
  if (text.length > MAX_TEXT_INPUT) {
    throw new Error(`Text too long (max ${String(MAX_TEXT_INPUT)} characters)`)
  }

  return textResult(JSON.stringify({
    instruction: 'Fasse folgenden Text zusammen:',
    content: text,
  }))
}

async function executeSummarizeYoutube(rawUrl: string): Promise<AgentToolResult> {
  const videoId = extractYoutubeId(rawUrl)
  if (!videoId) {
    throw new Error('Could not extract YouTube video ID from URL')
  }

  // Fetch available caption tracks
  const listUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`
  const listResponse = await fetch(listUrl, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!listResponse.ok) {
    throw new Error(`YouTube caption list failed: ${String(listResponse.status)}`)
  }

  const listXml = await listResponse.text()

  // Extract first available language code
  const langMatch = listXml.match(/lang_code="([^"]+)"/)
  if (!langMatch?.[1]) {
    throw new Error('No captions available for this video')
  }

  const lang = langMatch[1]

  // Fetch captions
  const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(lang)}`
  const captionResponse = await fetch(captionUrl, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!captionResponse.ok) {
    throw new Error(`YouTube caption fetch failed: ${String(captionResponse.status)}`)
  }

  const captionXml = await captionResponse.text()

  // Extract text from XML caption elements
  const textContent = captionXml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION_LENGTH)

  return textResult(JSON.stringify({
    source: rawUrl,
    videoId,
    language: lang,
    instruction: 'Fasse folgende YouTube-Untertitel zusammen:',
    content: textContent,
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
      description: 'Action: "summarizeUrl" (web page), "summarizeText" (plain text), "summarizeYoutube" (YouTube video captions)',
      enum: ['summarizeUrl', 'summarizeText', 'summarizeYoutube'],
    },
    url: {
      type: 'string',
      description: 'URL to summarize (summarizeUrl, summarizeYoutube). Must be https://.',
    },
    text: {
      type: 'string',
      description: 'Text to summarize (summarizeText). Max 100,000 characters.',
    },
  },
  required: ['action'],
}

export const summarizerTool: ExtendedAgentTool = {
  name: 'summarizer',
  description:
    'Summarize content. Actions: summarizeUrl(url) fetches and extracts web page text; summarizeText(text) prepares text for summarization; summarizeYoutube(url) extracts YouTube video captions. Only HTTPS URLs allowed.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: false,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'summarizeUrl':
        return executeSummarizeUrl(parsed.url)
      case 'summarizeText':
        return executeSummarizeText(parsed.text)
      case 'summarizeYoutube':
        return executeSummarizeYoutube(parsed.url)
    }
  },
}

export { validateUrl, extractYoutubeId }
