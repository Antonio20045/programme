/**
 * News Feed tool — fetch headlines from hardcoded RSS feeds.
 * Hardcoded feed allowlist (no user-controlled URLs — SSRF protection).
 * Own regex-based RSS 2.0 parser (no external XML dependency).
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedSource {
  readonly name: string
  readonly url: string
  readonly lang: string
}

interface FeedItem {
  readonly title: string
  readonly link: string
  readonly description: string
  readonly pubDate: string
  readonly source: string
}

interface HeadlinesArgs {
  readonly action: 'headlines'
  readonly source?: string
  readonly lang?: string
}

interface SearchArgs {
  readonly action: 'search'
  readonly query: string
  readonly source?: string
}

interface SourcesArgs {
  readonly action: 'sources'
}

type NewsFeedArgs = HeadlinesArgs | SearchArgs | SourcesArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEED_TIMEOUT_MS = 10_000
const OVERALL_TIMEOUT_MS = 30_000
const MAX_FEED_SIZE = 100 * 1024 // 100 KB
const MAX_ITEMS_PER_FEED = 10

// ---------------------------------------------------------------------------
// Hardcoded Feed Allowlist
// ---------------------------------------------------------------------------

const FEEDS: ReadonlyMap<string, FeedSource> = new Map([
  ['tagesschau', { name: 'Tagesschau', url: 'https://www.tagesschau.de/xml/rss2/', lang: 'de' }],
  ['spiegel', { name: 'Spiegel', url: 'https://www.spiegel.de/schlagzeilen/index.rss', lang: 'de' }],
  ['hn', { name: 'Hacker News', url: 'https://hnrss.org/frontpage', lang: 'en' }],
  ['reuters', { name: 'Reuters', url: 'https://www.reutersagency.com/feed/', lang: 'en' }],
  ['techcrunch', { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', lang: 'en' }],
])

/** All allowed feed hostnames (derived from FEEDS). */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  Array.from(FEEDS.values()).map((f) => new URL(f.url).hostname),
)

// ---------------------------------------------------------------------------
// RSS Parser (regex-based, RSS 2.0 only)
// ---------------------------------------------------------------------------

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim()
}

function extractTag(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(pattern)
  if (!match?.[1]) return ''
  return decodeEntities(stripCdata(match[1])).trim()
}

function parseRss(xml: string, sourceName: string): FeedItem[] {
  const items: FeedItem[] = []
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi
  const matches = Array.from(xml.matchAll(itemPattern))

  for (const match of matches) {
    if (items.length >= MAX_ITEMS_PER_FEED) break

    const itemXml = match[1]
    if (!itemXml) continue

    const title = stripHtmlTags(extractTag(itemXml, 'title'))
    const link = extractTag(itemXml, 'link')
    const rawDesc = extractTag(itemXml, 'description')
    const description = stripHtmlTags(rawDesc).slice(0, 500)
    const pubDate = extractTag(itemXml, 'pubDate')

    if (title || link) {
      items.push({ title, link, description, pubDate, source: sourceName })
    }
  }

  return items
}

// ---------------------------------------------------------------------------
// Feed fetching
// ---------------------------------------------------------------------------

async function fetchFeed(source: FeedSource): Promise<FeedItem[]> {
  const response = await fetch(source.url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Feed ${source.name}: ${String(response.status)} ${response.statusText}`)
  }

  const text = await response.text()

  if (text.length > MAX_FEED_SIZE) {
    throw new Error(`Feed ${source.name}: response too large (${String(text.length)} bytes)`)
  }

  return parseRss(text, source.name)
}

async function fetchMultipleFeeds(sources: FeedSource[]): Promise<FeedItem[]> {
  const controller = new AbortController()
  const overallTimeout = setTimeout(() => { controller.abort() }, OVERALL_TIMEOUT_MS)

  try {
    const results = await Promise.allSettled(
      sources.map((source) => fetchFeed(source)),
    )

    const allItems: FeedItem[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value)
      }
    }

    // Sort by pubDate descending (newest first)
    allItems.sort((a, b) => {
      const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0
      const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0
      if (isNaN(dateA) || isNaN(dateB)) return 0
      return dateB - dateA
    })

    return allItems
  } finally {
    clearTimeout(overallTimeout)
  }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function getSelectedFeeds(source?: string, lang?: string): FeedSource[] {
  if (source) {
    const feed = FEEDS.get(source.toLowerCase())
    if (!feed) {
      const validKeys = Array.from(FEEDS.keys()).join(', ')
      throw new Error(`Unknown source "${source}". Available: ${validKeys}`)
    }
    return [feed]
  }

  if (lang) {
    const langLower = lang.toLowerCase()
    const filtered = Array.from(FEEDS.values()).filter((f) => f.lang === langLower)
    if (filtered.length === 0) {
      throw new Error(`No feeds available for language "${lang}"`)
    }
    return filtered
  }

  return Array.from(FEEDS.values())
}

async function executeHeadlines(args: HeadlinesArgs): Promise<AgentToolResult> {
  const sources = getSelectedFeeds(args.source, args.lang)
  const items = await fetchMultipleFeeds(sources)
  return textResult(JSON.stringify({ headlines: items, count: items.length }))
}

async function executeSearch(args: SearchArgs): Promise<AgentToolResult> {
  const sources = getSelectedFeeds(args.source)
  const items = await fetchMultipleFeeds(sources)

  const queryLower = args.query.toLowerCase()
  const filtered = items.filter(
    (item) =>
      item.title.toLowerCase().includes(queryLower) ||
      item.description.toLowerCase().includes(queryLower),
  )

  return textResult(JSON.stringify({ results: filtered, count: filtered.length, query: args.query }))
}

function executeSources(): AgentToolResult {
  const sources = Array.from(FEEDS.entries()).map(([key, feed]) => ({
    key,
    name: feed.name,
    lang: feed.lang,
  }))
  return textResult(JSON.stringify({ sources }))
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): NewsFeedArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'headlines') {
    const source = obj['source']
    const lang = obj['lang']
    return {
      action: 'headlines',
      source: typeof source === 'string' && source.trim() !== '' ? source.trim() : undefined,
      lang: typeof lang === 'string' && lang.trim() !== '' ? lang.trim() : undefined,
    }
  }

  if (action === 'search') {
    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('search requires a non-empty "query" string')
    }
    const source = obj['source']
    return {
      action: 'search',
      query: query.trim(),
      source: typeof source === 'string' && source.trim() !== '' ? source.trim() : undefined,
    }
  }

  if (action === 'sources') {
    return { action: 'sources' }
  }

  throw new Error('action must be "headlines", "search", or "sources"')
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
      description: 'Action: "headlines", "search", or "sources"',
      enum: ['headlines', 'search', 'sources'],
    },
    source: {
      type: 'string',
      description: 'Feed source key (e.g. tagesschau, spiegel, hn, reuters, techcrunch)',
    },
    lang: {
      type: 'string',
      description: 'Filter by language (de, en) — only for headlines',
    },
    query: {
      type: 'string',
      description: 'Search query (required for search action)',
    },
  },
  required: ['action'],
}

export const newsFeedTool: ExtendedAgentTool = {
  name: 'news-feed',
  description:
    'Fetch news headlines from curated RSS feeds. Actions: headlines(source?, lang?) fetches latest news; search(query, source?) filters by keyword; sources() lists available feeds.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: false,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'headlines':
        return executeHeadlines(parsed)
      case 'search':
        return executeSearch(parsed)
      case 'sources':
        return executeSources()
    }
  },
}

export { parseRss, stripCdata, decodeEntities, FEEDS, ALLOWED_HOSTS }
