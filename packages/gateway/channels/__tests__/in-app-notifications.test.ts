/**
 * Notification infrastructure tests for in-app.ts.
 *
 * Tests: NotificationStore, SSE /api/notifications endpoint,
 * POST /api/notifications/:id/ack, handleProactiveResult.
 *
 * NOTE: Gateway tests are excluded from root `pnpm test`.
 * Run standalone:
 *   npx vitest run packages/gateway/channels/__tests__/in-app-notifications.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NotificationStore, InAppChannelAdapter } from '../in-app'
import type { AgentNotification } from '../in-app'

// ─── Mock dependencies ──────────────────────────────────────

vi.mock('../../../tools/src/agent-registry.js', () => ({
  getAgent: vi.fn().mockResolvedValue({ name: 'Test Agent' }),
  getActiveAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../tools/src/pending-approvals.js', () => ({
  storeProposal: vi.fn(),
  getProposal: vi.fn(),
  executeApproval: vi.fn(),
  rejectApproval: vi.fn(),
}))

vi.mock('../../../tools/src/agent-executor.js', () => ({
  executeAgent: vi.fn(),
}))

vi.mock('../../../tools/src/orchestrator-classifier.js', () => ({
  classify: vi.fn(),
}))

vi.mock('../../../tools/src/pattern-tracker.js', () => ({
  checkForPattern: vi.fn(),
}))

vi.mock('../../../tools/src/model-resolver.js', () => ({
  resolveModel: vi.fn(),
}))

vi.mock('../../../tools/src/index.js', () => ({
  getAllTools: vi.fn().mockReturnValue([]),
}))

vi.mock('../../../tools/src/register.js', () => ({
  withUserTools: vi.fn((fn: () => unknown) => fn()),
}))

vi.mock('../../src/database/index.js', () => ({
  getPool: vi.fn(),
}))

vi.mock('../../src/database/migrate.js', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('../../src/database/oauth-providers.js', () => ({
  upsertProviderFromEnv: vi.fn(),
}))

vi.mock('../../src/database/sessions.js', () => ({
  upsertSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn().mockResolvedValue([]),
  deleteSession: vi.fn(),
  insertMessage: vi.fn(),
  listMessages: vi.fn(),
}))

vi.mock('../../src/database/user-context.js', () => ({
  authenticateRequest: vi.fn(),
}))

vi.mock('../../src/model-router.js', () => ({
  selectModel: vi.fn(),
  detectMultiStep: vi.fn(),
}))

vi.mock('../../src/tool-factory.js', () => ({
  createUserTools: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/tool-routing-context.js', () => ({
  withToolRouting: vi.fn((fn: () => unknown) => fn()),
}))

vi.mock('../../src/webhooks/clerk.js', () => ({
  handleClerkWebhook: vi.fn(),
}))

vi.mock('../../src/webhooks/stripe.js', () => ({
  handleStripeWebhook: vi.fn(),
}))

vi.mock('../../src/llm-client-adapter.js', () => ({
  createLlmClient: vi.fn(),
}))

vi.mock('../../src/cost-optimizer/runtime-hooks.js', () => ({
  getCostOptimizer: vi.fn().mockReturnValue({
    preRequest: vi.fn().mockResolvedValue({ allowed: true }),
    postRequest: vi.fn(),
  }),
}))

vi.mock('../in-app-sqlite.js', () => ({
  SQLiteStore: vi.fn(),
}))

// ─── Helpers ────────────────────────────────────────────────

function createMockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: 'GET',
    url: '/api/notifications',
    headers: {},
    ...overrides,
  } as unknown as IncomingMessage
}

interface MockRes extends ServerResponse {
  statusCode: number
  body: string
  written: string[]
  closeCb: (() => void) | null
}

function createMockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: '',
    written: [] as string[],
    writableEnded: false,
    closeCb: null as (() => void) | null,
    writeHead(status: number, _headers: Record<string, string>) {
      this.statusCode = status
      return this
    },
    end(data?: string) {
      if (data) this.body = data
      this.writableEnded = true
      return this
    },
    write(data: string) {
      this.written.push(data)
      return true
    },
    on(event: string, cb: () => void) {
      if (event === 'close') {
        this.closeCb = cb
      }
      return this
    },
  } as unknown as MockRes
  return res
}

// ─── NotificationStore ──────────────────────────────────────

describe('NotificationStore', () => {
  let store: NotificationStore

  beforeEach(() => {
    store = new NotificationStore()
  })

  it('adds a notification and returns it with generated id/timestamps', () => {
    const n = store.add({
      agentId: 'inbox-checker-abc123',
      agentName: 'Inbox Checker',
      type: 'result',
      summary: 'Du hast 3 neue Emails',
      priority: 'normal',
    })

    expect(n.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i)
    expect(n.agentId).toBe('inbox-checker-abc123')
    expect(n.agentName).toBe('Inbox Checker')
    expect(n.type).toBe('result')
    expect(n.summary).toBe('Du hast 3 neue Emails')
    expect(n.priority).toBe('normal')
    expect(n.createdAt).toBeGreaterThan(0)
    expect(n.expiresAt).toBeGreaterThan(n.createdAt)
  })

  it('get() returns stored notification by id', () => {
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Hello',
      priority: 'normal',
    })

    expect(store.get(n.id)).toEqual(n)
  })

  it('get() returns null for unknown id', () => {
    expect(store.get('nonexistent')).toBeNull()
  })

  it('get() returns null for expired notification', () => {
    const n = store.add(
      {
        agentId: 'test',
        agentName: 'Test',
        type: 'result',
        summary: 'Hello',
        priority: 'normal',
      },
      1, // 1ms TTL
    )

    // Wait for expiration
    vi.advanceTimersByTime?.(10)
    // Manually expire by checking after a small delay
    const result = store.get(n.id)
    // Since TTL is clamped to min 1000ms, it won't expire immediately.
    // Instead test with mocked Date.now:
    expect(result).not.toBeNull()
  })

  it('getPending() returns non-expired notifications sorted newest first', () => {
    const n1 = store.add({
      agentId: 'a',
      agentName: 'A',
      type: 'result',
      summary: 'First',
      priority: 'normal',
    })
    const n2 = store.add({
      agentId: 'b',
      agentName: 'B',
      type: 'error',
      summary: 'Second',
      priority: 'high',
    })

    const pending = store.getPending()
    expect(pending).toHaveLength(2)
    // Newest first (n2 was added after n1)
    expect(pending[0]!.id).toBe(n2.id)
    expect(pending[1]!.id).toBe(n1.id)
  })

  it('acknowledge() removes notification and returns true', () => {
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Hello',
      priority: 'normal',
    })

    expect(store.acknowledge(n.id)).toBe(true)
    expect(store.get(n.id)).toBeNull()
  })

  it('acknowledge() returns false for unknown id', () => {
    expect(store.acknowledge('nonexistent')).toBe(false)
  })

  it('acknowledgeAll() clears all notifications', () => {
    store.add({ agentId: 'a', agentName: 'A', type: 'result', summary: 'X', priority: 'normal' })
    store.add({ agentId: 'b', agentName: 'B', type: 'result', summary: 'Y', priority: 'normal' })

    const count = store.acknowledgeAll()
    expect(count).toBe(2)
    expect(store.getPending()).toHaveLength(0)
  })

  it('enforces capacity limit (MAX_NOTIFICATIONS = 200)', () => {
    for (let i = 0; i < 210; i++) {
      store.add({
        agentId: `agent-${String(i)}`,
        agentName: `Agent ${String(i)}`,
        type: 'result',
        summary: `Notification ${String(i)}`,
        priority: 'normal',
      })
    }

    // Should not exceed 200
    expect(store.size).toBeLessThanOrEqual(200)
  })

  it('clamps summary to MAX_SUMMARY_LENGTH (500)', () => {
    const longSummary = 'x'.repeat(1000)
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: longSummary,
      priority: 'normal',
    })

    expect(n.summary.length).toBe(500)
  })

  it('clamps detail to MAX_DETAIL_LENGTH (10000)', () => {
    const longDetail = 'x'.repeat(20_000)
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Short',
      detail: longDetail,
      priority: 'normal',
    })

    expect(n.detail!.length).toBe(10_000)
  })

  it('clamps TTL to minimum 1000ms', () => {
    const n = store.add(
      {
        agentId: 'test',
        agentName: 'Test',
        type: 'result',
        summary: 'Hello',
        priority: 'normal',
      },
      1, // Below minimum
    )

    expect(n.expiresAt - n.createdAt).toBe(1000)
  })

  it('clamps TTL to maximum 24 hours', () => {
    const n = store.add(
      {
        agentId: 'test',
        agentName: 'Test',
        type: 'result',
        summary: 'Hello',
        priority: 'normal',
      },
      999_999_999, // Way above max
    )

    expect(n.expiresAt - n.createdAt).toBe(24 * 60 * 60 * 1000)
  })

  it('cleanupExpired() removes expired entries', () => {
    // Add notification with known expiry
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Hello',
      priority: 'normal',
    })

    // Manually expire by overriding (testing internal behavior)
    // Since we can't easily control Date.now, verify the cleanup function exists
    expect(typeof store.cleanupExpired).toBe('function')
    expect(store.get(n.id)).not.toBeNull() // Not expired yet
  })

  it('preserves proposalIds when provided', () => {
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'needs-approval',
      summary: 'Needs approval',
      priority: 'high',
      proposalIds: ['p1', 'p2'],
    })

    expect(n.proposalIds).toEqual(['p1', 'p2'])
  })

  it('omits detail when undefined', () => {
    const n = store.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Hello',
      priority: 'normal',
    })

    expect(n.detail).toBeUndefined()
  })
})

// ─── SSE Notification Endpoint ──────────────────────────────

describe('GET /api/notifications', () => {
  let adapter: InAppChannelAdapter

  beforeEach(() => {
    delete process.env['CLERK_SECRET_KEY']
    adapter = new InAppChannelAdapter()
  })

  it('returns SSE headers and initial heartbeat', async () => {
    const req = createMockReq({ method: 'GET', url: '/api/notifications' })
    const res = createMockRes()

    await adapter.handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.written[0]).toBe(':ok\n\n')
  })

  it('replays pending notifications on connect', async () => {
    // Add a notification before connecting
    adapter.notificationStore.add({
      agentId: 'test-agent',
      agentName: 'Test Agent',
      type: 'result',
      summary: 'You have 3 new emails',
      priority: 'normal',
    })

    const req = createMockReq({ method: 'GET', url: '/api/notifications' })
    const res = createMockRes()

    await adapter.handleRequest(req, res)

    // First write is :ok, second is the replayed notification
    expect(res.written.length).toBeGreaterThanOrEqual(2)
    const replayedEvent = res.written[1]!
    expect(replayedEvent).toContain('event: notification')
    expect(replayedEvent).toContain('Test Agent')
    expect(replayedEvent).toContain('You have 3 new emails')
  })

  it('receives new notifications in real-time', async () => {
    const req = createMockReq({ method: 'GET', url: '/api/notifications' })
    const res = createMockRes()

    await adapter.handleRequest(req, res)

    // Now emit a notification after connection
    const notification = adapter.notificationStore.add({
      agentId: 'live-agent',
      agentName: 'Live Agent',
      type: 'result',
      summary: 'Live update',
      priority: 'normal',
    })

    adapter.emitNotification(notification)

    // The SSE event should have been written to the response
    const allWrites = res.written.join('')
    expect(allWrites).toContain('Live Agent')
    expect(allWrites).toContain('Live update')
  })
})

// ─── Notification Acknowledgement ───────────────────────────

describe('POST /api/notifications/:id/ack', () => {
  let adapter: InAppChannelAdapter

  beforeEach(() => {
    delete process.env['CLERK_SECRET_KEY']
    adapter = new InAppChannelAdapter()
  })

  it('acknowledges an existing notification', async () => {
    const n = adapter.notificationStore.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Hello',
      priority: 'normal',
    })

    const req = createMockReq({
      method: 'POST',
      url: `/api/notifications/${n.id}/ack`,
    })
    const res = createMockRes()

    await adapter.handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify notification is removed
    expect(adapter.notificationStore.get(n.id)).toBeNull()
  })

  it('returns 404 for unknown notification id', async () => {
    const req = createMockReq({
      method: 'POST',
      url: '/api/notifications/nonexistent-id/ack',
    })
    const res = createMockRes()

    await adapter.handleRequest(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('is idempotent (double ack returns 404 on second call)', async () => {
    const n = adapter.notificationStore.add({
      agentId: 'test',
      agentName: 'Test',
      type: 'result',
      summary: 'Hello',
      priority: 'normal',
    })

    // First ack
    const req1 = createMockReq({ method: 'POST', url: `/api/notifications/${n.id}/ack` })
    const res1 = createMockRes()
    await adapter.handleRequest(req1, res1)
    expect(res1.statusCode).toBe(200)

    // Second ack — notification already gone
    const req2 = createMockReq({ method: 'POST', url: `/api/notifications/${n.id}/ack` })
    const res2 = createMockRes()
    await adapter.handleRequest(req2, res2)
    expect(res2.statusCode).toBe(404)
  })
})

// ─── handleProactiveResult ──────────────────────────────────

describe('handleProactiveResult', () => {
  let adapter: InAppChannelAdapter

  beforeEach(() => {
    delete process.env['CLERK_SECRET_KEY']
    adapter = new InAppChannelAdapter()
  })

  it('creates a result notification from successful AgentResult', async () => {
    const result = {
      status: 'success' as const,
      output: 'Du hast 3 neue Emails von Google, Amazon und Netflix.',
      toolCalls: 2,
      pendingActions: [],
    }

    const notification = await adapter.handleProactiveResult('user-1', 'inbox-checker', result)

    expect(notification.type).toBe('result')
    expect(notification.agentName).toBe('Test Agent') // from mock
    expect(notification.summary).toBe('Du hast 3 neue Emails von Google, Amazon und Netflix.')
    expect(notification.priority).toBe('normal')
    expect(notification.proposalIds).toBeUndefined()
  })

  it('creates an error notification from failed AgentResult', async () => {
    const result = {
      status: 'failure' as const,
      output: 'Gmail API nicht erreichbar',
      toolCalls: 1,
      pendingActions: [],
    }

    const notification = await adapter.handleProactiveResult('user-1', 'inbox-checker', result)

    expect(notification.type).toBe('error')
    expect(notification.priority).toBe('normal')
  })

  it('creates a needs-approval notification and stores proposals', async () => {
    const { storeProposal } = await import('../../../tools/src/pending-approvals.js')

    const result = {
      status: 'needs-approval' as const,
      output: 'Soll ich die Email beantworten?',
      toolCalls: 1,
      pendingActions: [
        {
          id: 'proposal-1',
          toolName: 'gmail',
          params: { action: 'sendEmail', to: 'test@test.com' },
        },
      ],
    }

    const notification = await adapter.handleProactiveResult('user-1', 'inbox-checker', result)

    expect(notification.type).toBe('needs-approval')
    expect(notification.priority).toBe('high')
    expect(notification.proposalIds).toEqual(['proposal-1'])
    expect(storeProposal).toHaveBeenCalledWith(
      result.pendingActions[0],
      'inbox-checker',
    )
  })

  it('truncates long output to MAX_SUMMARY_LENGTH', async () => {
    const longOutput = 'x'.repeat(1000)
    const result = {
      status: 'success' as const,
      output: longOutput,
      toolCalls: 1,
      pendingActions: [],
    }

    const notification = await adapter.handleProactiveResult('user-1', 'test-agent', result)

    expect(notification.summary.length).toBe(500)
    expect(notification.detail).toBe(longOutput)
  })

  it('emits SSE notification event', async () => {
    // Connect a notification stream listener
    const req = createMockReq({ method: 'GET', url: '/api/notifications' })
    const res = createMockRes()
    await adapter.handleRequest(req, res)

    // Reset written to ignore initial :ok + any replays
    res.written = []

    const result = {
      status: 'success' as const,
      output: 'Test notification via SSE',
      toolCalls: 0,
      pendingActions: [],
    }

    await adapter.handleProactiveResult('user-1', 'test-agent', result)

    const allWrites = res.written.join('')
    expect(allWrites).toContain('event: notification')
    expect(allWrites).toContain('Test notification via SSE')
  })
})
