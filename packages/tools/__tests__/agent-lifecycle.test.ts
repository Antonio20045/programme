import { vi, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/agent-lifecycle.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — agent-registry
// ---------------------------------------------------------------------------

const mockGetUserAgents = vi.fn()
const mockUpdateStatus = vi.fn()
const mockDeleteAgent = vi.fn()
const mockTouchAgent = vi.fn()
const mockGetAgent = vi.fn()
const mockUpdateAgent = vi.fn()

vi.mock('../src/agent-registry', () => ({
  getUserAgents: (...args: unknown[]) => mockGetUserAgents(...args),
  updateStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  deleteAgent: (...args: unknown[]) => mockDeleteAgent(...args),
  touchAgent: (...args: unknown[]) => mockTouchAgent(...args),
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-memory
// ---------------------------------------------------------------------------

const mockDeleteNamespace = vi.fn()
const mockGetByCategory = vi.fn()
const mockDeleteKey = vi.fn()
const mockCleanupExpired = vi.fn()
const mockCleanupStaleCache = vi.fn()

vi.mock('../src/agent-memory', () => ({
  deleteNamespace: (...args: unknown[]) => mockDeleteNamespace(...args),
  getByCategory: (...args: unknown[]) => mockGetByCategory(...args),
  deleteKey: (...args: unknown[]) => mockDeleteKey(...args),
  cleanupExpired: (...args: unknown[]) => mockCleanupExpired(...args),
  cleanupStaleCache: (...args: unknown[]) => mockCleanupStaleCache(...args),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  runLifecycleCheck,
  reactivateAgent,
  runMemoryCleanup,
  handlePostExecution,
} from '../src/agent-lifecycle'
import type { DbPool } from '../src/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOW = new Date('2026-03-01T00:00:00Z')
const USER_ID = 'user-test-uuid'
const mockPool: DbPool = { query: vi.fn() }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString()
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-abc123',
    userId: USER_ID,
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'You are helpful',
    tools: ['web-search'],
    model: 'haiku',
    riskProfile: 'read-only' as const,
    maxSteps: 5,
    maxTokens: 4096,
    timeoutMs: 30000,
    memoryNamespace: 'agent-abc123',
    cronSchedule: null,
    cronTask: null,
    retention: 'persistent' as const,
    status: 'active' as const,
    trustLevel: 'intern' as const,
    trustMetrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: NOW.toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()

  // Defaults
  mockGetUserAgents.mockResolvedValue([])
  mockUpdateStatus.mockResolvedValue(undefined)
  mockDeleteAgent.mockResolvedValue(undefined)
  mockTouchAgent.mockResolvedValue(undefined)
  mockUpdateAgent.mockResolvedValue(makeAgent())
  mockDeleteNamespace.mockResolvedValue(undefined)
  mockGetByCategory.mockResolvedValue([])
  mockDeleteKey.mockResolvedValue(undefined)
  mockCleanupExpired.mockResolvedValue(0)
  mockCleanupStaleCache.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

// ===========================================================================
// Security
// ===========================================================================

describe('security', () => {
  it('contains no eval or code-execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('contains no unauthorized fetch calls', () => {
    assertNoUnauthorizedFetch(SOURCE_CODE, [])
  })
})

// ===========================================================================
// runLifecycleCheck
// ===========================================================================

describe('runLifecycleCheck', () => {
  it('returns empty report when no agents exist', async () => {
    mockGetUserAgents.mockResolvedValue([])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.dormant).toEqual([])
    expect(report.archived).toEqual([])
    expect(report.deleted).toEqual([])
    expect(report.notifications).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Active → Dormant (> 30 days)
  // -------------------------------------------------------------------------

  it('marks active agent unused for 35 days as dormant', async () => {
    const agent = makeAgent({ id: 'agent-35d', lastUsedAt: daysAgo(35) })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.dormant).toEqual(['agent-35d'])
    expect(mockUpdateStatus).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-35d', 'dormant')
  })

  it('nulls cronSchedule when making agent dormant', async () => {
    const agent = makeAgent({
      id: 'agent-cron',
      lastUsedAt: daysAgo(35),
      cronSchedule: '0 9 * * *',
    })
    mockGetUserAgents.mockResolvedValue([agent])

    await runLifecycleCheck(mockPool, USER_ID)

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      mockPool, USER_ID, 'agent-cron', { cronSchedule: null },
    )
  })

  it('does not null cronSchedule if already null', async () => {
    const agent = makeAgent({ id: 'agent-nocron', lastUsedAt: daysAgo(35), cronSchedule: null })
    mockGetUserAgents.mockResolvedValue([agent])

    await runLifecycleCheck(mockPool, USER_ID)

    expect(mockUpdateAgent).not.toHaveBeenCalled()
  })

  it('does not generate notification for dormant transition', async () => {
    const agent = makeAgent({ id: 'agent-35d', lastUsedAt: daysAgo(35) })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.notifications).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Dormant → Archived (> 90 days)
  // -------------------------------------------------------------------------

  it('archives dormant agent unused for 95 days', async () => {
    const agent = makeAgent({
      id: 'agent-95d',
      status: 'dormant',
      lastUsedAt: daysAgo(95),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.archived).toEqual(['agent-95d'])
    expect(mockUpdateStatus).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-95d', 'archived')
  })

  it('cleans non-preference memory on archival', async () => {
    const agent = makeAgent({
      id: 'agent-95d',
      status: 'dormant',
      lastUsedAt: daysAgo(95),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    // Simulate memory entries in each category
    mockGetByCategory
      .mockResolvedValueOnce([{ key: 'learned-1' }]) // learned
      .mockResolvedValueOnce([{ key: 'state-1' }])   // state
      .mockResolvedValueOnce([{ key: 'cache-1' }])   // cache
      .mockResolvedValueOnce([{ key: 'gen-1' }])     // general

    await runLifecycleCheck(mockPool, USER_ID)

    // Should query all 4 non-preference categories
    expect(mockGetByCategory).toHaveBeenCalledTimes(4)
    expect(mockGetByCategory).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'learned')
    expect(mockGetByCategory).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'state')
    expect(mockGetByCategory).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'cache')
    expect(mockGetByCategory).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'general')

    // Should delete each entry
    expect(mockDeleteKey).toHaveBeenCalledTimes(4)
    expect(mockDeleteKey).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'learned-1')
    expect(mockDeleteKey).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'state-1')
    expect(mockDeleteKey).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'cache-1')
    expect(mockDeleteKey).toHaveBeenCalledWith(mockPool, 'agent-95d', USER_ID, 'gen-1')

    // preference should NOT be touched
    expect(mockGetByCategory).not.toHaveBeenCalledWith(
      mockPool, 'agent-95d', USER_ID, 'preference',
    )
  })

  it('generates notification for archived transition', async () => {
    const agent = makeAgent({
      id: 'agent-95d',
      name: 'My Helper',
      status: 'dormant',
      lastUsedAt: daysAgo(95),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.notifications).toContain('Agent My Helper archiviert. Reaktivierung möglich.')
  })

  it('skips already-archived agent at 95 days', async () => {
    const agent = makeAgent({
      id: 'agent-already',
      status: 'archived',
      lastUsedAt: daysAgo(95),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.archived).toEqual([])
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Archived → Deleted (> 180 days)
  // -------------------------------------------------------------------------

  it('deletes archived agent unused for 185 days', async () => {
    const agent = makeAgent({
      id: 'agent-185d',
      status: 'archived',
      lastUsedAt: daysAgo(185),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.deleted).toEqual(['agent-185d'])
    expect(mockDeleteNamespace).toHaveBeenCalledWith(mockPool, 'agent-185d', USER_ID)
    expect(mockDeleteAgent).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-185d')
  })

  it('generates notification for deleted agent', async () => {
    const agent = makeAgent({
      id: 'agent-185d',
      name: 'Old Agent',
      status: 'archived',
      lastUsedAt: daysAgo(185),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.notifications).toContain('Agent Old Agent wurde entfernt.')
  })

  // -------------------------------------------------------------------------
  // Cascading: 185-day active agent → directly deleted
  // -------------------------------------------------------------------------

  it('deletes 185-day active agent directly without dormant transition', async () => {
    const agent = makeAgent({
      id: 'agent-cascade',
      status: 'active',
      lastUsedAt: daysAgo(185),
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.deleted).toEqual(['agent-cascade'])
    expect(report.dormant).toEqual([])
    expect(report.archived).toEqual([])

    // deleteNamespace + deleteAgent called
    expect(mockDeleteNamespace).toHaveBeenCalledWith(mockPool, 'agent-cascade', USER_ID)
    expect(mockDeleteAgent).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-cascade')

    // updateStatus to 'dormant' was NOT called
    expect(mockUpdateStatus).not.toHaveBeenCalledWith(
      mockPool, USER_ID, 'agent-cascade', 'dormant',
    )
  })

  // -------------------------------------------------------------------------
  // Mixed batch
  // -------------------------------------------------------------------------

  it('handles mixed batch of agents at different ages', async () => {
    const agents = [
      makeAgent({ id: 'fresh', lastUsedAt: daysAgo(5), status: 'active' }),
      makeAgent({ id: 'dormant-35', lastUsedAt: daysAgo(35), status: 'active' }),
      makeAgent({ id: 'archived-95', lastUsedAt: daysAgo(95), status: 'dormant' }),
      makeAgent({ id: 'deleted-185', lastUsedAt: daysAgo(185), status: 'archived' }),
    ]
    mockGetUserAgents.mockResolvedValue(agents)

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.dormant).toEqual(['dormant-35'])
    expect(report.archived).toEqual(['archived-95'])
    expect(report.deleted).toEqual(['deleted-185'])
    expect(report.notifications).toHaveLength(2) // archived + deleted
  })

  // -------------------------------------------------------------------------
  // Edge: agent at exact threshold boundary (not >)
  // -------------------------------------------------------------------------

  it('does not transition agent at exactly 30 days', async () => {
    const agent = makeAgent({ id: 'edge-30', lastUsedAt: daysAgo(30) })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.dormant).toEqual([])
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// reactivateAgent
// ===========================================================================

describe('reactivateAgent', () => {
  it('reactivates dormant agent', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ id: 'agent-d', status: 'dormant' }))

    await reactivateAgent(mockPool, USER_ID, 'agent-d')

    expect(mockUpdateStatus).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-d', 'active')
    expect(mockTouchAgent).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-d')
  })

  it('reactivates archived agent', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ id: 'agent-a', status: 'archived' }))

    await reactivateAgent(mockPool, USER_ID, 'agent-a')

    expect(mockUpdateStatus).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-a', 'active')
    expect(mockTouchAgent).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-a')
  })

  it('throws for already-active agent', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ id: 'agent-x', status: 'active' }))

    await expect(reactivateAgent(mockPool, USER_ID, 'agent-x'))
      .rejects.toThrow('Agent is already active')
  })

  it('throws for non-existent agent', async () => {
    mockGetAgent.mockResolvedValue(null)

    await expect(reactivateAgent(mockPool, USER_ID, 'ghost-agent'))
      .rejects.toThrow('Agent not found')
  })
})

