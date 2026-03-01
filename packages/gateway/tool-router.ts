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
import type { IncomingMessage } from 'node:http'
import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import { verifyToken } from '@clerk/backend'
import { getToolRoutingContext } from './src/tool-routing-context.js'

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

/** Risk tier: 0=pure compute, 1=read, 2=local write, 3=external send, 4=delete */
type RiskTier = 0 | 1 | 2 | 3 | 4

export interface ConfirmableOpenClawTool {
  readonly name: string
  readonly description: string
  readonly parameters: JSONSchema
  readonly requiresConfirmation: boolean
  readonly runsOn: 'server' | 'desktop'
  readonly riskTiers?: Readonly<Record<string, RiskTier>>
  readonly defaultRiskTier?: RiskTier
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

export interface StaticAuthMessage {
  readonly type: 'auth'
  readonly token: string
}

export interface ClerkAuthMessage {
  readonly type: 'auth'
  readonly clerkToken: string
}

export type AuthMessage = StaticAuthMessage | ClerkAuthMessage

export type AgentMessage = AgentToolResponse | AgentToolError | PongMessage | AuthMessage

// ─── Constants ───────────────────────────────────────────────

const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
export const AGENT_WS_PORT_OFFSET = 1          // Port = Gateway-Port + 1
export const TOOL_TIMEOUT_MS = 60_000          // 60s für Tool-Execution
export const HEARTBEAT_INTERVAL_MS = 30_000    // 30s Ping
export const MAX_MISSED_PONGS = 2              // 2 missed → disconnect
const AUTH_TIMEOUT_MS = 5_000                  // 5s for auth message
export const MAX_PAYLOAD_BYTES = 5_242_880     // 5 MB (captureScreen PNGs können 2-3 MB sein)
const AGENT_TOKEN_DIR = path.join(os.homedir(), '.openclaw')
const AGENT_TOKEN_FILE = path.join(AGENT_TOKEN_DIR, 'agent-token')

// ─── ConfirmationManager ─────────────────────────────────────

interface PendingConfirmationEntry extends PendingConfirmation {
  readonly sessionId: string
}

export class ConfirmationManager {
  private readonly pending = new Map<string, PendingConfirmationEntry>()
  private emitFn: EmitFn | null = null

  setEmitter(fn: EmitFn): void {
    this.emitFn = fn
  }

  /**
   * Request user confirmation for a tool call.
   * sessionId is passed explicitly — there is no shared active-session slot,
   * so concurrent requests for different users/sessions are fully isolated.
   * Sends an SSE event and waits for the user to confirm or reject.
   * Auto-rejects after 5 minutes.
   */
  async requestConfirmation(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<ConfirmationDecision> {
    if (!sessionId || this.emitFn === null) {
      // No session context or emitter — reject rather than silently auto-execute
      return { decision: 'reject' }
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

      this.pending.set(toolCallId, { sessionId, resolve, timeout })
    })
  }

