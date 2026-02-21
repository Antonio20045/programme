/**
 * App Launcher tool — open apps, files, and URLs on the desktop.
 * Uses a Factory pattern with Dependency Injection: the actual system
 * calls are injected via an adapter, keeping this package child_process-free.
 *
 * Security:
 * - requiresConfirmation: true (launching apps is a privileged action)
 * - Hardcoded ALLOWED_APPS allowlist (exact match)
 * - openFile: Path validation against allowedDirectories
 * - openUrl: Only https:// (validated via URL constructor)
 * - No eval, no network access
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ── Adapter Interface ────────────────────────────────────────

export interface AppLauncherAdapter {
  readonly openApp: (appName: string) => Promise<void>
  readonly openFile: (filePath: string) => Promise<void>
  readonly openUrl: (url: string) => Promise<void>
  readonly getRunning: () => Promise<readonly { readonly name: string; readonly pid: number }[]>
  readonly focusApp: (appName: string) => Promise<void>
}

// ── Configuration ────────────────────────────────────────────

export interface AppLauncherConfig {
  readonly allowedDirectories: readonly string[]
}

// ── Constants ────────────────────────────────────────────────

export const ALLOWED_APPS: ReadonlySet<string> = new Set([
  'Safari',
  'Finder',
  'Terminal',
  'Visual Studio Code',
  'Music',
  'Spotify',
  'Calendar',
  'Notes',
  'Reminders',
  'Preview',
  'TextEdit',
  'Calculator',
  'System Preferences',
  'System Settings',
  'Activity Monitor',
  'Mail',
  'Messages',
  'Maps',
  'Photos',
  'Contacts',
])

// ── Path Validation (from pdf-tools.ts) ──────────────────────

function assertNoNullBytes(p: string): void {
  if (p.includes('\0')) {
    throw new Error('Path contains null bytes')
  }
}

function isWithinAllowed(resolved: string, dirs: readonly string[]): boolean {
  return dirs.some(
    (dir) => resolved === dir || resolved.startsWith(dir + path.sep),
  )
}

async function resolveReal(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const parent = path.dirname(target)
    if (parent === target) return target
    const resolvedParent = await resolveReal(parent)
    return path.join(resolvedParent, path.basename(target))
  }
}

async function validatePath(
  inputPath: string,
  allowedDirs: readonly string[],
): Promise<string> {
  assertNoNullBytes(inputPath)

  const resolved = path.resolve(inputPath)
  const real = await resolveReal(resolved)
  const realAllowedDirs = await Promise.all(allowedDirs.map(resolveReal))

  if (!isWithinAllowed(real, realAllowedDirs)) {
    throw new Error('Access denied: path is outside allowed directories')
  }

  return real
}

// ── Argument Parsing ─────────────────────────────────────────

interface OpenArgs {
  readonly action: 'open'
  readonly appName: string
}

interface OpenFileArgs {
  readonly action: 'openFile'
  readonly filePath: string
}

interface OpenUrlArgs {
  readonly action: 'openUrl'
  readonly url: string
}

interface RunningArgs {
  readonly action: 'running'
}

interface FocusArgs {
  readonly action: 'focus'
  readonly appName: string
}

type AppLauncherArgs = OpenArgs | OpenFileArgs | OpenUrlArgs | RunningArgs | FocusArgs

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'open',
  'openFile',
  'openUrl',
  'running',
  'focus',
])

function parseArgs(args: unknown): AppLauncherArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new Error(`Invalid action: ${String(action)}`)
  }

  switch (action) {
    case 'open': {
      const appName = obj['appName']
      if (typeof appName !== 'string' || appName.trim() === '') {
        throw new Error('open requires a non-empty "appName" string')
      }
      return { action: 'open', appName: appName.trim() }
    }

    case 'openFile': {
      const filePath = obj['filePath']
      if (typeof filePath !== 'string' || filePath.trim() === '') {
        throw new Error('openFile requires a non-empty "filePath" string')
      }
      return { action: 'openFile', filePath: filePath.trim() }
    }

    case 'openUrl': {
      const url = obj['url']
      if (typeof url !== 'string' || url.trim() === '') {
        throw new Error('openUrl requires a non-empty "url" string')
      }
      return { action: 'openUrl', url: url.trim() }
    }

    case 'running':
      return { action: 'running' }

    case 'focus': {
      const appName = obj['appName']
      if (typeof appName !== 'string' || appName.trim() === '') {
        throw new Error('focus requires a non-empty "appName" string')
      }
      return { action: 'focus', appName: appName.trim() }
    }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

function validateAppName(appName: string): void {
  if (!ALLOWED_APPS.has(appName)) {
    throw new Error(`App not in allowlist: "${appName}". Allowed: ${[...ALLOWED_APPS].join(', ')}`)
  }
}

function validateUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https:// URLs are allowed')
  }
}

// ── Tool Definition ──────────────────────────────────────────

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "open" app, "openFile", "openUrl", "running" list, or "focus" app',
      enum: ['open', 'openFile', 'openUrl', 'running', 'focus'],
    },
    appName: {
      type: 'string',
      description: 'Application name from allowlist (for "open" and "focus")',
    },
    filePath: {
      type: 'string',
      description: 'Absolute file path to open (for "openFile")',
    },
    url: {
      type: 'string',
      description: 'HTTPS URL to open (for "openUrl")',
    },
  },
  required: ['action'],
}

// ── Factory ──────────────────────────────────────────────────

export function createAppLauncherTool(config: AppLauncherConfig, adapter: AppLauncherAdapter): ExtendedAgentTool {
  const allowedDirs: readonly string[] = config.allowedDirectories.map((d) =>
    path.resolve(d),
  )

  return {
    name: 'app-launcher',
    description:
      'Launch and manage desktop applications. Actions: open(appName) launches an allowed app; ' +
      'openFile(filePath) opens a file with its default app; openUrl(url) opens an HTTPS URL; ' +
      'running() lists running processes; focus(appName) brings an allowed app to front. ' +
      'Requires user confirmation.',
    parameters: PARAMETERS,
    permissions: ['app:launch'],
    requiresConfirmation: true,
    runsOn: 'desktop',

    execute: async (args: unknown): Promise<AgentToolResult> => {
      const parsed = parseArgs(args)

      switch (parsed.action) {
        case 'open': {
          validateAppName(parsed.appName)
          await adapter.openApp(parsed.appName)
          return textResult(JSON.stringify({ opened: parsed.appName }))
        }

        case 'openFile': {
          const safePath = await validatePath(parsed.filePath, allowedDirs)
          await adapter.openFile(safePath)
          return textResult(JSON.stringify({ openedFile: safePath }))
        }

        case 'openUrl': {
          validateUrl(parsed.url)
          await adapter.openUrl(parsed.url)
          return textResult(JSON.stringify({ openedUrl: parsed.url }))
        }

        case 'running': {
          const processes = await adapter.getRunning()
          return textResult(JSON.stringify({ processes }))
        }

        case 'focus': {
          validateAppName(parsed.appName)
          await adapter.focusApp(parsed.appName)
          return textResult(JSON.stringify({ focused: parsed.appName }))
        }
      }
    },
  }
}

export { parseArgs }
