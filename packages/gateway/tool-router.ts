/**
 * Tool Router — Confirmation interception + Desktop Agent routing.
 *
 * Third additive file for the OpenClaw fork (alongside config.ts and channels/in-app.ts).
 * Does NOT modify any existing OpenClaw files.
 *
 * - Wraps tool execution with a confirmation step for tools that have
 *   requiresConfirmation: true.
 * - Routes tools with runsOn: 'desktop' to a connected Desktop Agent via WebSocket.
 * - Server tools (runsOn: 'server') execute directly in the gateway process.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import { transformError } from './src/persona/error-transformer.js'

// ─── Types ───────────────────────────────────────────────────
// Inlined from @ki-assistent/tools to avoid cross-package dependency.

interface TextContent {
  readonly type: 'text'
  readonly text: string
}

interface ImageContent {
  readonly type: 'image'
  readonly data: string
  readonly mimeType: string
}

interface AgentToolResult {
  readonly content: readonly (TextContent | ImageContent)[]
}

interface JSONSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  readonly description?: string
  readonly enum?: readonly string[]
  readonly items?: JSONSchemaProperty
  readonly properties?: Readonly<Record<string, JSONSchemaProperty>>
  readonly required?: readonly string[]
}

interface JSONSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, JSONSchemaProperty>>
  readonly required?: readonly string[]
}

export interface ConfirmableOpenClawTool {
  readonly name: string
  readonly description: string
  readonly parameters: JSONSchema
  readonly requiresConfirmation: boolean
  readonly runsOn: 'server' | 'desktop'
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult>
}

export interface ConfirmationDecision {
  readonly decision: 'execute' | 'reject'
  readonly modifiedParams?: Record<string, unknown>
}

interface PendingConfirmation {
  readonly resolve: (decision: ConfirmationDecision) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export interface SSEEvent {
  readonly type: string
  readonly data: unknown
}

type EmitFn = (sessionId: string, event: SSEEvent) => void

// ─── WS Agent Protocol ──────────────────────────────────────

/** Server → Agent */
export interface AgentToolRequest {
  readonly type: 'tool_request'
  readonly requestId: string
  readonly toolName: string
  readonly params: Record<string, unknown>
}

export interface PingMessage {
  readonly type: 'ping'
}

/** Agent → Server */
export interface AgentToolResponse {
  readonly type: 'tool_result'
  readonly requestId: string
  readonly result: AgentToolResult
}

export interface AgentToolError {
  readonly type: 'tool_error'
  readonly requestId: string
  readonly error: string
}

export interface PongMessage {
  readonly type: 'pong'
}

export interface AuthMessage {
  readonly type: 'auth'
  readonly token: string
}

export type AgentMessage = AgentToolResponse | AgentToolError | PongMessage | AuthMessage

// ─── Constants ───────────────────────────────────────────────

const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
export const AGENT_WS_PORT_OFFSET = 1          // Port = Gateway-Port + 1
export const TOOL_TIMEOUT_MS = 60_000          // 60s für Tool-Execution
export const HEARTBEAT_INTERVAL_MS = 30_000    // 30s Ping
export const MAX_MISSED_PONGS = 2              // 2 missed → disconnect
const AUTH_TIMEOUT_MS = 5_000                  // 5s for auth message
const AGENT_TOKEN_DIR = path.join(os.homedir(), '.openclaw')
const AGENT_TOKEN_FILE = path.join(AGENT_TOKEN_DIR, 'agent-token')

// ─── ConfirmationManager ─────────────────────────────────────

export class ConfirmationManager {
  private readonly pending = new Map<string, PendingConfirmation>()
  private activeSessionId: string | null = null
  private emitFn: EmitFn | null = null

