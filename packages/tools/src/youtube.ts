/**
 * YouTube tool — search videos, get info, manage playlists, read comments.
 * Uses YouTube Data API v3 via shared Google API client.
 *
 * URL policy: Only requests to www.googleapis.com.
 * Quota tracking: search costs 100 units, all others cost 1 unit.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
import { createGoogleApiClient, type GoogleApiClient } from './google-api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://www.googleapis.com/youtube/v3'

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'www.googleapis.com',
])

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const CHANNEL_ID_REGEX = /^UC[a-zA-Z0-9_-]{22}$/
const PLAYLIST_ID_REGEX = /^[a-zA-Z0-9_-]+$/

const DEFAULT_MAX_RESULTS = 5
const MAX_MAX_RESULTS = 20

const QUOTA_WARN_THRESHOLD = 8_000
const QUOTA_ERROR_THRESHOLD = 9_500

// ---------------------------------------------------------------------------
// Quota tracking (module-level, resets daily)
// ---------------------------------------------------------------------------

let dailyQuotaUsed = 0
let quotaResetDate = ''

function trackQuota(units: number): void {
  const today = new Date().toISOString().slice(0, 10)
  if (quotaResetDate !== today) {
    dailyQuotaUsed = 0
    quotaResetDate = today
  }

  if (dailyQuotaUsed + units > QUOTA_ERROR_THRESHOLD) {
    throw new Error(`YouTube API quota limit approaching (${String(dailyQuotaUsed)}/${String(QUOTA_ERROR_THRESHOLD)} units). Wait until tomorrow.`)
  }

  dailyQuotaUsed += units
}

function getQuotaWarning(): string | undefined {
  if (dailyQuotaUsed > QUOTA_WARN_THRESHOLD) {
    return `Quota warning: ${String(dailyQuotaUsed)} units used today`
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchArgs {
  readonly action: 'search'
  readonly query: string
  readonly maxResults: number
}

interface VideoInfoArgs {
  readonly action: 'videoInfo'
  readonly videoId: string
}

interface ChannelInfoArgs {
  readonly action: 'channelInfo'
  readonly channelId: string
}

interface PlaylistsArgs {
  readonly action: 'playlists'
  readonly maxResults: number
}

interface PlaylistItemsArgs {
  readonly action: 'playlistItems'
  readonly playlistId: string
  readonly maxResults: number
}

interface AddToPlaylistArgs {
  readonly action: 'addToPlaylist'
  readonly playlistId: string
  readonly videoId: string
}

interface RemoveFromPlaylistArgs {
  readonly action: 'removeFromPlaylist'
  readonly itemId: string
}

interface CommentsArgs {
  readonly action: 'comments'
  readonly videoId: string
  readonly maxResults: number
}

type YouTubeArgs =
  | SearchArgs
  | VideoInfoArgs
  | ChannelInfoArgs
  | PlaylistsArgs
  | PlaylistItemsArgs
  | AddToPlaylistArgs
  | RemoveFromPlaylistArgs
  | CommentsArgs

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function getAccessToken(): Promise<string> {
  const token = process.env['GOOGLE_ACCESS_TOKEN']
  if (token) return Promise.resolve(token)
  throw new Error('GOOGLE_ACCESS_TOKEN environment variable is required')
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: GoogleApiClient | undefined

function getClient(): GoogleApiClient {
  if (!client) {
    client = createGoogleApiClient({
      getAccessToken,
      allowedHosts: ALLOWED_HOSTS,
    })
  }
  return client
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateVideoId(id: unknown): string {
  if (typeof id !== 'string' || !VIDEO_ID_REGEX.test(id)) {
    throw new Error('Invalid video ID — must be exactly 11 alphanumeric/dash/underscore characters')
  }
  return id
}

function validateChannelId(id: unknown): string {
  if (typeof id !== 'string' || !CHANNEL_ID_REGEX.test(id)) {
    throw new Error('Invalid channel ID — must start with "UC" followed by 22 characters')
  }
  return id
}

function validatePlaylistId(id: unknown): string {
  if (typeof id !== 'string' || id.trim() === '' || !PLAYLIST_ID_REGEX.test(id)) {
    throw new Error('Invalid playlist ID')
  }
  return id.trim()
}

function clampMaxResults(raw: unknown): number {
  if (raw === undefined) return DEFAULT_MAX_RESULTS
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return DEFAULT_MAX_RESULTS
  }
  return Math.min(raw, MAX_MAX_RESULTS)
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): YouTubeArgs {
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
    return { action: 'search', query: query.trim(), maxResults: clampMaxResults(obj['maxResults']) }
  }

  if (action === 'videoInfo') {
    return { action: 'videoInfo', videoId: validateVideoId(obj['videoId']) }
  }

  if (action === 'channelInfo') {
    return { action: 'channelInfo', channelId: validateChannelId(obj['channelId']) }
  }

  if (action === 'playlists') {
    return { action: 'playlists', maxResults: clampMaxResults(obj['maxResults']) }
  }

  if (action === 'playlistItems') {
    return {
      action: 'playlistItems',
      playlistId: validatePlaylistId(obj['playlistId']),
      maxResults: clampMaxResults(obj['maxResults']),
    }
  }

  if (action === 'addToPlaylist') {
    return {
      action: 'addToPlaylist',
      playlistId: validatePlaylistId(obj['playlistId']),
      videoId: validateVideoId(obj['videoId']),
    }
  }

  if (action === 'removeFromPlaylist') {
    const itemId = obj['itemId']
    if (typeof itemId !== 'string' || itemId.trim() === '') {
      throw new Error('removeFromPlaylist requires a non-empty "itemId" string')
    }
    return { action: 'removeFromPlaylist', itemId: itemId.trim() }
  }

  if (action === 'comments') {
    return {
      action: 'comments',
      videoId: validateVideoId(obj['videoId']),
      maxResults: clampMaxResults(obj['maxResults']),
    }
  }

  throw new Error(
    'action must be "search", "videoInfo", "channelInfo", "playlists", "playlistItems", "addToPlaylist", "removeFromPlaylist", or "comments"',
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

function withQuotaWarning(data: Record<string, unknown>): string {
  const warning = getQuotaWarning()
  if (warning) {
    data['quotaWarning'] = warning
  }
  return JSON.stringify(data)
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeSearch(args: SearchArgs): Promise<AgentToolResult> {
  trackQuota(100)
  const api = getClient()
  const result = await api.get(`${API_BASE}/search`, {
    part: 'snippet',
    q: args.query,
    type: 'video',
    maxResults: String(args.maxResults),
  })

  return textResult(withQuotaWarning({ results: result }))
}

async function executeVideoInfo(args: VideoInfoArgs): Promise<AgentToolResult> {
  trackQuota(1)
  const api = getClient()
  const result = await api.get(`${API_BASE}/videos`, {
    part: 'snippet,statistics,contentDetails',
    id: args.videoId,
  })

  return textResult(withQuotaWarning({ video: result }))
}

async function executeChannelInfo(args: ChannelInfoArgs): Promise<AgentToolResult> {
  trackQuota(1)
  const api = getClient()
  const result = await api.get(`${API_BASE}/channels`, {
    part: 'snippet,statistics',
    id: args.channelId,
  })

  return textResult(withQuotaWarning({ channel: result }))
}

async function executePlaylists(args: PlaylistsArgs): Promise<AgentToolResult> {
  trackQuota(1)
  const api = getClient()
  const result = await api.get(`${API_BASE}/playlists`, {
    part: 'snippet',
    mine: 'true',
    maxResults: String(args.maxResults),
  })

  return textResult(withQuotaWarning({ playlists: result }))
}

async function executePlaylistItems(args: PlaylistItemsArgs): Promise<AgentToolResult> {
  trackQuota(1)
  const api = getClient()
  const result = await api.get(`${API_BASE}/playlistItems`, {
    part: 'snippet',
    playlistId: args.playlistId,
    maxResults: String(args.maxResults),
  })

  return textResult(withQuotaWarning({ items: result }))
}

async function executeAddToPlaylist(args: AddToPlaylistArgs): Promise<AgentToolResult> {
  trackQuota(50)
  const api = getClient()
  const result = await api.post(`${API_BASE}/playlistItems?part=snippet`, {
    snippet: {
      playlistId: args.playlistId,
      resourceId: {
        kind: 'youtube#video',
        videoId: args.videoId,
      },
    },
  })

  return textResult(withQuotaWarning({ added: true, item: result }))
}

async function executeRemoveFromPlaylist(args: RemoveFromPlaylistArgs): Promise<AgentToolResult> {
  trackQuota(50)
  const api = getClient()
  await api.del(`${API_BASE}/playlistItems?id=${encodeURIComponent(args.itemId)}`)

  return textResult(withQuotaWarning({ removed: true, itemId: args.itemId }))
}

async function executeComments(args: CommentsArgs): Promise<AgentToolResult> {
  trackQuota(1)
  const api = getClient()
  const result = await api.get(`${API_BASE}/commentThreads`, {
    part: 'snippet',
    videoId: args.videoId,
    maxResults: String(args.maxResults),
  })

  return textResult(withQuotaWarning({ comments: result }))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform',
      enum: ['search', 'videoInfo', 'channelInfo', 'playlists', 'playlistItems', 'addToPlaylist', 'removeFromPlaylist', 'comments'],
    },
    query: {
      type: 'string',
      description: 'Search query (search)',
    },
    videoId: {
      type: 'string',
      description: 'YouTube video ID, 11 chars (videoInfo, addToPlaylist, comments)',
    },
    channelId: {
      type: 'string',
      description: 'YouTube channel ID starting with UC (channelInfo)',
    },
    playlistId: {
      type: 'string',
      description: 'Playlist ID (playlistItems, addToPlaylist)',
    },
    itemId: {
      type: 'string',
      description: 'Playlist item ID (removeFromPlaylist)',
    },
    maxResults: {
      type: 'integer',
      description: 'Max results to return (default 5, max 20)',
    },
  },
  required: ['action'],
}

export const youtubeTool: ExtendedAgentTool = {
  name: 'youtube',
  description:
    'YouTube Data API. Actions: search(query), videoInfo(videoId), channelInfo(channelId), playlists(), playlistItems(playlistId), addToPlaylist(playlistId, videoId), removeFromPlaylist(itemId), comments(videoId). Quota-tracked.',
  parameters,
  permissions: ['net:http', 'google:youtube'],
  requiresConfirmation: true,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'search':
        return executeSearch(parsed)
      case 'videoInfo':
        return executeVideoInfo(parsed)
      case 'channelInfo':
        return executeChannelInfo(parsed)
      case 'playlists':
        return executePlaylists(parsed)
      case 'playlistItems':
        return executePlaylistItems(parsed)
      case 'addToPlaylist':
        return executeAddToPlaylist(parsed)
      case 'removeFromPlaylist':
        return executeRemoveFromPlaylist(parsed)
      case 'comments':
        return executeComments(parsed)
    }
  },
}

export { parseArgs }

/** Test-only: resets the client instance and quota. */
export function _resetClient(): void {
  client = undefined
}

export function _resetQuota(): void {
  dailyQuotaUsed = 0
  quotaResetDate = ''
}

export function _getQuotaUsed(): number {
  return dailyQuotaUsed
}
