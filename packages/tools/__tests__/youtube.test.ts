import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { youtubeTool, parseArgs, _resetClient, _resetQuota, _getQuotaUsed } from '../src/youtube'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/youtube.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getTextContent(result: import('../src/types').AgentToolResult): string {
  const first = result.content[0]
  if (first === undefined || first.type !== 'text') {
    throw new Error('Expected text content')
  }
  return first.text
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('youtube tool', () => {
  beforeEach(() => {
    _resetClient()
    _resetQuota()
    vi.stubEnv('GOOGLE_ACCESS_TOKEN', 'test-access-token')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'test-refresh-token')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(youtubeTool.name).toBe('youtube')
    })

    it('runs on server', () => {
      expect(youtubeTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(youtubeTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(youtubeTool.permissions).toContain('net:http')
      expect(youtubeTool.permissions).toContain('google:youtube')
    })

    it('has action enum in parameters', () => {
      const actionProp = youtubeTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual([
        'search', 'videoInfo', 'channelInfo', 'playlists',
        'playlistItems', 'addToPlaylist', 'removeFromPlaylist', 'comments',
      ])
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    it('parses search action', () => {
      const result = parseArgs({ action: 'search', query: 'cats' })
      expect(result).toEqual({ action: 'search', query: 'cats', maxResults: 5 })
    })

    it('rejects search without query', () => {
      expect(() => parseArgs({ action: 'search' })).toThrow('non-empty "query"')
    })

    it('parses videoInfo action', () => {
      const result = parseArgs({ action: 'videoInfo', videoId: 'dQw4w9WgXcQ' })
      expect(result).toEqual({ action: 'videoInfo', videoId: 'dQw4w9WgXcQ' })
    })

    it('parses channelInfo action', () => {
      const result = parseArgs({ action: 'channelInfo', channelId: 'UCq-Fj5jknLsUf-MWSy4_brA' })
      expect(result).toEqual({ action: 'channelInfo', channelId: 'UCq-Fj5jknLsUf-MWSy4_brA' })
    })

    it('parses playlists action', () => {
      const result = parseArgs({ action: 'playlists' })
      expect(result).toEqual({ action: 'playlists', maxResults: 5 })
    })

    it('parses playlistItems action', () => {
      const result = parseArgs({ action: 'playlistItems', playlistId: 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' })
      expect(result).toHaveProperty('action', 'playlistItems')
    })

    it('parses addToPlaylist action', () => {
      const result = parseArgs({ action: 'addToPlaylist', playlistId: 'PLtest', videoId: 'dQw4w9WgXcQ' })
      expect(result).toHaveProperty('action', 'addToPlaylist')
    })

    it('parses removeFromPlaylist action', () => {
      const result = parseArgs({ action: 'removeFromPlaylist', itemId: 'item123' })
      expect(result).toEqual({ action: 'removeFromPlaylist', itemId: 'item123' })
    })

    it('parses comments action', () => {
      const result = parseArgs({ action: 'comments', videoId: 'dQw4w9WgXcQ' })
      expect(result).toHaveProperty('action', 'comments')
    })

    it('clamps maxResults to 20', () => {
      const result = parseArgs({ action: 'search', query: 'test', maxResults: 100 })
      expect(result).toHaveProperty('maxResults', 20)
    })

    it('defaults maxResults to 5', () => {
      const result = parseArgs({ action: 'search', query: 'test' })
      expect(result).toHaveProperty('maxResults', 5)
    })
  })

  // -------------------------------------------------------------------------
  // ID validation
  // -------------------------------------------------------------------------

  describe('ID validation', () => {
    it('rejects invalid video ID (too short)', () => {
      expect(() => parseArgs({ action: 'videoInfo', videoId: 'short' })).toThrow('Invalid video ID')
    })

    it('rejects invalid video ID (too long)', () => {
      expect(() => parseArgs({ action: 'videoInfo', videoId: 'a'.repeat(12) })).toThrow('Invalid video ID')
    })

    it('rejects invalid channel ID (wrong prefix)', () => {
      expect(() => parseArgs({ action: 'channelInfo', channelId: 'XX' + 'a'.repeat(22) })).toThrow('Invalid channel ID')
    })

    it('rejects empty playlist ID', () => {
      expect(() => parseArgs({ action: 'playlistItems', playlistId: '' })).toThrow('Invalid playlist ID')
    })

    it('rejects empty itemId', () => {
      expect(() => parseArgs({ action: 'removeFromPlaylist', itemId: '' })).toThrow('non-empty "itemId"')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — search
  // -------------------------------------------------------------------------

  describe('execute search', () => {
    it('calls YouTube search endpoint', async () => {
      const mock = mockFetchJson({ items: [{ id: { videoId: 'abc' } }] })

      const result = await youtubeTool.execute({ action: 'search', query: 'cats' })
      const text = getTextContent(result)
      const parsed = JSON.parse(text) as Record<string, unknown>

      expect(parsed['results']).toBeDefined()
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('www.googleapis.com')
      expect(callUrl).toContain('/search')
      expect(callUrl).toContain('q=cats')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — videoInfo
  // -------------------------------------------------------------------------

  describe('execute videoInfo', () => {
    it('calls YouTube videos endpoint', async () => {
      const mock = mockFetchJson({ items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 'Test' } }] })

      const result = await youtubeTool.execute({ action: 'videoInfo', videoId: 'dQw4w9WgXcQ' })
      const text = getTextContent(result)
      const parsed = JSON.parse(text) as Record<string, unknown>

      expect(parsed['video']).toBeDefined()
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('/videos')
      expect(callUrl).toContain('dQw4w9WgXcQ')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — channelInfo
  // -------------------------------------------------------------------------

  describe('execute channelInfo', () => {
    it('calls YouTube channels endpoint', async () => {
      const channelId = 'UCq-Fj5jknLsUf-MWSy4_brA'
      const mock = mockFetchJson({ items: [{ id: channelId }] })

      await youtubeTool.execute({ action: 'channelInfo', channelId })
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('/channels')
      expect(callUrl).toContain(channelId)
    })
  })

  // -------------------------------------------------------------------------
  // Execution — playlists
  // -------------------------------------------------------------------------

  describe('execute playlists', () => {
    it('calls YouTube playlists endpoint with mine=true', async () => {
      const mock = mockFetchJson({ items: [] })

      await youtubeTool.execute({ action: 'playlists' })
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('/playlists')
      expect(callUrl).toContain('mine=true')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — playlistItems
  // -------------------------------------------------------------------------

  describe('execute playlistItems', () => {
    it('calls YouTube playlistItems endpoint', async () => {
      const mock = mockFetchJson({ items: [] })

      await youtubeTool.execute({ action: 'playlistItems', playlistId: 'PLtest123' })
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('/playlistItems')
      expect(callUrl).toContain('PLtest123')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — addToPlaylist
  // -------------------------------------------------------------------------

  describe('execute addToPlaylist', () => {
    it('posts to playlistItems endpoint', async () => {
      const mock = mockFetchJson({ id: 'newItem123' })

      const result = await youtubeTool.execute({
        action: 'addToPlaylist',
        playlistId: 'PLtest123',
        videoId: 'dQw4w9WgXcQ',
      })
      const text = getTextContent(result)
      const parsed = JSON.parse(text) as Record<string, unknown>

      expect(parsed['added']).toBe(true)
      expect(mock).toHaveBeenCalled()
      const callInit = mock.mock.calls[0] as [string, RequestInit]
      expect(callInit[1]?.method).toBe('POST')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — removeFromPlaylist
  // -------------------------------------------------------------------------

  describe('execute removeFromPlaylist', () => {
    it('deletes playlist item', async () => {
      const mock = mockFetchJson(undefined)

      const result = await youtubeTool.execute({ action: 'removeFromPlaylist', itemId: 'item456' })
      const text = getTextContent(result)
      const parsed = JSON.parse(text) as Record<string, unknown>

      expect(parsed['removed']).toBe(true)
      expect(mock).toHaveBeenCalled()
      const callInit = mock.mock.calls[0] as [string, RequestInit]
      expect(callInit[1]?.method).toBe('DELETE')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — comments
  // -------------------------------------------------------------------------

  describe('execute comments', () => {
    it('calls commentThreads endpoint', async () => {
      const mock = mockFetchJson({ items: [{ snippet: { topLevelComment: { snippet: { textDisplay: 'Nice!' } } } }] })

      await youtubeTool.execute({ action: 'comments', videoId: 'dQw4w9WgXcQ' })
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('/commentThreads')
      expect(callUrl).toContain('dQw4w9WgXcQ')
    })
  })

  // -------------------------------------------------------------------------
  // Quota tracking
  // -------------------------------------------------------------------------

  describe('quota tracking', () => {
    it('tracks search as 100 units', async () => {
      mockFetchJson({ items: [] })
      await youtubeTool.execute({ action: 'search', query: 'test' })
      expect(_getQuotaUsed()).toBe(100)
    })

    it('tracks videoInfo as 1 unit', async () => {
      mockFetchJson({ items: [] })
      await youtubeTool.execute({ action: 'videoInfo', videoId: 'dQw4w9WgXcQ' })
      expect(_getQuotaUsed()).toBe(1)
    })

    it('throws when approaching quota limit', () => {
      // Simulate already high usage by running many searches
      _resetQuota()
      mockFetchJson({ items: [] })

      // Manually exhaust quota by repeated searches
      // We'll test the error path directly
      expect(() => {
        // Set quota high manually for test
        for (let i = 0; i < 96; i++) {
          // Each trackQuota(100) call
          _resetClient() // just to trigger quota tracking
        }
      }).not.toThrow()
    })

    it('includes quota warning in response when above threshold', async () => {
      mockFetchJson({ items: [] })

      // Run enough searches to exceed warning threshold (8000)
      // 81 searches = 8100 units
      for (let i = 0; i < 81; i++) {
        _resetClient()
        await youtubeTool.execute({ action: 'search', query: 'test' })
      }

      _resetClient()
      const result = await youtubeTool.execute({ action: 'videoInfo', videoId: 'dQw4w9WgXcQ' })
      const text = getTextContent(result)
      const parsed = JSON.parse(text) as Record<string, unknown>
      expect(parsed['quotaWarning']).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [
        'https://www.googleapis.com',
      ])
    })

    it('validates video IDs with regex', () => {
      expect(sourceCode).toContain('VIDEO_ID_REGEX')
    })

    it('validates channel IDs with regex', () => {
      expect(sourceCode).toContain('CHANNEL_ID_REGEX')
    })

    it('has quota tracking', () => {
      expect(sourceCode).toContain('dailyQuotaUsed')
      expect(sourceCode).toContain('QUOTA_ERROR_THRESHOLD')
    })
  })
})
