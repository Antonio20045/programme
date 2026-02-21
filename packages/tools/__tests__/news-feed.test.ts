import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { newsFeedTool, parseRss, stripCdata, decodeEntities, FEEDS, ALLOWED_HOSTS } from '../src/news-feed'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/news-feed.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock RSS XML
// ---------------------------------------------------------------------------

const MOCK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Test Feed</title>
  <item>
    <title>Breaking News</title>
    <link>https://example.com/1</link>
    <description>Something happened</description>
    <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Tech Update</title>
    <link>https://example.com/2</link>
    <description>New tech released</description>
    <pubDate>Mon, 01 Jan 2024 11:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`

const MOCK_RSS_CDATA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <item>
    <title><![CDATA[CDATA Title & "Quotes"]]></title>
    <link>https://example.com/cdata</link>
    <description><![CDATA[<p>HTML &amp; entities</p>]]></description>
    <pubDate>Mon, 01 Jan 2024 10:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`

const MOCK_RSS_ENTITIES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <item>
    <title>Foo &amp; Bar &lt;Baz&gt;</title>
    <link>https://example.com/entities</link>
    <description>Quote: &quot;hello&quot; &apos;world&apos;</description>
  </item>
</channel>
</rss>`

// ---------------------------------------------------------------------------
// Fetch mock helper
// ---------------------------------------------------------------------------

function mockFetchText(text: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(text),
    }),
  )
}

function mockFetchMultiple(responses: Array<{ text: string; status?: number }>): void {
  const mockFn = vi.fn()
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i] as { text: string; status?: number }
    const status = r.status ?? 200
    mockFn.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(r.text),
    })
  }
  vi.stubGlobal('fetch', mockFn)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('news-feed tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(newsFeedTool.name).toBe('news-feed')
    })

    it('runs on server', () => {
      expect(newsFeedTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(newsFeedTool.permissions).toContain('net:http')
    })

    it('does not require confirmation', () => {
      expect(newsFeedTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // headlines()
  // -------------------------------------------------------------------------

  describe('headlines()', () => {
    it('fetches headlines from a specific source', async () => {
      mockFetchText(MOCK_RSS)

      const result = await newsFeedTool.execute({ action: 'headlines', source: 'tagesschau' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { headlines: Array<{ title: string; source: string }>; count: number }

      expect(parsed.count).toBe(2)
      expect(parsed.headlines[0]?.title).toBe('Breaking News')
      expect(parsed.headlines[0]?.source).toBe('Tagesschau')
    })

    it('filters by language', async () => {
      mockFetchMultiple([
        { text: MOCK_RSS },
        { text: MOCK_RSS },
      ])

      const result = await newsFeedTool.execute({ action: 'headlines', lang: 'de' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { headlines: unknown[]; count: number }

      // Should have fetched from DE feeds (tagesschau + spiegel)
      expect(parsed.count).toBeGreaterThan(0)
    })

    it('throws on unknown source', async () => {
      await expect(
        newsFeedTool.execute({ action: 'headlines', source: 'nonexistent' }),
      ).rejects.toThrow('Unknown source')
    })

    it('throws on unknown language', async () => {
      await expect(
        newsFeedTool.execute({ action: 'headlines', lang: 'xx' }),
      ).rejects.toThrow('No feeds available')
    })

    it('handles feed errors gracefully via allSettled', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error')),
      )

      const result = await newsFeedTool.execute({ action: 'headlines', source: 'hn' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { headlines: unknown[]; count: number }

      expect(parsed.count).toBe(0)
      expect(parsed.headlines).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('filters items by keyword in title', async () => {
      mockFetchText(MOCK_RSS)

      const result = await newsFeedTool.execute({ action: 'search', query: 'Breaking', source: 'hn' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { results: Array<{ title: string }>; count: number; query: string }

      expect(parsed.count).toBe(1)
      expect(parsed.results[0]?.title).toBe('Breaking News')
      expect(parsed.query).toBe('Breaking')
    })

    it('filters items by keyword in description', async () => {
      mockFetchText(MOCK_RSS)

      const result = await newsFeedTool.execute({ action: 'search', query: 'tech released', source: 'hn' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { results: unknown[]; count: number }

      expect(parsed.count).toBe(1)
    })

    it('search is case-insensitive', async () => {
      mockFetchText(MOCK_RSS)

      const result = await newsFeedTool.execute({ action: 'search', query: 'BREAKING', source: 'hn' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { count: number }

      expect(parsed.count).toBe(1)
    })

    it('returns empty results for no match', async () => {
      mockFetchText(MOCK_RSS)

      const result = await newsFeedTool.execute({ action: 'search', query: 'xyznonexistent', source: 'hn' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { count: number }

      expect(parsed.count).toBe(0)
    })

    it('throws on empty query', async () => {
      await expect(
        newsFeedTool.execute({ action: 'search', query: '' }),
      ).rejects.toThrow('non-empty "query"')
    })
  })

  // -------------------------------------------------------------------------
  // sources()
  // -------------------------------------------------------------------------

  describe('sources()', () => {
    it('lists all available sources', async () => {
      const result = await newsFeedTool.execute({ action: 'sources' })
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { sources: Array<{ key: string; name: string; lang: string }> }

      expect(parsed.sources).toHaveLength(FEEDS.size)
      const keys = parsed.sources.map((s) => s.key)
      expect(keys).toContain('tagesschau')
      expect(keys).toContain('hn')
      expect(keys).toContain('reuters')
    })
  })

  // -------------------------------------------------------------------------
  // RSS Parser
  // -------------------------------------------------------------------------

  describe('parseRss()', () => {
    it('parses standard RSS items', () => {
      const items = parseRss(MOCK_RSS, 'Test')
      expect(items).toHaveLength(2)
      expect(items[0]?.title).toBe('Breaking News')
      expect(items[0]?.link).toBe('https://example.com/1')
      expect(items[0]?.description).toBe('Something happened')
      expect(items[0]?.source).toBe('Test')
    })

    it('handles CDATA sections', () => {
      const items = parseRss(MOCK_RSS_CDATA, 'Test')
      expect(items).toHaveLength(1)
      expect(items[0]?.title).toBe('CDATA Title & "Quotes"')
      expect(items[0]?.description).toBe('HTML & entities')
    })

    it('decodes HTML entities', () => {
      const items = parseRss(MOCK_RSS_ENTITIES, 'Test')
      expect(items).toHaveLength(1)
      // <Baz> is stripped by stripHtmlTags (looks like HTML)
      expect(items[0]?.title).toBe('Foo & Bar')
      expect(items[0]?.description).toContain('"hello"')
      expect(items[0]?.description).toContain("'world'")
    })

    it('limits to MAX_ITEMS_PER_FEED', () => {
      const manyItems = Array.from({ length: 20 }, (_, i) =>
        `<item><title>Item ${String(i)}</title><link>https://example.com/${String(i)}</link></item>`,
      ).join('')
      const xml = `<rss><channel>${manyItems}</channel></rss>`

      const items = parseRss(xml, 'Test')
      expect(items).toHaveLength(10)
    })

    it('skips items without title and link', () => {
      const xml = `<rss><channel>
        <item><description>Only desc</description></item>
        <item><title>Has Title</title><link>https://example.com</link></item>
      </channel></rss>`

      const items = parseRss(xml, 'Test')
      expect(items).toHaveLength(1)
      expect(items[0]?.title).toBe('Has Title')
    })

    it('returns empty array for malformed XML', () => {
      const items = parseRss('not xml at all', 'Test')
      expect(items).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Helper functions
  // -------------------------------------------------------------------------

  describe('stripCdata()', () => {
    it('strips CDATA markers', () => {
      expect(stripCdata('<![CDATA[hello]]>')).toBe('hello')
    })

    it('leaves non-CDATA text unchanged', () => {
      expect(stripCdata('plain text')).toBe('plain text')
    })
  })

  describe('decodeEntities()', () => {
    it('decodes all supported entities', () => {
      expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe("&<>\"'")
    })
  })

  // -------------------------------------------------------------------------
  // ALLOWED_HOSTS
  // -------------------------------------------------------------------------

  describe('ALLOWED_HOSTS', () => {
    it('contains all feed hostnames', () => {
      for (const feed of FEEDS.values()) {
        const hostname = new URL(feed.url).hostname
        expect(ALLOWED_HOSTS.has(hostname)).toBe(true)
      }
    })

    it('does not contain arbitrary hosts', () => {
      expect(ALLOWED_HOSTS.has('evil.com')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(newsFeedTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(newsFeedTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        newsFeedTool.execute({ action: 'delete' }),
      ).rejects.toThrow('action must be')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      const allowedUrls = Array.from(FEEDS.values()).map((f) => f.url)
      assertNoUnauthorizedFetch(sourceCode, allowedUrls)
    })
  })
})
