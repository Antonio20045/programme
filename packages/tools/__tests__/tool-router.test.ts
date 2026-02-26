/**
 * Tests for the ConfirmationManager, createConfirmableTools, and DesktopAgentBridge.
 * Located in tools/__tests__/ because packages/gateway/** is excluded from root vitest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConfirmationManager,
  createConfirmableTools,
  DesktopAgentBridge,
  MAX_PAYLOAD_BYTES,
} from '../../gateway/tool-router'
import type {
  ConfirmableOpenClawTool,
  AgentToolRequest,
} from '../../gateway/tool-router'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(
  overrides?: Partial<ConfirmableOpenClawTool>,
): ConfirmableOpenClawTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    runsOn: 'server',
    execute: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    })),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ConfirmationManager
// ---------------------------------------------------------------------------

describe('ConfirmationManager', () => {
  let manager: ConfirmationManager

  beforeEach(() => {
    manager = new ConfirmationManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  it('starts with zero pending confirmations', () => {
    expect(manager.pendingCount).toBe(0)
  })

  it('rejects confirmation when no emitter is set', async () => {
    const decision = await manager.requestConfirmation(
      'sess-1',
      'tc-1',
      'shell',
      { command: 'ls' },
    )
    // With no emitter, safely rejects rather than silently auto-executing
    expect(decision.decision).toBe('reject')
    expect(manager.pendingCount).toBe(0)
  })

  it('emits tool_confirm SSE event when requesting confirmation', () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    // Don't await — it will pend
    void manager.requestConfirmation('sess-1', 'tc-1', 'shell', { command: 'ls' })

    expect(emitFn).toHaveBeenCalledWith('sess-1', {
      type: 'tool_confirm',
      data: { toolCallId: 'tc-1', toolName: 'shell', params: { command: 'ls' } },
    })
    expect(manager.pendingCount).toBe(1)
  })

  it('resolves pending confirmation with execute', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const promise = manager.requestConfirmation('sess-1', 'tc-1', 'shell', { command: 'ls' })

    const resolved = manager.resolveConfirmation('sess-1', 'tc-1', { decision: 'execute' })
    expect(resolved).toBe(true)

    const decision = await promise
    expect(decision.decision).toBe('execute')
    expect(manager.pendingCount).toBe(0)
  })

  it('resolves pending confirmation with reject', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const promise = manager.requestConfirmation('sess-1', 'tc-2', 'gmail', { to: 'a@b.com' })

    manager.resolveConfirmation('sess-1', 'tc-2', { decision: 'reject' })

    const decision = await promise
    expect(decision.decision).toBe('reject')
  })

  it('passes modifiedParams through', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const promise = manager.requestConfirmation('sess-1', 'tc-3', 'shell', { command: 'rm' })

    manager.resolveConfirmation('sess-1', 'tc-3', {
      decision: 'execute',
      modifiedParams: { command: 'echo safe' },
    })

    const decision = await promise
    expect(decision.modifiedParams).toEqual({ command: 'echo safe' })
  })

  it('returns false when resolving unknown toolCallId', () => {
    const result = manager.resolveConfirmation('sess-1', 'unknown', { decision: 'execute' })
    expect(result).toBe(false)
  })

  it('returns false when resolving with wrong sessionId (cross-session spoofing blocked)', () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    void manager.requestConfirmation('sess-owner', 'tc-owned', 'shell', {})

    // Different session tries to resolve another session's tool call
    const result = manager.resolveConfirmation('sess-attacker', 'tc-owned', { decision: 'execute' })
    expect(result).toBe(false)
    expect(manager.pendingCount).toBe(1)
  })

  it('auto-rejects after timeout', async () => {
    vi.useFakeTimers()

    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const promise = manager.requestConfirmation('sess-1', 'tc-timeout', 'shell', { command: 'test' })

    // Advance time by 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000)

    const decision = await promise
    expect(decision.decision).toBe('reject')
    expect(manager.pendingCount).toBe(0)

    vi.useRealTimers()
  })

  it('rejects when sessionId is empty string', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const decision = await manager.requestConfirmation('', 'tc-4', 'shell', {})
    expect(decision.decision).toBe('reject')
    expect(emitFn).not.toHaveBeenCalled()
  })

  it('destroy rejects all pending', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const p1 = manager.requestConfirmation('sess-1', 'tc-d1', 'shell', {})
    const p2 = manager.requestConfirmation('sess-1', 'tc-d2', 'gmail', {})

    manager.destroy()

    const d1 = await p1
    const d2 = await p2
    expect(d1.decision).toBe('reject')
    expect(d2.decision).toBe('reject')
    expect(manager.pendingCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// createConfirmableTools
// ---------------------------------------------------------------------------

describe('createConfirmableTools', () => {
  let manager: ConfirmationManager

  beforeEach(() => {
    manager = new ConfirmationManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  it('passes through tools without requiresConfirmation', async () => {
    const tool = makeTool({ requiresConfirmation: false })
    const [wrapped] = createConfirmableTools([tool], manager)

    const result = await wrapped!.execute('tc-1', { query: 'test' })
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(tool.execute).toHaveBeenCalledWith('tc-1', { query: 'test' })
  })

  it('wraps tools with requiresConfirmation and waits for confirmation', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const tool = makeTool({
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager, undefined, 'sess-1')

    // Start execution (will wait for confirmation)
    const executePromise = wrapped!.execute('tc-1', { command: 'ls' })

    // Confirm
    manager.resolveConfirmation('sess-1', 'tc-1', { decision: 'execute' })

    const result = await executePromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(tool.execute).toHaveBeenCalledWith('tc-1', { command: 'ls' }, undefined)
  })

  it('returns rejection result when user rejects', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const tool = makeTool({
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager, undefined, 'sess-1')

    const executePromise = wrapped!.execute('tc-2', { command: 'rm -rf /' })

    manager.resolveConfirmation('sess-1', 'tc-2', { decision: 'reject' })

    const result = await executePromise
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { rejected: boolean; reason: string }
      expect(parsed.rejected).toBe(true)
      expect(parsed.reason).toBe('User hat abgelehnt')
    }
    expect(tool.execute).not.toHaveBeenCalled()
  })

  it('uses modifiedParams when user edits before executing', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const tool = makeTool({
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager, undefined, 'sess-1')

    const executePromise = wrapped!.execute('tc-3', { command: 'rm' })

    manager.resolveConfirmation('sess-1', 'tc-3', {
      decision: 'execute',
      modifiedParams: { command: 'echo safe' },
    })

    await executePromise
    expect(tool.execute).toHaveBeenCalledWith(
      'tc-3',
      { command: 'echo safe' },
      undefined,
    )
  })

  it('preserves tool metadata', () => {
    const tool = makeTool({
      name: 'my-tool',
      description: 'My description',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager)

    expect(wrapped!.name).toBe('my-tool')
    expect(wrapped!.description).toBe('My description')
    expect(wrapped!.requiresConfirmation).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DesktopAgentBridge
// ---------------------------------------------------------------------------

/** Connect a native WebSocket client to the bridge and authenticate.
 *  Polls bridge.isConnected() to confirm auth was processed. */