  /**
   * Resolve a pending confirmation.
   * sessionId must match the session that originally requested the confirmation
   * to prevent cross-user resolution spoofing.
   * Returns true if the toolCallId was found and resolved, false otherwise.
   */
  resolveConfirmation(
    sessionId: string,
    toolCallId: string,
    decision: ConfirmationDecision,
  ): boolean {
    const entry = this.pending.get(toolCallId)
    if (!entry) return false
    // Ownership check: only the originating session may resolve its own tool call
    if (entry.sessionId !== sessionId) return false

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

interface UserConnection {
  readonly userId: string
  readonly socket: WebSocket
  readonly pendingRequests: Map<string, PendingToolRequest>
  missedPongs: number
  heartbeatInterval: ReturnType<typeof setInterval> | null
}

/** Clerk verify function signature (matches @clerk/backend verifyToken return shape). */
type ClerkVerifyResult = { data: unknown; errors?: undefined } | { data?: undefined; errors: unknown[] }
type ClerkVerifyFn = (
  token: string,
  options: { secretKey: string; clockSkewInMs: number },
) => Promise<ClerkVerifyResult>

/** Standalone mode: own WebSocketServer on a dedicated port. */
interface BridgeStandaloneOptions {
  port: number
  token?: string
  resolveUserId?: (token: string) => string | null | Promise<string | null>
  clerkSecretKey?: string
  clockSkewInMs?: number
  /** @internal Override Clerk verify function (for testing). */
  _clerkVerify?: ClerkVerifyFn
  toolTimeoutMs?: number
  heartbeatIntervalMs?: number
  maxMissedPongs?: number
}

/** Attached mode: piggyback on existing HTTP server via path-based upgrade routing. */
interface BridgeAttachedOptions {
  path: string      // e.g. '/agent/ws'
  token?: string
  resolveUserId?: (token: string) => string | null | Promise<string | null>
  clerkSecretKey?: string
  clockSkewInMs?: number
  /** @internal Override Clerk verify function (for testing). */
  _clerkVerify?: ClerkVerifyFn
  toolTimeoutMs?: number
  heartbeatIntervalMs?: number
  maxMissedPongs?: number
}

export type BridgeOptions = BridgeStandaloneOptions | BridgeAttachedOptions

export class DesktopAgentBridge {
  private wss: WebSocketServer | null = null
  private readonly connections = new Map<string, UserConnection>()
  private readonly socketToUserId = new Map<WebSocket, string>()
  private readonly token: string
  private readonly resolveUserId: ((token: string) => string | null | Promise<string | null>) | null
  private readonly clerkSecretKey: string | null
  private readonly clockSkewInMs: number
  private readonly clerkVerify: ClerkVerifyFn
  private onStatusChange: ((connected: boolean) => void) | null = null

  // Mode-specific fields
  private readonly port: number | undefined
  private readonly path: string | undefined
  private attached = false
  private httpServer: Server | null = null
  // Generic emit signature — avoids overload resolution issues with Server.emit
  private originalEmit: ((event: string, ...args: unknown[]) => boolean) | null = null

  /** @internal Exposed for testing — override default timing constants. */
  readonly _options: {
    toolTimeoutMs: number
    heartbeatIntervalMs: number
    maxMissedPongs: number
  }

  constructor(options: BridgeOptions) {
    // ── Auth mode validation (exactly one mode required) ──
    const hasToken = options.token !== undefined && options.token !== ''
    const hasClerk = options.clerkSecretKey !== undefined && options.clerkSecretKey !== ''
    const hasResolver = options.resolveUserId !== undefined

    if (hasClerk && hasToken) {
      throw new Error(
        'DesktopAgentBridge: clerkSecretKey and token are mutually exclusive — dual auth is a security risk',
      )
    }
    if (hasClerk && hasResolver) {
      throw new Error(
        'DesktopAgentBridge: clerkSecretKey and resolveUserId are mutually exclusive',
      )
    }
    if (!hasClerk && !hasToken && !hasResolver) {
      throw new Error(
        'DesktopAgentBridge: either token, clerkSecretKey, or resolveUserId must be provided',
      )
    }

    this.token = options.token ?? ''
    this.resolveUserId = options.resolveUserId ?? null
    this.clerkSecretKey = options.clerkSecretKey ?? null
    this.clerkVerify = options._clerkVerify ?? (
      async (tok, opts) => {
        try {
          const payload = await verifyToken(tok, opts)
          return { data: payload }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown verification error'
          return { errors: [{ message }] }
        }
      }
    )
    this.clockSkewInMs = options.clockSkewInMs ?? 5_000

    if ('port' in options) {
      this.port = options.port
    } else {
      this.path = options.path
    }
    this._options = {
      toolTimeoutMs: options.toolTimeoutMs ?? TOOL_TIMEOUT_MS,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      maxMissedPongs: options.maxMissedPongs ?? MAX_MISSED_PONGS,
    }
  }

  start(): void {
    if (this.port !== undefined) {
      // ── Standalone mode: own WebSocketServer ──
      this.wss = new WebSocketServer({
        port: this.port,
        host: '127.0.0.1',
        maxPayload: MAX_PAYLOAD_BYTES,
      })
      this.wss.on('connection', (ws) => {
        this.handleNewConnection(ws)
      })
      this.wss.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE') {
          console.error(`[DesktopAgentBridge] Port ${String(this.port)} already in use — bridge disabled`)
        } else {
          console.error(`[DesktopAgentBridge] WebSocket server error: ${String(err)}`)
        }
      })
    } else {
      // ── Attached mode: noServer WSS, upgrade handled via attachToServer() ──
      this.wss = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_PAYLOAD_BYTES,
      })
      this.wss.on('error', (err) => {
        console.error(`[DesktopAgentBridge] WebSocket server error: ${String(err)}`)
      })
    }
  }

  /**
   * Attach to an existing HTTP server for path-based WebSocket upgrade routing.
   * Wraps httpServer.emit to intercept 'upgrade' events for our path,
   * while letting all other events (including non-bridge upgrades) pass through.
   */
  attachToServer(httpServer: Server): void {
    if (!this.wss || this.port !== undefined || this.attached) return // only for attached mode, idempotent

    this.httpServer = httpServer
    const bridgePath = this.path
    const self = this

    // Capture original emit (bound) for restoration on stop() and pass-through
    const origEmit: (event: string, ...args: unknown[]) => boolean =
      httpServer.emit.bind(httpServer)
    this.originalEmit = origEmit

    httpServer.emit = function (this: Server, event: string, ...args: unknown[]): boolean {
      if (event === 'upgrade') {
        const [req, sock, head] = args as [IncomingMessage, Duplex, Buffer]
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === bridgePath) {
          // Our bridge path → handleUpgrade, do NOT propagate event
          self.wss!.handleUpgrade(req, sock, head, (ws) => {
            self.handleNewConnection(ws)
          })
          return true
        }
      }
      // Everything else → original dispatch (preserves all existing listeners)
      return origEmit.call(this, event, ...args)
    } as typeof httpServer.emit

    this.attached = true
  }

  /** Get the configured path (attached mode only). */
  getPath(): string | undefined {
    return this.path
  }

  /** Whether the bridge is attached to an HTTP server (attached mode only). */
  isAttached(): boolean {
    return this.attached
  }

  async stop(): Promise<void> {
    // Stop all per-user heartbeats and reject all pending requests
    for (const conn of this.connections.values()) {
      this.stopUserHeartbeat(conn)
      for (const [id, pending] of conn.pendingRequests) {
        clearTimeout(pending.timeout)
        conn.pendingRequests.delete(id)
        pending.reject(new Error('Bridge shutting down'))
      }
    }

    // Forcefully terminate all connected clients so wss.close() doesn't hang
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate()
      }
    }

    const hadConnections = this.connections.size > 0
    this.connections.clear()
    this.socketToUserId.clear()
    if (hadConnections) {
      this.onStatusChange?.(false)
    }

    // Restore original emit if we patched it
    if (this.attached && this.httpServer && this.originalEmit) {
      this.httpServer.emit = this.originalEmit as typeof this.httpServer.emit
      this.httpServer = null
      this.originalEmit = null
      this.attached = false
    }

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

  /**
   * Check if any user (no arg) or a specific user is connected.
   */
  isConnected(userId?: string): boolean {
    if (userId !== undefined) {
      return this.connections.has(userId)
    }
    return this.connections.size > 0
  }

  setStatusListener(fn: (connected: boolean) => void): void {
    this.onStatusChange = fn
  }

  /** List all currently connected user IDs. */
  getConnectedUserIds(): readonly string[] {
    return [...this.connections.keys()]
  }

  async routeToolCall(
    requestId: string,
    toolName: string,
    params: Record<string, unknown>,
    userId?: string,
  ): Promise<AgentToolResult> {
    let conn: UserConnection | undefined

    if (userId !== undefined) {
      conn = this.connections.get(userId)
      if (!conn) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: true, reason: 'Desktop Agent nicht verbunden' }),
          }],
        }
      }
    } else {
      // Backward compat: single-user fallback
      if (this.connections.size === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: true, reason: 'Desktop Agent nicht verbunden' }),
          }],
        }
      }
      if (this.connections.size > 1) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: true, reason: 'userId required — multiple agents connected' }),
          }],
        }
      }
      conn = this.connections.values().next().value as UserConnection
    }

    const request: AgentToolRequest = {
      type: 'tool_request',
      requestId,
      toolName,
      params,
    }

    return new Promise<AgentToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.pendingRequests.delete(requestId)
        resolve({
          content: [{
            type: 'text',
            text: JSON.stringify({ error: true, reason: 'Tool-Ausführung Timeout (60s)' }),
          }],
        })
      }, this._options.toolTimeoutMs)

      conn.pendingRequests.set(requestId, { resolve, reject, timeout })
      conn.socket.send(JSON.stringify(request))
    })
  }

  private handleNewConnection(ws: WebSocket): void {
    // Auth timeout — must authenticate within 5s
    const authTimer = setTimeout(() => {
      ws.close(4001, 'Auth timeout')
    }, AUTH_TIMEOUT_MS)

    let authenticated = false
    let authInProgress = false
    let connUserId: string | null = null

    ws.on('message', (data) => {
      let msg: AgentMessage
      try {
        msg = JSON.parse(String(data)) as AgentMessage
      } catch {
        ws.close(4002, 'Invalid JSON')
        return
      }

      if (!authenticated) {
        if (authInProgress) return // Ignore messages while auth is being verified
        if (msg.type !== 'auth') {
          clearTimeout(authTimer)
          ws.close(4003, 'Auth failed')
          return
        }

        authInProgress = true
        void (async () => {
          const { userId, closeReason } = await this.authenticateToken(msg)
          clearTimeout(authTimer)
          if (userId === null) {
            ws.close(4003, closeReason ?? 'Auth failed')
            return
          }

          authenticated = true
          connUserId = userId

          // Replace existing connection for this userId if any
          const existing = this.connections.get(userId)
          if (existing) {
            // Reject all pending requests on the old connection
            for (const [id, pending] of existing.pendingRequests) {
              clearTimeout(pending.timeout)
              existing.pendingRequests.delete(id)
              pending.resolve({
                content: [{
                  type: 'text',
                  text: JSON.stringify({ error: true, reason: 'Replaced by new connection' }),
                }],
              })
            }
            this.stopUserHeartbeat(existing)
            this.socketToUserId.delete(existing.socket)
            existing.socket.close(4004, 'Replaced by new connection')
          }

          const wasPreviouslyEmpty = this.connections.size === 0
          const newConn: UserConnection = {
            userId,
            socket: ws,
            pendingRequests: new Map(),
            missedPongs: 0,
            heartbeatInterval: null,
          }
          this.connections.set(userId, newConn)
          this.socketToUserId.set(ws, userId)
          this.startUserHeartbeat(newConn)

          // Status listener: fire true only on 0→1 transition
          if (wasPreviouslyEmpty) {
            this.onStatusChange?.(true)
          }
        })()
        return
      }

      this.handleMessage(msg, ws)
    })

    ws.on('close', () => {
      clearTimeout(authTimer)
      if (connUserId !== null) {
        this.handleClose(ws, connUserId)
      }
    })

    ws.on('error', () => {
      clearTimeout(authTimer)
      if (connUserId !== null) {
        this.handleClose(ws, connUserId)
      }
    })
  }

  /**
   * Handle an incoming message from an authenticated socket.
   * Only looks up requestIds in the sender's own pendingRequests map
   * to prevent response-spoofing across users.
   */
  private handleMessage(msg: AgentMessage, senderSocket: WebSocket): void {
    // O(1) reverse lookup: socket → userId → UserConnection
    const userId = this.socketToUserId.get(senderSocket)
    if (!userId) return
    const senderConn = this.connections.get(userId)
    if (!senderConn) return

    switch (msg.type) {
      case 'tool_result': {
        const pending = senderConn.pendingRequests.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          senderConn.pendingRequests.delete(msg.requestId)
          pending.resolve(msg.result)
        }
        break
      }
      case 'tool_error': {
        const pending = senderConn.pendingRequests.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          senderConn.pendingRequests.delete(msg.requestId)
          pending.resolve({
            content: [{
              type: 'text',
              text: JSON.stringify({ error: true, reason: msg.error }),
            }],
          })
        }
        break
      }
      case 'pong': {
        senderConn.missedPongs = 0
        break
      }
      default:
        break
    }
  }

  private handleClose(ws: WebSocket, userId: string): void {
    const conn = this.connections.get(userId)
    // Only clean up if the closing socket is still the active one for this userId
    if (!conn || conn.socket !== ws) return

    this.stopUserHeartbeat(conn)

    // Resolve all pending requests with error
    for (const [id, pending] of conn.pendingRequests) {
      clearTimeout(pending.timeout)
      conn.pendingRequests.delete(id)
      pending.resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({ error: true, reason: 'Desktop Agent disconnected' }),
        }],
      })
    }

    this.socketToUserId.delete(ws)
    this.connections.delete(userId)

    // Status listener: fire false only on 1→0 transition
    if (this.connections.size === 0) {
      this.onStatusChange?.(false)
    }
  }

  /**
   * Authenticate an auth message and return userId + optional close reason.
   * Clerk mode: verifies JWT via @clerk/backend, extracts sub claim.
   * Static mode: delegates to resolveUserId or constant-time token comparison.
   */
  private async authenticateToken(msg: AuthMessage): Promise<{ userId: string | null; closeReason?: string }> {
    // ── Clerk JWT mode ──
    if (this.clerkSecretKey) {
      if (!('clerkToken' in msg) || typeof msg.clerkToken !== 'string') {
        return { userId: null, closeReason: 'Expected clerkToken field in auth message' }
      }
      try {
        const result = await this.clerkVerify(msg.clerkToken, {
          secretKey: this.clerkSecretKey,
          clockSkewInMs: this.clockSkewInMs,
        })
        if (result.errors) {
          const reason = (result.errors as Array<{ message?: string }>)[0]?.message ?? 'Token verification failed'
          return { userId: null, closeReason: reason }
        }
        const payload = result.data as { sub: string }
        if (!payload.sub) {
          return { userId: null, closeReason: 'JWT missing sub claim' }
        }
        return { userId: payload.sub }
      } catch {
        return { userId: null, closeReason: 'Clerk token verification error' }
      }
    }

    // ── Static token mode ──
    if (!('token' in msg) || typeof msg.token !== 'string') {
      return { userId: null, closeReason: 'Auth failed' }
    }

    if (this.resolveUserId) {
      const userId = await this.resolveUserId(msg.token)
      return { userId, closeReason: userId === null ? 'Auth failed' : undefined }
    }

    // Default single-user mode: constant-time token comparison
    const expected = Buffer.from(this.token, 'utf-8')
    const actual = Buffer.from(msg.token, 'utf-8')
    if (expected.length !== actual.length) return { userId: null, closeReason: 'Auth failed' }
    if (!timingSafeEqual(expected, actual)) return { userId: null, closeReason: 'Auth failed' }
    return { userId: 'local' }
  }

  private startUserHeartbeat(conn: UserConnection): void {
    this.stopUserHeartbeat(conn)
    conn.missedPongs = 0
    conn.heartbeatInterval = setInterval(() => {
      if (conn.socket.readyState !== WebSocket.OPEN) return

      conn.missedPongs++
      if (conn.missedPongs > this._options.maxMissedPongs) {
        conn.socket.terminate()
        return
      }

      const ping: PingMessage = { type: 'ping' }
      conn.socket.send(JSON.stringify(ping))
    }, this._options.heartbeatIntervalMs)
  }

  private stopUserHeartbeat(conn: UserConnection): void {
    if (conn.heartbeatInterval) {
      clearInterval(conn.heartbeatInterval)
      conn.heartbeatInterval = null
    }
  }

  /** Number of pending tool requests across all users (for testing). */
  get pendingCount(): number {
    let total = 0
    for (const conn of this.connections.values()) {
      total += conn.pendingRequests.size
    }
    return total
  }
}

