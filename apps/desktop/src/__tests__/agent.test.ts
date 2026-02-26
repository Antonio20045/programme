/**
 * Tests for the DesktopAgent WebSocket client.
 * Uses DesktopAgentBridge as the server side (the real counterpart).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DesktopAgentBridge } from '../../../../packages/gateway/tool-router'
import { DesktopAgent } from '../main/agent'
import type { GetTokenFn } from '../main/agent'
import { registerTool, _resetRegistry } from '@ki-assistent/tools'
import type { ExtendedAgentTool } from '@ki-assistent/tools'

// ─── Helpers ─────────────────────────────────────────────────

let testPort = 29_500
const TOKEN = 'agent-test-token'
const staticToken: GetTokenFn = () => ({ kind: 'static', value: TOKEN })

function makeTool(overrides?: Partial<ExtendedAgentTool>): ExtendedAgentTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    permissions: [],
    requiresConfirmation: false,
    runsOn: 'desktop',
    execute: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'tool-result' }],
    })),
    ...overrides,
  }
}

/** Wait until bridge reports connected. */
async function waitForConnection(bridge: DesktopAgentBridge, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (bridge.isConnected()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('Agent did not connect in time')
}

// ─── Tests ───────────────────────────────────────────────────

describe('DesktopAgent', () => {
  let bridge: DesktopAgentBridge
  let agent: DesktopAgent

  beforeEach(() => {
    testPort++
    _resetRegistry()
    bridge = new DesktopAgentBridge({ port: testPort, token: TOKEN })
    bridge.start()
    agent = new DesktopAgent(`ws://127.0.0.1:${String(testPort)}`, staticToken)
  })

  afterEach(async () => {
    agent.disconnect()
    await bridge.stop()
    _resetRegistry()
  })

  it('connects and authenticates with the bridge', async () => {
    agent.connect()
    await waitForConnection(bridge)

    expect(bridge.isConnected()).toBe(true)
    expect(agent.getStatus()).toBe('connected')
  })

  it('calls onConnect callback', async () => {
    const onConnect = vi.fn()
    agent.onConnect = onConnect

    agent.connect()
    await waitForConnection(bridge)

    expect(onConnect).toHaveBeenCalled()
  })

  it('executes a known tool via bridge routing', async () => {
    const tool = makeTool({ name: 'filesystem' })
    registerTool(tool)

    agent.connect()
    await waitForConnection(bridge)

    const result = await bridge.routeToolCall('req-1', 'filesystem', { path: '/tmp' })
    expect(result.content[0]).toEqual({ type: 'text', text: 'tool-result' })
    expect(tool.execute).toHaveBeenCalledWith({ path: '/tmp' })
  })

  it('returns tool_error for unknown tool', async () => {
    agent.connect()
    await waitForConnection(bridge)

    const result = await bridge.routeToolCall('req-2', 'nonexistent', {})
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toContain('nonexistent')
    }
  })

  it('returns tool_error when tool throws', async () => {
    registerTool(makeTool({
      name: 'broken-tool',
      execute: vi.fn(async () => {
        throw new Error('Boom')
      }),
    }))

    agent.connect()
    await waitForConnection(bridge)

    const result = await bridge.routeToolCall('req-3', 'broken-tool', {})
    const text = result.content[0]
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      const parsed = JSON.parse(text.text) as { error: boolean; reason: string }
      expect(parsed.error).toBe(true)
      expect(parsed.reason).toBe('Boom')
    }
  })

  it('responds to heartbeat pings', async () => {
    // Use short heartbeat interval to test pong responses
    await bridge.stop()
    bridge = new DesktopAgentBridge({
      port: testPort,
      token: TOKEN,
      heartbeatIntervalMs: 100,
      maxMissedPongs: 5, // high so it doesn't disconnect
    })
    bridge.start()

    agent.connect()
    await waitForConnection(bridge)

    // Wait for a few heartbeat cycles — if agent doesn't pong, bridge would disconnect
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(bridge.isConnected()).toBe(true)
  })

  it('disconnect prevents reconnect', async () => {
    agent.connect()
    await waitForConnection(bridge)

    agent.disconnect()
    expect(agent.getStatus()).toBe('disconnected')

    // Wait — should NOT reconnect
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(agent.getStatus()).toBe('disconnected')
  })

  it('reconnects after server-side disconnect', async () => {
    agent.connect()
    await waitForConnection(bridge)

    // Stop bridge (simulates server disconnect)
    await bridge.stop()

    // Restart bridge on same port — agent should reconnect
    bridge = new DesktopAgentBridge({ port: testPort, token: TOKEN })
    bridge.start()

    await waitForConnection(bridge, 10_000)
    expect(bridge.isConnected()).toBe(true)
    expect(agent.getStatus()).toBe('connected')
  }, 15_000)

  it('calls onDisconnect callback', async () => {
    const onDisconnect = vi.fn()
    agent.onDisconnect = onDisconnect

    agent.connect()
    await waitForConnection(bridge)

    // Stop bridge to trigger disconnect
    await bridge.stop()

    // Wait for close event to propagate
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(onDisconnect).toHaveBeenCalled()

    // Restart bridge so afterEach cleanup works
    bridge = new DesktopAgentBridge({ port: testPort, token: TOKEN })
    bridge.start()
  })

  it('fetches fresh token on reconnect', async () => {
    const TOKEN_V2 = 'refreshed-token'
    let callCount = 0
    const getToken: GetTokenFn = () => {
      callCount++
      // Return original token on first connect, new token on reconnect
      const value = callCount === 1 ? TOKEN : TOKEN_V2
      return { kind: 'static', value }
    }

    agent.disconnect() // disconnect the beforeEach agent
    agent = new DesktopAgent(`ws://127.0.0.1:${String(testPort)}`, getToken)
    agent.connect()
    await waitForConnection(bridge)
    expect(callCount).toBe(1)

    // Stop bridge to trigger reconnect
    await bridge.stop()

    // Restart bridge accepting both tokens (use resolveUserId for flexible auth)
    bridge = new DesktopAgentBridge({
      port: testPort,
      resolveUserId: (tok) => (tok === TOKEN || tok === TOKEN_V2 ? 'user-1' : null),
    })
    bridge.start()

    await waitForConnection(bridge, 10_000)
    expect(callCount).toBe(2)
    expect(bridge.isConnected()).toBe(true)
  }, 15_000)

  it('sends clerkToken field for clerk auth mode', async () => {
    const CLERK_JWT = 'eyJhbGciOiJSUzI1NiJ9.test-jwt'
    const clerkToken: GetTokenFn = () => ({ kind: 'clerk', value: CLERK_JWT })

    // Use a custom bridge with _clerkVerify to accept any JWT
    await bridge.stop()
    bridge = new DesktopAgentBridge({
      port: testPort,
      clerkSecretKey: 'sk_test_fake',
      _clerkVerify: async () => ({ data: { sub: 'user_clerk_123' } }),
    })
    bridge.start()

    agent.disconnect()
    agent = new DesktopAgent(`ws://127.0.0.1:${String(testPort)}`, clerkToken)
    agent.connect()
    await waitForConnection(bridge)

    expect(bridge.isConnected()).toBe(true)
    expect(agent.getStatus()).toBe('connected')
  })
})
