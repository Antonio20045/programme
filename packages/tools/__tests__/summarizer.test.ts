import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { summarizerTool, validateUrl, extractYoutubeId } from '../src/summarizer'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/summarizer.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchHtml(html: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(html),
    }),
  )
}

function mockFetchSequence(responses: { text: string; status?: number }[]): void {
  const mockFn = vi.fn()
  for (const [i, resp] of responses.entries()) {
    const status = resp.status ?? 200
    mockFn.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(resp.text),
    })
    // Suppress unused variable — index used for ordering
    void i
  }
  vi.stubGlobal('fetch', mockFn)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summarizer tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(summarizerTool.name).toBe('summarizer')
    })

    it('runs on server', () => {
      expect(summarizerTool.runsOn).toBe('server')
    })

    it('has net:http permission', () => {
      expect(summarizerTool.permissions).toContain('net:http')
    })

    it('does not require confirmation', () => {
      expect(summarizerTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // summarizeUrl()
  // -------------------------------------------------------------------------

  describe('summarizeUrl()', () => {
    it('fetches and strips HTML, returns text with instruction', async () => {
      mockFetchHtml(
        '<html><head><style>body{}</style></head><body><script>alert(1)</script><p>Important content here</p></body></html>',
      )

      const result = await summarizerTool.execute({
        action: 'summarizeUrl',
        url: 'https://example.com/article',
      })

      expect(result.content).toHaveLength(1)
      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { source: string; instruction: string; content: string }

      expect(parsed.source).toBe('https://example.com/article')
      expect(parsed.instruction).toContain('zusammen')
      expect(parsed.content).toContain('Important content here')
      expect(parsed.content).not.toContain('alert')
      expect(parsed.content).not.toContain('body{}')
    })

    it('truncates content to 50,000 characters', async () => {
      const longContent = '<p>' + 'A'.repeat(60_000) + '</p>'
      mockFetchHtml(longContent)

      const result = await summarizerTool.execute({
        action: 'summarizeUrl',
        url: 'https://example.com/long',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { content: string }

      expect(parsed.content.length).toBeLessThanOrEqual(50_000)
    })

    it('throws on fetch error', async () => {
      mockFetchHtml('', 500)

      await expect(
        summarizerTool.execute({ action: 'summarizeUrl', url: 'https://example.com' }),
      ).rejects.toThrow('Fetch failed')
    })
  })

  // -------------------------------------------------------------------------
  // summarizeText()
  // -------------------------------------------------------------------------

  describe('summarizeText()', () => {
    it('returns text with summary instruction', async () => {
      const result = await summarizerTool.execute({
        action: 'summarizeText',
        text: 'This is a long article about programming.',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { instruction: string; content: string }

      expect(parsed.instruction).toContain('zusammen')
      expect(parsed.content).toBe('This is a long article about programming.')
    })

    it('rejects text exceeding 100,000 characters', async () => {
      const longText = 'X'.repeat(100_001)

      await expect(
        summarizerTool.execute({ action: 'summarizeText', text: longText }),
      ).rejects.toThrow('too long')
    })

    it('accepts text at exactly 100,000 characters', async () => {
      const text = 'X'.repeat(100_000)

      const result = await summarizerTool.execute({
        action: 'summarizeText',
        text,
      })

      expect(result.content).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // summarizeYoutube()
  // -------------------------------------------------------------------------

  describe('summarizeYoutube()', () => {
    it('extracts captions from YouTube video', async () => {
      mockFetchSequence([
        // Caption list response
        { text: '<transcript_list><track lang_code="en" lang_translated="English"/></transcript_list>' },
        // Caption content response
        { text: '<transcript><text start="0" dur="5">Hello world</text><text start="5" dur="3">More content</text></transcript>' },
      ])

      const result = await summarizerTool.execute({
        action: 'summarizeYoutube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      })

      const parsed = JSON.parse(
        (result.content[0] as { type: 'text'; text: string }).text,
      ) as { videoId: string; language: string; content: string }

      expect(parsed.videoId).toBe('dQw4w9WgXcQ')
      expect(parsed.language).toBe('en')
      expect(parsed.content).toContain('Hello world')
      expect(parsed.content).toContain('More content')
    })

    it('throws when no captions available', async () => {
      mockFetchSequence([
        { text: '<transcript_list></transcript_list>' },
      ])

      await expect(
        summarizerTool.execute({
          action: 'summarizeYoutube',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        }),
      ).rejects.toThrow('No captions available')
    })

    it('throws for invalid YouTube URL', async () => {
      await expect(
        summarizerTool.execute({
          action: 'summarizeYoutube',
          url: 'https://example.com/not-youtube',
        }),
      ).rejects.toThrow('Could not extract YouTube video ID')
    })
  })

  // -------------------------------------------------------------------------
  // extractYoutubeId()
  // -------------------------------------------------------------------------

  describe('extractYoutubeId()', () => {
    it('extracts ID from standard watch URL', () => {
      expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from short URL', () => {
      expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from embed URL', () => {
      expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from mobile URL', () => {
      expect(extractYoutubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('extracts ID without www', () => {
      expect(extractYoutubeId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    })

    it('returns null for non-YouTube URL', () => {
      expect(extractYoutubeId('https://example.com/video')).toBeNull()
    })

    it('returns null for invalid video ID', () => {
      expect(extractYoutubeId('https://www.youtube.com/watch?v=short')).toBeNull()
    })

    it('returns null for invalid URL', () => {
      expect(extractYoutubeId('not-a-url')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // validateUrl() (SSRF protection)
  // -------------------------------------------------------------------------

  describe('validateUrl() — SSRF protection', () => {
    it('accepts valid HTTPS URL', () => {
      const parsed = validateUrl('https://example.com/page')
      expect(parsed.protocol).toBe('https:')
    })

    it('rejects file:// URL', () => {
      expect(() => validateUrl('file:///etc/passwd')).toThrow('only https:')
    })

    it('rejects http:// URL', () => {
      expect(() => validateUrl('http://example.com')).toThrow('only https:')
    })

    it('rejects localhost', () => {
      expect(() => validateUrl('https://localhost/path')).toThrow('private/internal')
    })

    it('rejects 127.0.0.1', () => {
      expect(() => validateUrl('https://127.0.0.1')).toThrow('private/internal')
    })

    it('rejects 10.x.x.x', () => {
      expect(() => validateUrl('https://10.0.0.1')).toThrow('private/internal')
    })

    it('rejects 192.168.x.x', () => {
      expect(() => validateUrl('https://192.168.1.1')).toThrow('private/internal')
    })

    it('rejects embedded credentials', () => {
      expect(() => validateUrl('https://user:pass@example.com')).toThrow('credentials')
    })

    it('rejects invalid URL', () => {
      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(summarizerTool.execute(null)).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects non-object args', async () => {
      await expect(summarizerTool.execute('string')).rejects.toThrow(
        'Arguments must be an object',
      )
    })

    it('rejects unknown action', async () => {
      await expect(
        summarizerTool.execute({ action: 'unknown' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects summarizeUrl with empty url', async () => {
      await expect(
        summarizerTool.execute({ action: 'summarizeUrl', url: '' }),
      ).rejects.toThrow('non-empty "url"')
    })

    it('rejects summarizeText with empty text', async () => {
      await expect(
        summarizerTool.execute({ action: 'summarizeText', text: '' }),
      ).rejects.toThrow('non-empty "text"')
    })

    it('rejects summarizeYoutube with empty url', async () => {
      await expect(
        summarizerTool.execute({ action: 'summarizeYoutube', url: '' }),
      ).rejects.toThrow('non-empty "url"')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no eval/exec patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, ['https://www.youtube.com'])
    })
  })
})