// ─── Tool Wrapping ───────────────────────────────────────────

/**
 * Check if a value is a valid RiskTier (0-4).
 * Prevents prototype chain lookups (toString, constructor, __proto__)
 * from being treated as valid tiers.
 */
function isValidRiskTier(value: unknown): value is RiskTier {
  return typeof value === 'number' && (value === 0 || value === 1 || value === 2 || value === 3 || value === 4)
}

/**
 * Resolve the effective risk tier for a tool action.
 * Resolution: riskTiers[action] > defaultRiskTier > fallback (2).
 * Uses hasOwnProperty to prevent prototype chain attacks.
 */
function resolveToolRiskTier(tool: ConfirmableOpenClawTool, action: string): RiskTier {
  if (tool.riskTiers) {
    if (Object.prototype.hasOwnProperty.call(tool.riskTiers, action)) {
      const tier = tool.riskTiers[action]
      if (isValidRiskTier(tier)) return tier
    }
  }
  if (isValidRiskTier(tool.defaultRiskTier)) return tool.defaultRiskTier
  return 2 // Safe default: preview + approve
}

/**
 * Wrap tools with confirmation and/or desktop agent routing.
 * - runsOn: 'desktop' → route via DesktopAgentBridge (if provided)
 * - Confirmation based on per-action risk tier (tier >= 2 requires confirmation).
 *   Falls back to requiresConfirmation boolean when no tier metadata is present.
 *
 * sessionId: the active session for confirmation SSE events.
 * userId:    forwarded to routeToolCall for per-user agent routing.
 */