async function connectAgent(
  port: number,
  token: string,
  bridge: DesktopAgentBridge,
): Promise<WebSocket> {
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${String(port)}`)
    sock.addEventListener('open', () => {
      sock.send(JSON.stringify({ type: 'auth', token }))
      resolve(sock)
    })
    sock.addEventListener('error', (e) => reject(e))
  })

  // Wait until the bridge actually registers the connection
  for (let i = 0; i < 50; i++) {
    if (bridge.isConnected()) return ws
    await new Promise((r) => setTimeout(r, 10))
  }
  return ws
}

/** Wait for the next message from a WebSocket. */
function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.addEventListener('message', (e) => {
      resolve(JSON.parse(String(e.data)))
    }, { once: true })
  })
}

// Use a random high port range to avoid conflicts in parallel test runs.
let testPort = 29_200

describe('DesktopAgentBridge', () => {
  let bridge: DesktopAgentBridge
  const token = 'test-secret-token-abc123'

  beforeEach(() => {
    testPort++
    bridge = new DesktopAgentBridge({ port: testPort, token })
    bridge.start()
  })

  afterEach(async () => {
    await bridge.stop()
  })

  it('starts WS server and reports disconnected initially', () => {
    expect(bridge.isConnected()).toBe(false)
  })

  it('accepts authenticated connection', async () => {
    const ws = await connectAgent(testPort, token, bridge)
    expect(bridge.isConnected()).toBe(true)
    ws.close()
  })

  it('rejects connection with invalid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'wrong-token' }))
    })
    const code = await closed
    expect(code).toBe(4003)
    expect(bridge.isConnected()).toBe(false)
  })

  it('replaces existing connection when a new agent connects', async () => {
    const ws1 = await connectAgent(testPort, token, bridge)
    const closed = new Promise<number>((resolve) => {
      ws1.addEventListener('close', (e) => resolve(e.code))
    })
    const ws2 = await connectAgent(testPort, token, bridge)
    const code = await closed
    expect(code).toBe(4004)
    expect(bridge.isConnected()).toBe(true)
    ws2.close()
  })

  it('routes tool_request and receives tool_result', async () => {
    const ws = await connectAgent(testPort, token, bridge)

    // Listen for requests on agent side
    const msgPromise = nextMessage(ws)
    const resultPromise = bridge.routeToolCall('req-1', 'filesystem', { path: '/tmp' })

    const request = await msgPromise as AgentToolRequest
    expect(request.type).toBe('tool_request')
    expect(request.toolName).toBe('filesystem')
    expect(request.requestId).toBe('req-1')

    // Agent sends result back
    ws.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-1',
      result: { content: [{ type: 'text', text: 'file list' }] },
    }))

    const result = await resultPromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'file list' })

    ws.close()
  })

  it('returns error result when agent is disconnected', async () => {
    const result = await bridge.routeToolCall('req-2', 'shell', { command: 'ls' })
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toContain('nicht verbunden')
    }
  })

  it('handles tool_error from agent', async () => {
    const ws = await connectAgent(testPort, token, bridge)

    const msgPromise = nextMessage(ws)
    const resultPromise = bridge.routeToolCall('req-3', 'shell', {})

    await msgPromise
    ws.send(JSON.stringify({
      type: 'tool_error',
      requestId: 'req-3',
      error: 'Permission denied',
    }))

    const result = await resultPromise
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toBe('Permission denied')
    }

    ws.close()
  })

  it('times out tool request after configured timeout', async () => {
    // Use a short timeout bridge for this test
    await bridge.stop()
    bridge = new DesktopAgentBridge({ port: testPort, token, toolTimeoutMs: 200 })
    bridge.start()

    const ws = await connectAgent(testPort, token, bridge)
    void nextMessage(ws) // consume the request but don't respond

    const result = await bridge.routeToolCall('req-timeout', 'shell', {})
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toContain('Timeout')
    }

    ws.close()
  }, 10_000)

  it('disconnects after missing too many pongs', async () => {
    // Use very short heartbeat interval for this test
    await bridge.stop()
    bridge = new DesktopAgentBridge({
      port: testPort,
      token,
      heartbeatIntervalMs: 100,
      maxMissedPongs: 1,
    })
    bridge.start()

    const ws = await connectAgent(testPort, token, bridge)
    expect(bridge.isConnected()).toBe(true)

    // Don't respond to pings — wait for heartbeat to disconnect
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(bridge.isConnected()).toBe(false)
    ws.close()
  }, 10_000)

  it('stop() rejects pending requests', async () => {
    const ws = await connectAgent(testPort, token, bridge)

    void nextMessage(ws)
    const resultPromise = bridge.routeToolCall('req-stop', 'shell', {})

    // stop() terminates all clients and rejects pending
    await bridge.stop()

    await expect(resultPromise).rejects.toThrow('Bridge shutting down')
    ws.close()
  })

  it('calls status listener on connect and disconnect', async () => {
    const listener = vi.fn()
    bridge.setStatusListener(listener)

    const ws = await connectAgent(testPort, token, bridge)
    expect(listener).toHaveBeenCalledWith(true)

    // Wait for close event via a Promise
    const closedPromise = new Promise<void>((resolve) => {
      ws.addEventListener('close', () => resolve())
    })
    ws.close()
    await closedPromise
    // Small delay for bridge to process close
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(listener).toHaveBeenCalledWith(false)
  })
})

// ---------------------------------------------------------------------------
// createConfirmableTools — Routing
// ---------------------------------------------------------------------------

describe('createConfirmableTools with bridge', () => {
  let manager: ConfirmationManager
  let bridge: DesktopAgentBridge
  const token = 'routing-test-token'

  beforeEach(() => {
    testPort++
    manager = new ConfirmationManager()
    bridge = new DesktopAgentBridge({ port: testPort, token })
    bridge.start()
  })

  afterEach(async () => {
    manager.destroy()
    await bridge.stop()
  })

  it('executes server tools directly without bridge', async () => {
    const tool = makeTool({ runsOn: 'server' })
    const [wrapped] = createConfirmableTools([tool], manager, bridge)

    const result = await wrapped!.execute('tc-s1', { q: 'test' })
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(tool.execute).toHaveBeenCalled()
  })

  it('routes desktop tools via bridge when connected', async () => {
    const ws = await connectAgent(testPort, token, bridge)

    const tool = makeTool({ runsOn: 'desktop', name: 'filesystem' })
    const [wrapped] = createConfirmableTools([tool], manager, bridge)

    const msgPromise = nextMessage(ws)
    const execPromise = wrapped!.execute('tc-d1', { path: '/home' })

    const request = await msgPromise as AgentToolRequest
    expect(request.type).toBe('tool_request')
    expect(request.toolName).toBe('filesystem')

    ws.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'tc-d1',
      result: { content: [{ type: 'text', text: 'routed' }] },
    }))

    const result = await execPromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'routed' })
    // Original execute should NOT have been called
    expect(tool.execute).not.toHaveBeenCalled()

    ws.close()
  })

  it('returns error for desktop tool when agent disconnected', async () => {
    const tool = makeTool({ runsOn: 'desktop', name: 'shell' })
    const [wrapped] = createConfirmableTools([tool], manager, bridge)

    const result = await wrapped!.execute('tc-d2', {})
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
    }
    expect(tool.execute).not.toHaveBeenCalled()
  })

  it('confirms then routes for desktop tool with requiresConfirmation', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)

    const ws = await connectAgent(testPort, token, bridge)

    const tool = makeTool({
      runsOn: 'desktop',
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager, bridge, 'sess-1')

    const msgPromise = nextMessage(ws)
    const execPromise = wrapped!.execute('tc-cd1', { command: 'ls' })

    // First: confirm
    manager.resolveConfirmation('sess-1', 'tc-cd1', { decision: 'execute' })

    // Then: agent receives tool_request
    const request = await msgPromise as AgentToolRequest
    expect(request.type).toBe('tool_request')

    ws.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'tc-cd1',
      result: { content: [{ type: 'text', text: 'confirmed+routed' }] },
    }))

    const result = await execPromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'confirmed+routed' })

    ws.close()
  })
})

// ---------------------------------------------------------------------------
// Multi-User DesktopAgentBridge
// ---------------------------------------------------------------------------

/** Connect a WebSocket client with a specific token for multi-user tests. */
async function connectAgentAs(
  port: number,
  token: string,
  bridge: DesktopAgentBridge,
  expectedUserId?: string,
): Promise<WebSocket> {
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${String(port)}`)
    sock.addEventListener('open', () => {
      sock.send(JSON.stringify({ type: 'auth', token }))
      resolve(sock)
    })
    sock.addEventListener('error', (e) => reject(e))
  })

  // Wait until the bridge registers the connection
  for (let i = 0; i < 50; i++) {
    if (expectedUserId !== undefined) {
      if (bridge.isConnected(expectedUserId)) return ws
    } else {
      if (bridge.isConnected()) return ws
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  return ws
}

describe('Multi-User DesktopAgentBridge', () => {
  let bridge: DesktopAgentBridge
  const tokens = new Map([['token-a', 'user-a'], ['token-b', 'user-b']])

  beforeEach(() => {
    testPort++
    bridge = new DesktopAgentBridge({
      port: testPort,
      token: '', // not used when resolveUserId is set
      resolveUserId: (t) => tokens.get(t) ?? null,
    })
    bridge.start()
  })

  afterEach(async () => {
    await bridge.stop()
  })

  it('connects two users simultaneously', async () => {
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')

    expect(bridge.isConnected()).toBe(true)
    expect(bridge.isConnected('user-a')).toBe(true)
    expect(bridge.isConnected('user-b')).toBe(true)
    expect(bridge.getConnectedUserIds()).toContain('user-a')
    expect(bridge.getConnectedUserIds()).toContain('user-b')

    wsA.close()
    wsB.close()
  })

  it('routes tool call to the correct user', async () => {
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')

    const messagesB: unknown[] = []
    wsB.addEventListener('message', (e) => {
      messagesB.push(JSON.parse(String(e.data)))
    })

    const msgPromiseA = nextMessage(wsA)
    const resultPromise = bridge.routeToolCall('req-u1', 'filesystem', { path: '/tmp' }, 'user-a')

    const request = await msgPromiseA as AgentToolRequest
    expect(request.type).toBe('tool_request')
    expect(request.toolName).toBe('filesystem')

    // User A responds
    wsA.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-u1',
      result: { content: [{ type: 'text', text: 'from-user-a' }] },
    }))

    const result = await resultPromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'from-user-a' })

    // User B should NOT have received anything (except possibly pings)
    const toolRequests = messagesB.filter(
      (m) => (m as { type: string }).type === 'tool_request',
    )
    expect(toolRequests).toHaveLength(0)

    wsA.close()
    wsB.close()
  })

  it('isolates request IDs between users', async () => {
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')

    // Same requestId for both users
    const msgA = nextMessage(wsA)
    const msgB = nextMessage(wsB)
    const resultA = bridge.routeToolCall('req-1', 'tool-x', {}, 'user-a')
    const resultB = bridge.routeToolCall('req-1', 'tool-y', {}, 'user-b')

    await msgA
    await msgB

    // Each user responds to their own request
    wsA.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-1',
      result: { content: [{ type: 'text', text: 'result-a' }] },
    }))
    wsB.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-1',
      result: { content: [{ type: 'text', text: 'result-b' }] },
    }))

    const rA = await resultA
    const rB = await resultB
    expect(rA.content[0]).toEqual({ type: 'text', text: 'result-a' })
    expect(rB.content[0]).toEqual({ type: 'text', text: 'result-b' })

    wsA.close()
    wsB.close()
  })

  it('replaces existing connection and rejects pending requests', async () => {
    const wsA1 = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')

    // Send a tool request that will be pending
    void nextMessage(wsA1) // consume the request
    const pendingResult = bridge.routeToolCall('req-old', 'shell', {}, 'user-a')

    // Reconnect as user-a (replaces old connection)
    const closedPromise = new Promise<number>((resolve) => {
      wsA1.addEventListener('close', (e) => resolve(e.code))
    })
    const wsA2 = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const closeCode = await closedPromise
    expect(closeCode).toBe(4004)

    // Old pending request should have been resolved with error
    const oldResult = await pendingResult
    const text = oldResult.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toContain('Replaced')
    }

    // New connection should work
    const msgPromise = nextMessage(wsA2)
    const newResult = bridge.routeToolCall('req-new', 'shell', {}, 'user-a')
    await msgPromise
    wsA2.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-new',
      result: { content: [{ type: 'text', text: 'new-connection' }] },
    }))
    const result = await newResult
    expect(result.content[0]).toEqual({ type: 'text', text: 'new-connection' })

    wsA2.close()
  })

  it('prevents response spoofing across users', async () => {
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')

    // Send tool request to user-a
    const msgPromise = nextMessage(wsA)
    const resultPromise = bridge.routeToolCall('req-x', 'shell', {}, 'user-a')
    await msgPromise

    // User B tries to spoof the response
    wsB.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-x',
      result: { content: [{ type: 'text', text: 'spoofed' }] },
    }))

    // Give time for the spoofed message to be processed
    await new Promise((r) => setTimeout(r, 50))

    // Request should still be pending (spoofed response was ignored)
    expect(bridge.pendingCount).toBe(1)

    // Real user-a sends correct response
    wsA.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-x',
      result: { content: [{ type: 'text', text: 'legitimate' }] },
    }))

    const result = await resultPromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'legitimate' })

    wsA.close()
    wsB.close()
  })

  it('enforces maxPayload limit', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      // Send auth first
      ws.send(JSON.stringify({ type: 'auth', token: 'token-a' }))
      // Then send an oversized message
      setTimeout(() => {
        const oversized = 'x'.repeat(MAX_PAYLOAD_BYTES + 1)
        ws.send(oversized)
      }, 50)
    })

    const code = await closed
    // ws library closes with 1006 or 1009 for oversized payloads
    expect([1006, 1009]).toContain(code)
  })

  it('errors when routeToolCall has no userId and multiple users connected', async () => {
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')

    const result = await bridge.routeToolCall('req-amb', 'shell', {})
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toContain('userId required')
    }

    wsA.close()
    wsB.close()
  })

  it('rejects auth when resolveUserId returns null', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'invalid-token' }))
    })

    const code = await closed
    expect(code).toBe(4003)
    expect(bridge.isConnected()).toBe(false)
  })

  it('fires status listener on 0→1 and 1→0 transitions only', async () => {
    const listener = vi.fn()
    bridge.setStatusListener(listener)

    // First connection: 0→1, should fire true
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    expect(listener).toHaveBeenCalledWith(true)
    expect(listener).toHaveBeenCalledTimes(1)

    // Second connection: 1→2, should NOT fire
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')
    expect(listener).toHaveBeenCalledTimes(1)

    // First disconnects: 2→1, should NOT fire
    const closedA = new Promise<void>((resolve) => {
      wsA.addEventListener('close', () => resolve())
    })
    wsA.close()
    await closedA
    await new Promise((r) => setTimeout(r, 100))
    expect(listener).toHaveBeenCalledTimes(1)

    // Last disconnects: 1→0, should fire false
    const closedB = new Promise<void>((resolve) => {
      wsB.addEventListener('close', () => resolve())
    })
    wsB.close()
    await closedB
    await new Promise((r) => setTimeout(r, 100))
    expect(listener).toHaveBeenCalledWith(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('aggregates pendingCount across users', async () => {
    const wsA = await connectAgentAs(testPort, 'token-a', bridge, 'user-a')
    const wsB = await connectAgentAs(testPort, 'token-b', bridge, 'user-b')

    expect(bridge.pendingCount).toBe(0)

    void nextMessage(wsA)
    void nextMessage(wsB)
    const promiseA = bridge.routeToolCall('req-a1', 'tool', {}, 'user-a')
    const promiseB = bridge.routeToolCall('req-b1', 'tool', {}, 'user-b')

    // Small delay for sends to be processed
    await new Promise((r) => setTimeout(r, 50))
    expect(bridge.pendingCount).toBe(2)

    // Resolve one
    wsA.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-a1',
      result: { content: [{ type: 'text', text: 'done' }] },
    }))
    await promiseA
    expect(bridge.pendingCount).toBe(1)

    // Resolve the other so stop() doesn't cause unhandled rejection
    wsB.send(JSON.stringify({
      type: 'tool_result',
      requestId: 'req-b1',
      result: { content: [{ type: 'text', text: 'done' }] },
    }))
    await promiseB
    expect(bridge.pendingCount).toBe(0)

    wsA.close()
    wsB.close()
  })
})