  setEmitter(fn: EmitFn): void {
    this.emitFn = fn
  }

  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId
  }

  clearActiveSession(): void {
    this.activeSessionId = null
  }

  /**
   * Request user confirmation for a tool call.
   * Sends an SSE event and waits for the user to confirm or reject.
   * Auto-rejects after 5 minutes.
   */
  async requestConfirmation(
    toolCallId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<ConfirmationDecision> {
    const sessionId = this.activeSessionId
    if (sessionId === null || this.emitFn === null) {
      // No session context or emitter — skip confirmation
      return { decision: 'execute' }
    }

    // Emit tool_confirm SSE event to the client
    this.emitFn(sessionId, {
      type: 'tool_confirm',
      data: { toolCallId, toolName, params },
    })

    return new Promise<ConfirmationDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(toolCallId)
        resolve({ decision: 'reject' })
      }, CONFIRMATION_TIMEOUT_MS)

      this.pending.set(toolCallId, { resolve, timeout })
    })
  }

  /**
   * Resolve a pending confirmation.
   * Returns true if the toolCallId was found and resolved, false otherwise.
   */
  resolveConfirmation(
    toolCallId: string,
    decision: ConfirmationDecision,
  ): boolean {
    const entry = this.pending.get(toolCallId)
    if (!entry) return false

    clearTimeout(entry.timeout)
    this.pending.delete(toolCallId)
    entry.resolve(decision)
    return true
  }

  /** Number of pending confirmations (for testing). */
  get pendingCount(): number {
    return this.pending.size
  }

  /** Clear all pending confirmations (for cleanup). */
  destroy(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeout)
      this.pending.delete(id)
      entry.resolve({ decision: 'reject' })
    }
  }
}

// ─── Agent Token ─────────────────────────────────────────────

export function generateAgentToken(): string {
  return randomBytes(32).toString('hex')
}

export function readAgentToken(): string | null {
  try {
    return fs.readFileSync(AGENT_TOKEN_FILE, 'utf-8').trim()
  } catch {
    return null
  }
}

export function writeAgentToken(token: string): void {
  fs.mkdirSync(AGENT_TOKEN_DIR, { recursive: true })
  fs.writeFileSync(AGENT_TOKEN_FILE, token, { encoding: 'utf-8', mode: 0o600 })
}

// ─── DesktopAgentBridge ─────────────────────────────────────

interface PendingToolRequest {
  readonly resolve: (result: AgentToolResult) => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export class DesktopAgentBridge {
  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private connected = false
  private readonly pendingRequests = new Map<string, PendingToolRequest>()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private missedPongs = 0
  private readonly token: string
  private readonly port: number
  private onStatusChange: ((connected: boolean) => void) | null = null

  /** @internal Exposed for testing — override default timing constants. */
  readonly _options: {
    toolTimeoutMs: number
    heartbeatIntervalMs: number
    maxMissedPongs: number
  }

  constructor(options: {
    port: number
    token: string
    toolTimeoutMs?: number
    heartbeatIntervalMs?: number
    maxMissedPongs?: number
  }) {
    this.port = options.port
    this.token = options.token
    this._options = {
      toolTimeoutMs: options.toolTimeoutMs ?? TOOL_TIMEOUT_MS,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      maxMissedPongs: options.maxMissedPongs ?? MAX_MISSED_PONGS,
    }
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' })
    this.wss.on('connection', (ws) => {
      this.handleNewConnection(ws)
    })
    this.wss.on('error', (err) => {
      // Prevent EADDRINUSE from crashing the entire gateway (e.g. during hot-reload)
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        console.error(`[DesktopAgentBridge] Port ${String(this.port)} already in use — bridge disabled`)
      } else {
        console.error(`[DesktopAgentBridge] WebSocket server error: ${String(err)}`)
      }
    })
  }

  async stop(): Promise<void> {
    this.stopHeartbeat()

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(id)
      pending.reject(new Error('Bridge shutting down'))
    }

