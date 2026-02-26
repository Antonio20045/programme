/**
 * Desktop Agent — WebSocket client that connects to the Gateway's
 * DesktopAgentBridge and executes local tools (filesystem, shell, browser).
 *
 * Uses the native WebSocket API (available in Electron 35+ / Node 22+).
 *
 * Features:
 * - Shared-secret authentication
 * - Automatic reconnect with exponential backoff
 * - Heartbeat (pong responses)
 * - Tool execution via the tools registry
 */

import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getTool } from '@ki-assistent/tools'
import { initTools } from '@ki-assistent/tools/register'
import type { ClipboardAdapter } from '@ki-assistent/tools/clipboard'
import type { ScreenshotAdapter, ScreenshotResult } from '@ki-assistent/tools/screenshot'
import type { GitAdapter, StatusResult, LogEntry, BranchResult, CommitResult, BlameResult } from '@ki-assistent/tools/git-tools'
import type { AppLauncherAdapter } from '@ki-assistent/tools/app-launcher'
import { ALLOWED_APPS } from '@ki-assistent/tools/app-launcher'
import type { MediaAdapter, NowPlayingInfo } from '@ki-assistent/tools/media-control'

const execFileAsync = promisify(nodeExecFile)

// ─── Electron Adapters ──────────────────────────────────────

function createElectronClipboardAdapter(): ClipboardAdapter {
  return {
    readText: async () => {
      const { clipboard } = await import('electron')
      return clipboard.readText()
    },
    writeText: async (text: string) => {
      const { clipboard } = await import('electron')
      clipboard.writeText(text)
    },
  }
}

function createElectronScreenshotAdapter(): ScreenshotAdapter {
  return {
    captureScreen: async (): Promise<ScreenshotResult> => {
      const { desktopCapturer } = await import('electron')
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 99999 },
      })
      const source = sources[0]
      if (!source) {
        throw new Error('No screen source found')
      }
      const thumbnail = source.thumbnail
      const size = thumbnail.getSize()
      return {
        data: thumbnail.toPNG().toString('base64'),
        mimeType: 'image/png',
        width: size.width,
        height: size.height,
      }
    },
    captureWindow: async (windowTitle?: string): Promise<ScreenshotResult> => {
      const { desktopCapturer } = await import('electron')
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 99999 },
      })
      let source = sources[0]
      if (windowTitle) {
        source = sources.find((s) => s.name.includes(windowTitle))
        if (!source) {
          throw new Error(`No window found matching "${windowTitle}"`)
        }
      }
      if (!source) {
        throw new Error('No window source found')
      }
      const thumbnail = source.thumbnail
      const size = thumbnail.getSize()
      return {
        data: thumbnail.toPNG().toString('base64'),
        mimeType: 'image/png',
        width: size.width,
        height: size.height,
      }
    },
  }
}

// ─── Git Adapter ─────────────────────────────────────────────

