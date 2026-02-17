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

import { getTool } from '@ki-assistent/tools'

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
    private readonly token: string,
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
      // Authenticate immediately
      ws.send(JSON.stringify({ type: 'auth', token: this.token }))
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
