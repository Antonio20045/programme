/**
 * Tests for the ConfirmationManager, createConfirmableTools, and DesktopAgentBridge.
 * Located in tools/__tests__/ because packages/gateway/** is excluded from root vitest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConfirmationManager,
  createConfirmableTools,
  DesktopAgentBridge,
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

  it('auto-executes when no emitter is set', async () => {
    const decision = await manager.requestConfirmation('tc-1', 'shell', { command: 'ls' })
    expect(decision.decision).toBe('execute')
    expect(manager.pendingCount).toBe(0)
  })

  it('emits tool_confirm SSE event when requesting confirmation', () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    // Don't await — it will pend
    void manager.requestConfirmation('tc-1', 'shell', { command: 'ls' })

    expect(emitFn).toHaveBeenCalledWith('sess-1', {
      type: 'tool_confirm',
      data: { toolCallId: 'tc-1', toolName: 'shell', params: { command: 'ls' } },
    })
    expect(manager.pendingCount).toBe(1)
  })

  it('resolves pending confirmation with execute', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    const promise = manager.requestConfirmation('tc-1', 'shell', { command: 'ls' })

    const resolved = manager.resolveConfirmation('tc-1', { decision: 'execute' })
    expect(resolved).toBe(true)

    const decision = await promise
    expect(decision.decision).toBe('execute')
    expect(manager.pendingCount).toBe(0)
  })

  it('resolves pending confirmation with reject', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    const promise = manager.requestConfirmation('tc-2', 'gmail', { to: 'a@b.com' })

    manager.resolveConfirmation('tc-2', { decision: 'reject' })

    const decision = await promise
    expect(decision.decision).toBe('reject')
  })

  it('passes modifiedParams through', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    const promise = manager.requestConfirmation('tc-3', 'shell', { command: 'rm' })

    manager.resolveConfirmation('tc-3', {
      decision: 'execute',
      modifiedParams: { command: 'echo safe' },
    })

    const decision = await promise
    expect(decision.modifiedParams).toEqual({ command: 'echo safe' })
  })

  it('returns false when resolving unknown toolCallId', () => {
    const result = manager.resolveConfirmation('unknown', { decision: 'execute' })
    expect(result).toBe(false)
  })

  it('auto-rejects after timeout', async () => {
    vi.useFakeTimers()

    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    const promise = manager.requestConfirmation('tc-timeout', 'shell', { command: 'test' })

    // Advance time by 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000)

    const decision = await promise
    expect(decision.decision).toBe('reject')
    expect(manager.pendingCount).toBe(0)

    vi.useRealTimers()
  })

  it('auto-executes when no active session is set', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    // activeSessionId is null by default — no setActiveSession call
    const decision = await manager.requestConfirmation('tc-4', 'shell', {})
    expect(decision.decision).toBe('execute')
    expect(emitFn).not.toHaveBeenCalled()
  })

  it('destroy rejects all pending', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    const p1 = manager.requestConfirmation('tc-d1', 'shell', {})
    const p2 = manager.requestConfirmation('tc-d2', 'gmail', {})

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
    manager.setActiveSession('sess-1')

    const tool = makeTool({
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager)

    // Start execution (will wait for confirmation)
    const executePromise = wrapped!.execute('tc-1', { command: 'ls' })

    // Confirm
    manager.resolveConfirmation('tc-1', { decision: 'execute' })

    const result = await executePromise
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(tool.execute).toHaveBeenCalledWith('tc-1', { command: 'ls' }, undefined)
  })

  it('returns rejection result when user rejects', async () => {
    const emitFn = vi.fn()
    manager.setEmitter(emitFn)
    manager.setActiveSession('sess-1')

    const tool = makeTool({
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager)

    const executePromise = wrapped!.execute('tc-2', { command: 'rm -rf /' })

    manager.resolveConfirmation('tc-2', { decision: 'reject' })

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
    manager.setActiveSession('sess-1')

    const tool = makeTool({
      name: 'shell',
      requiresConfirmation: true,
    })
    const [wrapped] = createConfirmableTools([tool], manager)

    const executePromise = wrapped!.execute('tc-3', { command: 'rm' })

    manager.resolveConfirmation('tc-3', {
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
    manager.setActiveSession('sess-1')
    const [wrapped] = createConfirmableTools([tool], manager, bridge)

    const msgPromise = nextMessage(ws)
    const execPromise = wrapped!.execute('tc-cd1', { command: 'ls' })

    // First: confirm
    manager.resolveConfirmation('tc-cd1', { decision: 'execute' })

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

