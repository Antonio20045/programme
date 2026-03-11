/**
 * Desktop Control tool — click, type, keystroke, scroll, and cursor position.
 * Uses a Factory pattern with Dependency Injection: the actual system
 * automation is injected via an adapter (CoreGraphics/System Events on macOS).
 *
 * Security:
 * - requiresConfirmation: true (UI automation = write operations)
 * - Text input max 10,000 chars, no null bytes
 * - Keystroke key+modifier allowlist
 * - Coordinates must be >= 0
 * - No eval, no network access, no file system access
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Adapter Interface ────────────────────────────────────────

export interface DesktopControlAdapter {
  readonly click: (x: number, y: number) => Promise<void>
  readonly doubleClick: (x: number, y: number) => Promise<void>
  readonly rightClick: (x: number, y: number) => Promise<void>
  readonly type: (text: string) => Promise<void>
  readonly keystroke: (key: string, modifiers?: readonly string[]) => Promise<void>
  readonly scroll: (direction: 'up' | 'down' | 'left' | 'right', amount: number) => Promise<void>
  readonly getCursorPosition: () => Promise<{ x: number; y: number }>
}

// ── Constants ────────────────────────────────────────────────

export const TEXT_MAX_LENGTH = 10_000

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'click',
  'doubleClick',
  'rightClick',
  'type',
  'keystroke',
  'scroll',
  'getCursorPosition',
])

const SCROLL_DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right'])

export const ALLOWED_MODIFIERS: ReadonlySet<string> = new Set([
  'command',
  'shift',
  'option',
  'control',
])

/** macOS virtual key codes for special keys. */
export const KEY_CODES: Readonly<Record<string, number>> = {
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  escape: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
}

/** Keys allowed in keystroke action (special keys + a-z + 0-9). */
export const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(KEY_CODES),
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
])

// ── Argument Parsing ─────────────────────────────────────────

interface ClickArgs {
  readonly action: 'click'
  readonly x: number
  readonly y: number
}

interface DoubleClickArgs {
  readonly action: 'doubleClick'
  readonly x: number
  readonly y: number
}

interface RightClickArgs {
  readonly action: 'rightClick'
  readonly x: number
  readonly y: number
}

interface TypeArgs {
  readonly action: 'type'
  readonly text: string
}

interface KeystrokeArgs {
  readonly action: 'keystroke'
  readonly key: string
  readonly modifiers?: readonly string[]
}

interface ScrollArgs {
  readonly action: 'scroll'
  readonly direction: 'up' | 'down' | 'left' | 'right'
  readonly amount: number
}

interface GetCursorPositionArgs {
  readonly action: 'getCursorPosition'
}

type DesktopControlArgs =
  | ClickArgs
  | DoubleClickArgs
  | RightClickArgs
  | TypeArgs
  | KeystrokeArgs
  | ScrollArgs
  | GetCursorPositionArgs

function parseCoordinates(obj: Record<string, unknown>): { x: number; y: number } {
  const x = obj['x']
  const y = obj['y']
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) {
    throw new Error('x must be a non-negative finite number')
  }
  if (typeof y !== 'number' || !Number.isFinite(y) || y < 0) {
    throw new Error('y must be a non-negative finite number')
  }
  return { x: Math.round(x), y: Math.round(y) }
}