function createGitAdapter(): GitAdapter {
  async function runGit(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync('/usr/bin/git', [...args], {
      cwd,
      timeout: 30_000,
      maxBuffer: 1_000_000,
    })
    return stdout
  }

  return {
    status: async (repoPath: string): Promise<StatusResult> => {
      const output = await runGit(repoPath, ['status', '--porcelain=v1', '-b'])
      const lines = output.split('\n').filter((l) => l.length > 0)
      let branch = 'unknown'
      const files: { path: string; status: string }[] = []

      for (const line of lines) {
        if (line.startsWith('##')) {
          const match = line.match(/^## (\S+)/)
          if (match?.[1]) {
            branch = match[1].split('...')[0] ?? 'unknown'
          }
        } else if (line.length >= 4) {
          const status = line.slice(0, 2).trim()
          const filePath = line.slice(3)
          files.push({ path: filePath, status })
        }
      }

      return { branch, files }
    },

    log: async (repoPath: string, count: number): Promise<readonly LogEntry[]> => {
      const output = await runGit(repoPath, [
        'log',
        `--format=%H|%h|%an|%ai|%s`,
        `-${String(count)}`,
      ])
      const lines = output.split('\n').filter((l) => l.length > 0)
      return lines.map((line) => {
        const parts = line.split('|')
        return {
          hash: parts[0] ?? '',
          shortHash: parts[1] ?? '',
          author: parts[2] ?? '',
          date: parts[3] ?? '',
          message: parts.slice(4).join('|'),
        }
      })
    },

    diff: async (repoPath: string, ref?: string, ref2?: string): Promise<string> => {
      const args = ['diff']
      if (ref) args.push(ref)
      if (ref2) args.push(ref2)
      return runGit(repoPath, args)
    },

    branch: async (repoPath: string): Promise<BranchResult> => {
      const branchOutput = await runGit(repoPath, ['branch', '--format=%(refname:short)'])
      const branches = branchOutput.split('\n').filter((l) => l.length > 0)
      const currentOutput = await runGit(repoPath, ['branch', '--show-current'])
      const current = currentOutput.trim()
      return { current, branches }
    },

    commit: async (repoPath: string, message: string, files: readonly string[]): Promise<CommitResult> => {
      await runGit(repoPath, ['add', '--', ...files])
      await runGit(repoPath, ['commit', '-m', message])
      const hashOutput = await runGit(repoPath, ['rev-parse', 'HEAD'])
      return {
        hash: hashOutput.trim(),
        message,
        filesCommitted: [...files],
      }
    },

    blame: async (repoPath: string, filePath: string): Promise<BlameResult> => {
      const output = await runGit(repoPath, ['blame', '--line-porcelain', '--', filePath])
      const chunks = output.split('\n')
      const lines: { hash: string; author: string; lineNumber: number; content: string }[] = []
      let currentHash = ''
      let currentAuthor = ''
      let currentLineNumber = 0

      for (const chunk of chunks) {
        // Lines starting with a 40-char hash
        const hashMatch = chunk.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
        if (hashMatch) {
          currentHash = hashMatch[1] ?? ''
          currentLineNumber = parseInt(hashMatch[2] ?? '0', 10)
          continue
        }
        if (chunk.startsWith('author ')) {
          currentAuthor = chunk.slice(7)
          continue
        }
        if (chunk.startsWith('\t')) {
          lines.push({
            hash: currentHash.slice(0, 8),
            author: currentAuthor,
            lineNumber: currentLineNumber,
            content: chunk.slice(1),
          })
        }
      }

      return { lines }
    },
  }
}

// ─── App Launcher Adapter ────────────────────────────────────

function createAppLauncherAdapter(): AppLauncherAdapter {
  return {
    openApp: async (appName: string): Promise<void> => {
      await execFileAsync('/usr/bin/open', ['-a', appName], { timeout: 10_000 })
    },

    openFile: async (filePath: string): Promise<void> => {
      await execFileAsync('/usr/bin/open', [filePath], { timeout: 10_000 })
    },

    openUrl: async (url: string): Promise<void> => {
      await execFileAsync('/usr/bin/open', [url], { timeout: 10_000 })
    },

    getRunning: async (): Promise<readonly { name: string; pid: number }[]> => {
      const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid,comm', '-r'], {
        timeout: 10_000,
      })
      const lines = stdout.split('\n').slice(1) // skip header
      const result: { name: string; pid: number }[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        const spaceIdx = trimmed.indexOf(' ')
        if (spaceIdx === -1) continue
        const pidStr = trimmed.slice(0, spaceIdx)
        const pid = parseInt(pidStr, 10)
        if (Number.isNaN(pid)) continue
        const comm = trimmed.slice(spaceIdx + 1).trim()
        // Extract app name from path
        const name = comm.includes('/') ? comm.split('/').pop() ?? comm : comm
        result.push({ name, pid })
      }
      return result
    },

    focusApp: async (appName: string): Promise<void> => {
      // Only allow names from ALLOWED_APPS in osascript
      if (!ALLOWED_APPS.has(appName)) {
        throw new Error(`App not in allowlist: ${appName}`)
      }
      await execFileAsync('/usr/bin/osascript', [
        '-e',
        `tell application "${appName}" to activate`,
      ], { timeout: 10_000 })
    },
  }
}

// ─── Media Control Adapter ───────────────────────────────────

function createMediaControlAdapter(): MediaAdapter {
  async function runOsascript(script: string): Promise<string> {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
      timeout: 5_000,
    })
    return stdout.trim()
  }

  return {
    playPause: async (): Promise<void> => {
      await runOsascript(
        'tell application "System Events" to key code 16 using {command down}',
      )
    },

    next: async (): Promise<void> => {
      await runOsascript(
        'tell application "System Events" to key code 17 using {command down}',
      )
    },

    previous: async (): Promise<void> => {
      await runOsascript(
        'tell application "System Events" to key code 18 using {command down}',
      )
    },

    setVolume: async (level: number): Promise<void> => {
      const clamped = Math.max(0, Math.min(100, Math.round(level)))
      await runOsascript(`set volume output volume ${String(clamped)}`)
    },

    getVolume: async (): Promise<number> => {
      const result = await runOsascript('output volume of (get volume settings)')
      return parseInt(result, 10)
    },

    mute: async (): Promise<void> => {
      await runOsascript('set volume output muted true')
    },

    getNowPlaying: async (): Promise<NowPlayingInfo | null> => {
      try {
        const result = await runOsascript(
          'tell application "Music"\n' +
          '  if player state is playing then\n' +
          '    set trackName to name of current track\n' +
          '    set trackArtist to artist of current track\n' +
          '    return trackName & "|" & trackArtist\n' +
          '  else\n' +
          '    return ""\n' +
          '  end if\n' +
          'end tell',
        )
        if (result === '') return null
        const parts = result.split('|')
        return {
          title: parts[0],
          artist: parts[1],
          app: 'Music',
        }
      } catch {
        return null
      }
    },
  }
}

