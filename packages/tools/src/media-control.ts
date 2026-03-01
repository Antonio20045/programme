/**
 * Media Control tool — play/pause, skip, volume, and now-playing info.
 * Uses a Factory pattern with Dependency Injection: the actual system
 * media controls are injected via an adapter (osascript on macOS).
 *
 * Security:
 * - requiresConfirmation: false (non-destructive media operations)
 * - Volume clamped to 0-100
 * - No eval, no network access, no file system access
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Adapter Interface ────────────────────────────────────────

export interface NowPlayingInfo {
  readonly title?: string
  readonly artist?: string
  readonly app?: string
}

export interface MediaAdapter {
  readonly playPause: () => Promise<void>
  readonly next: () => Promise<void>
  readonly previous: () => Promise<void>
  readonly setVolume: (level: number) => Promise<void>
  readonly getVolume: () => Promise<number>
  readonly mute: () => Promise<void>
  readonly getNowPlaying: () => Promise<NowPlayingInfo | null>
}

// ── Constants ────────────────────────────────────────────────

export const VOLUME_MIN = 0
export const VOLUME_MAX = 100

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'playPause',
  'next',
  'previous',
  'volume',
  'mute',
  'nowPlaying',
])

// ── Argument Parsing ─────────────────────────────────────────

interface PlayPauseArgs {
  readonly action: 'playPause'
}

interface NextArgs {
  readonly action: 'next'
}

interface PreviousArgs {
  readonly action: 'previous'
}

interface VolumeArgs {
  readonly action: 'volume'
  readonly level: number
}

interface MuteArgs {
  readonly action: 'mute'
}

interface NowPlayingArgs {
  readonly action: 'nowPlaying'
}

type MediaControlArgs = PlayPauseArgs | NextArgs | PreviousArgs | VolumeArgs | MuteArgs | NowPlayingArgs

function parseArgs(args: unknown): MediaControlArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  switch (action) {
    case 'playPause':
      return { action: 'playPause' }

    case 'next':
      return { action: 'next' }

    case 'previous':
      return { action: 'previous' }

    case 'volume': {
      const level = obj['level']
      if (typeof level !== 'number' || !Number.isFinite(level)) {
        throw new Error('volume requires a numeric "level"')
      }
      return {
        action: 'volume',
        level: Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, Math.round(level))),
      }
    }

    case 'mute':
      return { action: 'mute' }

    case 'nowPlaying':
      return { action: 'nowPlaying' }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ── Tool Definition ──────────────────────────────────────────

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Media action: "playPause", "next", "previous", "volume", "mute", or "nowPlaying"',
      enum: ['playPause', 'next', 'previous', 'volume', 'mute', 'nowPlaying'],
    },
    level: {
      type: 'integer',
      description: 'Volume level 0-100 (for "volume" action)',
    },
  },
  required: ['action'],
}

// ── Factory ──────────────────────────────────────────────────

export function createMediaControlTool(adapter: MediaAdapter): ExtendedAgentTool {
  return {
    name: 'media-control',
    description:
      'Control media playback and system volume. Actions: playPause() toggles playback; ' +
      'next() skips to next track; previous() goes to previous track; volume(level) sets ' +
      'volume 0-100; mute() mutes audio; nowPlaying() returns current track info.',
    parameters: PARAMETERS,
    permissions: ['media:control'],
    requiresConfirmation: false,
    defaultRiskTier: 2,
    riskTiers: { nowPlaying: 1, playPause: 2, next: 2, previous: 2, volume: 2, mute: 2 },
    runsOn: 'desktop',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'playPause': {
          await adapter.playPause()
          return textResult(JSON.stringify({ action: 'playPause', success: true }))
        }

        case 'next': {
          await adapter.next()
          return textResult(JSON.stringify({ action: 'next', success: true }))
        }

        case 'previous': {
          await adapter.previous()
          return textResult(JSON.stringify({ action: 'previous', success: true }))
        }

        case 'volume': {
          await adapter.setVolume(parsed.level)
          return textResult(JSON.stringify({ action: 'volume', level: parsed.level }))
        }

        case 'mute': {
          await adapter.mute()
          return textResult(JSON.stringify({ action: 'mute', success: true }))
        }

        case 'nowPlaying': {
          const info = await adapter.getNowPlaying()
          return textResult(JSON.stringify({ nowPlaying: info }))
        }
      }
    },
  }
}

export { parseArgs }