export function parseArgs(args: unknown): DesktopControlArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  switch (action) {
    case 'click': {
      const { x, y } = parseCoordinates(obj)
      return { action: 'click', x, y }
    }

    case 'doubleClick': {
      const { x, y } = parseCoordinates(obj)
      return { action: 'doubleClick', x, y }
    }

    case 'rightClick': {
      const { x, y } = parseCoordinates(obj)
      return { action: 'rightClick', x, y }
    }

    case 'type': {
      const text = obj['text']
      if (typeof text !== 'string') {
        throw new Error('type requires a string "text"')
      }
      if (text.length === 0) {
        throw new Error('text must not be empty')
      }
      if (text.length > TEXT_MAX_LENGTH) {
        throw new Error(`text exceeds maximum length of ${String(TEXT_MAX_LENGTH)} characters`)
      }
      if (text.includes('\0')) {
        throw new Error('text must not contain null bytes')
      }
      return { action: 'type', text }
    }

    case 'keystroke': {
      const key = obj['key']
      if (typeof key !== 'string') {
        throw new Error('keystroke requires a string "key"')
      }
      const normalizedKey = key.toLowerCase()
      if (!ALLOWED_KEYS.has(normalizedKey)) {
        throw new Error(`Key not allowed: ${key}`)
      }

      const rawModifiers = obj['modifiers']
      let modifiers: readonly string[] | undefined
      if (rawModifiers !== undefined && rawModifiers !== null) {
        if (!Array.isArray(rawModifiers)) {
          throw new Error('modifiers must be an array')
        }
        for (const mod of rawModifiers) {
          if (typeof mod !== 'string' || !ALLOWED_MODIFIERS.has(mod.toLowerCase())) {
            throw new Error(`Modifier not allowed: ${String(mod)}`)
          }
        }
        modifiers = (rawModifiers as string[]).map((m) => m.toLowerCase())
      }

      return { action: 'keystroke', key: normalizedKey, modifiers }
    }

    case 'scroll': {
      const direction = obj['direction']
      if (typeof direction !== 'string' || !SCROLL_DIRECTIONS.has(direction)) {
        throw new Error(`Invalid scroll direction: ${String(direction)}`)
      }
      const amount = obj['amount']
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('scroll requires a positive numeric "amount"')
      }
      return {
        action: 'scroll',
        direction: direction as 'up' | 'down' | 'left' | 'right',
        amount: Math.round(amount),
      }
    }

    case 'getCursorPosition':
      return { action: 'getCursorPosition' }

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
      description:
        'Desktop control action: "click", "doubleClick", "rightClick", "type", "keystroke", "scroll", or "getCursorPosition"',
      enum: ['click', 'doubleClick', 'rightClick', 'type', 'keystroke', 'scroll', 'getCursorPosition'],
    },
    x: {
      type: 'number',
      description: 'X coordinate (for click/doubleClick/rightClick)',
    },
    y: {
      type: 'number',
      description: 'Y coordinate (for click/doubleClick/rightClick)',
    },
    text: {
      type: 'string',
      description: 'Text to type (for "type" action, max 10000 chars)',
    },
    key: {
      type: 'string',
      description: 'Key name for keystroke (e.g. "return", "tab", "a", "f1")',
    },
    modifiers: {
      type: 'array',
      description: 'Modifier keys (e.g. ["command", "shift"])',
      items: {
        type: 'string',
        enum: ['command', 'shift', 'option', 'control'],
      },
    },
    direction: {
      type: 'string',
      description: 'Scroll direction',
      enum: ['up', 'down', 'left', 'right'],
    },
    amount: {
      type: 'integer',
      description: 'Scroll amount in lines (for "scroll" action)',
    },
  },
  required: ['action'],
}

// ── Factory ──────────────────────────────────────────────────

export function createDesktopControlTool(adapter: DesktopControlAdapter): ExtendedAgentTool {
  return {
    name: 'desktop-control',
    description:
      'Control any open app like a user — click buttons, type text, press keyboard shortcuts, scroll. ' +
      'Actions: click(x,y) left-click; doubleClick(x,y); rightClick(x,y); type(text) types into focused app; ' +
      'keystroke(key,modifiers) presses keys like Cmd+N, Return, Tab; scroll(direction,amount); getCursorPosition().',
    parameters: PARAMETERS,
    permissions: ['desktop:control'],
    requiresConfirmation: true,
    defaultRiskTier: 2,
    riskTiers: {
      click: 2,
      doubleClick: 2,
      rightClick: 2,
      type: 2,
      keystroke: 2,
      scroll: 1,
      getCursorPosition: 0,
    },
    runsOn: 'desktop',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'click': {
          await adapter.click(parsed.x, parsed.y)
          return textResult(JSON.stringify({ action: 'click', x: parsed.x, y: parsed.y, success: true }))
        }

        case 'doubleClick': {
          await adapter.doubleClick(parsed.x, parsed.y)
          return textResult(JSON.stringify({ action: 'doubleClick', x: parsed.x, y: parsed.y, success: true }))
        }

        case 'rightClick': {
          await adapter.rightClick(parsed.x, parsed.y)
          return textResult(JSON.stringify({ action: 'rightClick', x: parsed.x, y: parsed.y, success: true }))
        }

        case 'type': {
          await adapter.type(parsed.text)
          return textResult(JSON.stringify({ action: 'type', length: parsed.text.length, success: true }))
        }

        case 'keystroke': {
          await adapter.keystroke(parsed.key, parsed.modifiers)
          return textResult(JSON.stringify({
            action: 'keystroke',
            key: parsed.key,
            modifiers: parsed.modifiers ?? [],
            success: true,
          }))
        }

        case 'scroll': {
          await adapter.scroll(parsed.direction, parsed.amount)
          return textResult(JSON.stringify({
            action: 'scroll',
            direction: parsed.direction,
            amount: parsed.amount,
            success: true,
          }))
        }

        case 'getCursorPosition': {
          const pos = await adapter.getCursorPosition()
          return textResult(JSON.stringify({ action: 'getCursorPosition', x: pos.x, y: pos.y }))
        }
      }
    },
  }
}