export function createConfirmableTools(
  tools: readonly ConfirmableOpenClawTool[],
  manager: ConfirmationManager,
  bridge?: DesktopAgentBridge,
  sessionId?: string,
  userId?: string,
): ConfirmableOpenClawTool[] {
  return tools.map((tool): ConfirmableOpenClawTool => {
    const needsRouting = tool.runsOn === 'desktop' && bridge !== undefined
    const hasTierMetadata = tool.riskTiers !== undefined || tool.defaultRiskTier !== undefined

    // If no routing needed AND no tier metadata AND no legacy confirmation → pass through
    if (!needsRouting && !hasTierMetadata && !tool.requiresConfirmation) {
      return tool
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      requiresConfirmation: tool.requiresConfirmation,
      runsOn: tool.runsOn,
      riskTiers: tool.riskTiers,
      defaultRiskTier: tool.defaultRiskTier,
      execute: async (
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
      ): Promise<AgentToolResult> => {
        // Runtime context (set by in-app.ts via withToolRouting)
        const routingCtx = getToolRoutingContext()
        const effectiveSessionId = sessionId ?? routingCtx?.sessionId ?? ''
        const effectiveUserId = userId ?? routingCtx?.userId

        // Step 1: Determine if confirmation is needed
        const action = typeof params['action'] === 'string' ? params['action'] : ''
        const needsConfirmation = hasTierMetadata
          ? resolveToolRiskTier(tool, action) >= 2
          : tool.requiresConfirmation

        // Step 2: Confirmation (if needed)
        let finalParams = params
        if (needsConfirmation) {
          const decision = await manager.requestConfirmation(
            effectiveSessionId,
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

        // Step 3: Route to desktop agent or execute locally
        if (needsRouting) {
          return bridge!.routeToolCall(toolCallId, tool.name, finalParams, effectiveUserId)
        }

        return tool.execute(toolCallId, finalParams, signal)
      },
    }
  })
}