    // Forcefully terminate all connected clients so wss.close() doesn't hang
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate()
      }
    }

    this.socket = null
    this.setConnected(false)

    return new Promise<void>((resolve) => {
      if (!this.wss) {
        resolve()
        return
      }
      this.wss.close(() => {
        this.wss = null
        resolve()
      })
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  /** Get the configured path (attached mode only). Returns undefined in standalone mode. */
  getPath(): string | undefined {
    return undefined
  }

  /** Whether the bridge is attached to an HTTP server. Always false in standalone mode. */
  isAttached(): boolean {
    return false
  }

  /** Attach to HTTP server for path-based upgrade routing. No-op in standalone mode. */
  attachToServer(_server: unknown): void {
    // Standalone mode — nothing to attach
  }

  setStatusListener(fn: (connected: boolean) => void): void {
    this.onStatusChange = fn
  }

  async routeToolCall(
    requestId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<AgentToolResult> {
    if (!this.connected || !this.socket) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: true, reason: 'Desktop Agent nicht verbunden' }),
        }],
      }
    }

    const request: AgentToolRequest = {
      type: 'tool_request',
      requestId,
      toolName,
      params,
    }

    return new Promise<AgentToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        resolve({
          content: [{
            type: 'text',
            text: JSON.stringify({ error: true, reason: 'Tool-Ausführung Timeout (60s)' }),
          }],
        })
      }, this._options.toolTimeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })
      this.socket!.send(JSON.stringify(request))
    })
  }

  private handleNewConnection(ws: WebSocket): void {
    // Auth timeout — must authenticate within 5s
    const authTimer = setTimeout(() => {
      ws.close(4001, 'Auth timeout')
    }, AUTH_TIMEOUT_MS)

    let authenticated = false

    ws.on('message', (data) => {
      let msg: AgentMessage
      try {
        msg = JSON.parse(String(data)) as AgentMessage
      } catch {
        ws.close(4002, 'Invalid JSON')
        return
      }

      if (!authenticated) {
        clearTimeout(authTimer)
        if (msg.type !== 'auth' || !this.verifyToken(msg.token)) {
          ws.close(4003, 'Auth failed')
          return
        }
        authenticated = true

        // Close existing connection if any
        if (this.socket) {
          this.socket.close(4004, 'Replaced by new connection')
        }
        this.socket = ws
        this.setConnected(true)
        this.startHeartbeat()
        return
      }

      this.handleMessage(msg)
    })

    ws.on('close', () => {
      clearTimeout(authTimer)
      if (ws === this.socket) {
        this.handleClose()
      }
    })

    ws.on('error', () => {
      clearTimeout(authTimer)
      if (ws === this.socket) {
        this.handleClose()
      }
    })
  }

  private handleMessage(msg: AgentMessage): void {
    switch (msg.type) {
      case 'tool_result': {
        const pending = this.pendingRequests.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(msg.requestId)
          pending.resolve(msg.result)
        }
        break
      }
      case 'tool_error': {
        const pending = this.pendingRequests.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(msg.requestId)
          pending.resolve({
            content: [{
              type: 'text',
              text: JSON.stringify({ error: true, reason: transformError(msg.error) }),
            }],
          })
        }
        break
      }
      case 'pong': {
        this.missedPongs = 0
        break
      }
      default:
        break
    }
  }

  private handleClose(): void {
    this.socket = null
    this.setConnected(false)
    this.stopHeartbeat()

    // Resolve all pending requests with error
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(id)
      pending.resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({ error: true, reason: transformError('Desktop Agent disconnected') }),
        }],
      })
    }
  }

  /** Constant-time token comparison to prevent timing attacks. */
  private verifyToken(candidate: string): boolean {
    const expected = Buffer.from(this.token, 'utf-8')
    const actual = Buffer.from(candidate, 'utf-8')
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return
    this.connected = value
    this.onStatusChange?.(value)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.missedPongs = 0
    this.heartbeatInterval = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

      this.missedPongs++
      if (this.missedPongs > this._options.maxMissedPongs) {
        // Use terminate() for immediate disconnect without close handshake
        this.socket.terminate()
        return
      }

      const ping: PingMessage = { type: 'ping' }
      this.socket.send(JSON.stringify(ping))
    }, this._options.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /** Number of pending tool requests (for testing). */
  get pendingCount(): number {
    return this.pendingRequests.size
  }
}

// ─── Tool Wrapping ───────────────────────────────────────────

/**
 * Wrap tools with confirmation and/or desktop agent routing.
 * - runsOn: 'desktop' → route via DesktopAgentBridge (if provided)
 * - requiresConfirmation → ask user before execution
 */
export function createConfirmableTools(
  tools: readonly ConfirmableOpenClawTool[],
  manager: ConfirmationManager,
  bridge?: DesktopAgentBridge,
): ConfirmableOpenClawTool[] {
  return tools.map((tool): ConfirmableOpenClawTool => {
    const needsRouting = tool.runsOn === 'desktop' && bridge !== undefined
    const needsConfirmation = tool.requiresConfirmation

    // No wrapping needed
    if (!needsRouting && !needsConfirmation) {
      return tool
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      requiresConfirmation: tool.requiresConfirmation,
      runsOn: tool.runsOn,
      execute: async (
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
      ): Promise<AgentToolResult> => {
        // Step 1: Confirmation (if needed)
        let finalParams = params
        if (needsConfirmation) {
          const decision = await manager.requestConfirmation(
            toolCallId,
            tool.name,
            params,
          )

          if (decision.decision === 'reject') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    rejected: true,
                    reason: 'User hat abgelehnt',
                  }),
                },
              ],
            }
          }

          finalParams = decision.modifiedParams ?? params
        }

        // Step 2: Route to desktop agent or execute locally
        if (needsRouting) {
          return bridge!.routeToolCall(toolCallId, tool.name, finalParams)
        }

        return tool.execute(toolCallId, finalParams, signal)
      },
    }
  })
}