// ===========================================================================
// runMemoryCleanup
// ===========================================================================

describe('runMemoryCleanup', () => {
  it('returns sum of expired + stale cache entries', async () => {
    mockCleanupExpired.mockResolvedValue(12)
    mockCleanupStaleCache.mockResolvedValue(5)

    const total = await runMemoryCleanup(mockPool)

    expect(total).toBe(17)
    expect(mockCleanupExpired).toHaveBeenCalledWith(mockPool)
    expect(mockCleanupStaleCache).toHaveBeenCalledWith(mockPool, 7)
  })

  it('returns 0 when nothing to clean', async () => {
    mockCleanupExpired.mockResolvedValue(0)
    mockCleanupStaleCache.mockResolvedValue(0)

    const total = await runMemoryCleanup(mockPool)

    expect(total).toBe(0)
  })
})

// ===========================================================================
// handlePostExecution
// ===========================================================================

describe('handlePostExecution', () => {
  it('deletes ephemeral agent after success', async () => {
    const result = await handlePostExecution(
      mockPool, USER_ID, 'agent-eph', 'Einmal-Bot', 'ephemeral', 'success',
    )

    expect(result.action).toBe('deleted')
    expect(result.message).toContain('Einmal-Agent')
    expect(result.message).toContain('entfernt')
    expect(mockDeleteNamespace).toHaveBeenCalledWith(mockPool, 'agent-eph', USER_ID)
    expect(mockDeleteAgent).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-eph')
  })

  it('sets seasonal agent to dormant after success', async () => {
    const result = await handlePostExecution(
      mockPool, USER_ID, 'agent-sea', 'Saison-Bot', 'seasonal', 'success',
    )

    expect(result.action).toBe('dormant')
    expect(result.message).toContain('pausiert')
    expect(mockUpdateStatus).toHaveBeenCalledWith(mockPool, USER_ID, 'agent-sea', 'dormant')
  })

  it('does nothing for persistent agent after success', async () => {
    const result = await handlePostExecution(
      mockPool, USER_ID, 'agent-per', 'Dauer-Bot', 'persistent', 'success',
    )

    expect(result.action).toBe('none')
    expect(result.message).toBeUndefined()
    expect(mockDeleteAgent).not.toHaveBeenCalled()
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it('does nothing for ephemeral agent on failure', async () => {
    const result = await handlePostExecution(
      mockPool, USER_ID, 'agent-eph', 'Einmal-Bot', 'ephemeral', 'failure',
    )

    expect(result.action).toBe('none')
    expect(mockDeleteAgent).not.toHaveBeenCalled()
    expect(mockDeleteNamespace).not.toHaveBeenCalled()
  })

  it('does nothing for seasonal agent on failure', async () => {
    const result = await handlePostExecution(
      mockPool, USER_ID, 'agent-sea', 'Saison-Bot', 'seasonal', 'failure',
    )

    expect(result.action).toBe('none')
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Retention-aware Lifecycle
// ===========================================================================

describe('retention-aware lifecycle', () => {
  it('skips ephemeral agents entirely', async () => {
    const agent = makeAgent({
      id: 'eph-agent',
      retention: 'ephemeral',
      lastUsedAt: daysAgo(200),
      status: 'active',
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.deleted).toEqual([])
    expect(report.dormant).toEqual([])
    expect(report.archived).toEqual([])
    expect(mockDeleteAgent).not.toHaveBeenCalled()
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })

  it('seasonal agent at 35 days becomes dormant', async () => {
    const agent = makeAgent({
      id: 'sea-35',
      retention: 'seasonal',
      lastUsedAt: daysAgo(35),
      status: 'active',
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.dormant).toEqual(['sea-35'])
    expect(mockUpdateStatus).toHaveBeenCalledWith(mockPool, USER_ID, 'sea-35', 'dormant')
  })

  it('seasonal agent at 100 days is NOT archived', async () => {
    const agent = makeAgent({
      id: 'sea-100',
      retention: 'seasonal',
      lastUsedAt: daysAgo(100),
      status: 'dormant',
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.archived).toEqual([])
    expect(report.deleted).toEqual([])
  })

  it('seasonal agent at 200 days is NOT deleted', async () => {
    const agent = makeAgent({
      id: 'sea-200',
      retention: 'seasonal',
      lastUsedAt: daysAgo(200),
      status: 'dormant',
    })
    mockGetUserAgents.mockResolvedValue([agent])

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.deleted).toEqual([])
    expect(mockDeleteAgent).not.toHaveBeenCalled()
  })

  it('persistent agent follows full lifecycle unchanged', async () => {
    const agents = [
      makeAgent({ id: 'per-35', retention: 'persistent', lastUsedAt: daysAgo(35), status: 'active' }),
      makeAgent({ id: 'per-95', retention: 'persistent', lastUsedAt: daysAgo(95), status: 'dormant' }),
      makeAgent({ id: 'per-185', retention: 'persistent', lastUsedAt: daysAgo(185), status: 'archived' }),
    ]
    mockGetUserAgents.mockResolvedValue(agents)

    const report = await runLifecycleCheck(mockPool, USER_ID)

    expect(report.dormant).toEqual(['per-35'])
    expect(report.archived).toEqual(['per-95'])
    expect(report.deleted).toEqual(['per-185'])
  })
})