// ---------------------------------------------------------------------------
// DesktopAgentBridge — Clerk JWT Auth
// ---------------------------------------------------------------------------

describe('DesktopAgentBridge Clerk Auth', () => {
  let bridge: DesktopAgentBridge
  const clerkSecretKey = 'sk_test_clerk_secret'
  let mockClerkVerify: ReturnType<typeof vi.fn>

  beforeEach(() => {
    testPort++
    mockClerkVerify = vi.fn()
    bridge = new DesktopAgentBridge({
      port: testPort,
      clerkSecretKey,
      _clerkVerify: mockClerkVerify,
    })
    bridge.start()
  })

  afterEach(async () => {
    await bridge.stop()
  })

  it('throws when clerkSecretKey and token are both set', () => {
    expect(() => new DesktopAgentBridge({
      port: 0,
      token: 'some-token',
      clerkSecretKey: 'sk_test',
    })).toThrow('mutually exclusive')
  })

  it('throws when clerkSecretKey and resolveUserId are both set', () => {
    expect(() => new DesktopAgentBridge({
      port: 0,
      clerkSecretKey: 'sk_test',
      resolveUserId: () => 'user',
    })).toThrow('mutually exclusive')
  })

  it('throws when neither token nor clerkSecretKey is set', () => {
    expect(() => new DesktopAgentBridge({
      port: 0,
    })).toThrow('either token, clerkSecretKey, or resolveUserId')
  })

  it('accepts connection with valid Clerk JWT', async () => {
    mockClerkVerify.mockResolvedValue({
      data: { sub: 'user_clerk_123' },
    })

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
      sock.addEventListener('open', () => {
        sock.send(JSON.stringify({ type: 'auth', clerkToken: 'valid-jwt' }))
        resolve(sock)
      })
      sock.addEventListener('error', (e) => reject(e))
    })

    for (let i = 0; i < 50; i++) {
      if (bridge.isConnected('user_clerk_123')) break
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(bridge.isConnected('user_clerk_123')).toBe(true)
    expect(mockClerkVerify).toHaveBeenCalledWith('valid-jwt', {
      secretKey: clerkSecretKey,
      clockSkewInMs: 5_000,
    })
    ws.close()
  })

  it('rejects connection with invalid Clerk JWT', async () => {
    mockClerkVerify.mockResolvedValue({
      errors: [{ message: 'Token expired' }],
    })

    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', clerkToken: 'expired-jwt' }))
    })

    const code = await closed
    expect(code).toBe(4003)
    expect(bridge.isConnected()).toBe(false)
  })

  it('rejects when verifyToken throws', async () => {
    mockClerkVerify.mockRejectedValue(new Error('Network error'))

    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', clerkToken: 'jwt' }))
    })

    const code = await closed
    expect(code).toBe(4003)
  })

  it('rejects JWT with missing sub claim', async () => {
    mockClerkVerify.mockResolvedValue({
      data: { iss: 'clerk', exp: 123 },
    })

    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', clerkToken: 'jwt-no-sub' }))
    })

    const code = await closed
    expect(code).toBe(4003)
    expect(bridge.isConnected()).toBe(false)
  })

  it('rejects auth message with token field instead of clerkToken in Clerk mode', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (e) => resolve(e.code))
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'some-static-token' }))
    })

    const code = await closed
    expect(code).toBe(4003)
    expect(mockClerkVerify).not.toHaveBeenCalled()
  })

  it('passes clockSkewInMs to verifyToken', async () => {
    await bridge.stop()
    testPort++
    mockClerkVerify = vi.fn().mockResolvedValue({ data: { sub: 'user_1' } })
    bridge = new DesktopAgentBridge({
      port: testPort,
      clerkSecretKey,
      clockSkewInMs: 10_000,
      _clerkVerify: mockClerkVerify,
    })
    bridge.start()

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
      sock.addEventListener('open', () => {
        sock.send(JSON.stringify({ type: 'auth', clerkToken: 'jwt' }))
        resolve(sock)
      })
      sock.addEventListener('error', (e) => reject(e))
    })

    for (let i = 0; i < 50; i++) {
      if (bridge.isConnected()) break
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(mockClerkVerify).toHaveBeenCalledWith('jwt', {
      secretKey: clerkSecretKey,
      clockSkewInMs: 10_000,
    })
    ws.close()
  })

  it('supports multiple Clerk-authenticated users', async () => {
    mockClerkVerify
      .mockResolvedValueOnce({ data: { sub: 'clerk_user_a' } })
      .mockResolvedValueOnce({ data: { sub: 'clerk_user_b' } })

    const wsA = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
      sock.addEventListener('open', () => {
        sock.send(JSON.stringify({ type: 'auth', clerkToken: 'jwt-a' }))
        resolve(sock)
      })
      sock.addEventListener('error', (e) => reject(e))
    })
    for (let i = 0; i < 50; i++) {
      if (bridge.isConnected('clerk_user_a')) break
      await new Promise((r) => setTimeout(r, 10))
    }

    const wsB = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
      sock.addEventListener('open', () => {
        sock.send(JSON.stringify({ type: 'auth', clerkToken: 'jwt-b' }))
        resolve(sock)
      })
      sock.addEventListener('error', (e) => reject(e))
    })
    for (let i = 0; i < 50; i++) {
      if (bridge.isConnected('clerk_user_b')) break
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(bridge.isConnected('clerk_user_a')).toBe(true)
    expect(bridge.isConnected('clerk_user_b')).toBe(true)

    wsA.close()
    wsB.close()
  })
})

// ---------------------------------------------------------------------------
// DesktopAgentBridge — Async resolveUserId
// ---------------------------------------------------------------------------

describe('DesktopAgentBridge with async resolveUserId', () => {
  it('supports async resolveUserId callback', async () => {
    testPort++
    const bridge = new DesktopAgentBridge({
      port: testPort,
      resolveUserId: async (t) => {
        await new Promise((r) => setTimeout(r, 10))
        return t === 'async-token' ? 'async-user' : null
      },
    })
    bridge.start()

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${String(testPort)}`)
      sock.addEventListener('open', () => {
        sock.send(JSON.stringify({ type: 'auth', token: 'async-token' }))
        resolve(sock)
      })
      sock.addEventListener('error', (e) => reject(e))
    })

    for (let i = 0; i < 50; i++) {
      if (bridge.isConnected('async-user')) break
      await new Promise((r) => setTimeout(r, 10))
    }

    expect(bridge.isConnected('async-user')).toBe(true)
    ws.close()
    await bridge.stop()
  })
})