// ─── Tool Initialization ────────────────────────────────────

initTools(
  {
    clipboard: createElectronClipboardAdapter(),
    screenshot: createElectronScreenshotAdapter(),
    git: createGitAdapter(),
    appLauncher: createAppLauncherAdapter(),
    mediaControl: createMediaControlAdapter(),
  },
  {
    allowedDirectories: [process.env['HOME'] ?? '/Users'],
  },
)

// ─── Constants ───────────────────────────────────────────────

const INITIAL_RECONNECT_DELAY = 3_000   // 3s
const MAX_RECONNECT_DELAY = 60_000      // 60s
const RECONNECT_MULTIPLIER = 2
const STABLE_AFTER_MS = 30_000          // Reset backoff after 30s stable

// ─── Protocol Types ──────────────────────────────────────────

interface ToolRequest {
  readonly type: 'tool_request'
  readonly requestId: string
  readonly toolName: string
  readonly params: Record<string, unknown>
}

interface PingMessage {
  readonly type: 'ping'
}

type ServerMessage = ToolRequest | PingMessage

// ─── Auth Token Types ───────────────────────────────────────

export type TokenResult =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'clerk'; readonly value: string }

export type GetTokenFn = () => TokenResult

// ─── DesktopAgent ────────────────────────────────────────────

export class DesktopAgent {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private shouldReconnect = true
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private _status: 'connected' | 'disconnected' = 'disconnected'

  onConnect: (() => void) | null = null
  onDisconnect: (() => void) | null = null
  onError: ((error: string) => void) | null = null

  constructor(
    private readonly serverUrl: string,
    private readonly getToken: GetTokenFn,
  ) {}

  connect(): void {
    this.shouldReconnect = true
    this.doConnect()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.clearReconnectTimer()
    this.clearStableTimer()

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  getStatus(): 'connected' | 'disconnected' {
    return this._status
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    const ws = new WebSocket(this.serverUrl)

    ws.addEventListener('open', () => {
      // Authenticate immediately — fetch current token on every connect/reconnect
      const token = this.getToken()
      const authMsg = token.kind === 'clerk'
        ? { type: 'auth', clerkToken: token.value }
        : { type: 'auth', token: token.value }
      ws.send(JSON.stringify(authMsg))
      this.setStatus('connected')
      this.reconnectDelay = INITIAL_RECONNECT_DELAY
      this.startStableTimer()
      this.onConnect?.()
    })

    ws.addEventListener('message', (event) => {
      this.handleMessage(String(event.data))
    })

    ws.addEventListener('close', () => {
      this.ws = null
      this.setStatus('disconnected')
      this.clearStableTimer()
      this.onDisconnect?.()
      this.scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      this.onError?.('WebSocket error')
      // 'close' event follows 'error', so reconnect is handled there
    })

    this.ws = ws
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      return
    }

    switch (msg.type) {
      case 'ping':
        this.ws?.send(JSON.stringify({ type: 'pong' }))
        break
      case 'tool_request':
        void this.executeToolRequest(msg)
        break
      default:
        break
    }
  }

  private async executeToolRequest(request: ToolRequest): Promise<void> {
    const tool = getTool(request.toolName)

    if (!tool) {
      this.ws?.send(JSON.stringify({
        type: 'tool_error',
        requestId: request.requestId,
        error: `Unknown tool: ${request.toolName}`,
      }))
      return
    }

    // Security: Tools that require confirmation must not auto-execute in server mode
    // without user approval. Send a confirmation request back to the server.
    if (tool.requiresConfirmation) {
      this.ws?.send(JSON.stringify({
        type: 'tool_confirmation_required',
        requestId: request.requestId,
        toolName: request.toolName,
        params: request.params,
      }))
      return
    }

    try {
      const result = await tool.execute(request.params)
      this.ws?.send(JSON.stringify({
        type: 'tool_result',
        requestId: request.requestId,
        result,
      }))
    } catch (err) {
      this.ws?.send(JSON.stringify({
        type: 'tool_error',
        requestId: request.requestId,
        error: err instanceof Error ? err.message : 'Tool execution failed',
      }))
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    this.clearReconnectTimer()

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect()
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      MAX_RECONNECT_DELAY,
    )
  }

  private startStableTimer(): void {
    this.clearStableTimer()
    this.stableTimer = setTimeout(() => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY
    }, STABLE_AFTER_MS)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }

  private setStatus(status: 'connected' | 'disconnected'): void {
    this._status = status
  }
}
