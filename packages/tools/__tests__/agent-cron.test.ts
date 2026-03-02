import { vi, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/agent-cron.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — agent-registry
// ---------------------------------------------------------------------------

const mockGetAgent = vi.fn()
const mockGetScheduledAgents = vi.fn()
const mockGetAllUserIds = vi.fn()

vi.mock('../src/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  getScheduledAgents: (...args: unknown[]) => mockGetScheduledAgents(...args),
  getAllUserIds: (...args: unknown[]) => mockGetAllUserIds(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-executor
// ---------------------------------------------------------------------------

const mockExecuteAgent = vi.fn()

vi.mock('../src/agent-executor', () => ({
  executeAgent: (...args: unknown[]) => mockExecuteAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — budget-controller
// ---------------------------------------------------------------------------

const mockCheckBudget = vi.fn()
const mockRecordUsage = vi.fn()
const mockResetExpired = vi.fn()

vi.mock('../src/budget-controller', () => ({
  checkBudget: (...args: unknown[]) => mockCheckBudget(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  resetExpired: (...args: unknown[]) => mockResetExpired(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — pending-approvals
// ---------------------------------------------------------------------------

const mockStoreProposal = vi.fn()
const mockCleanupExpiredProposals = vi.fn()

vi.mock('../src/pending-approvals', () => ({
  storeProposal: (...args: unknown[]) => mockStoreProposal(...args),
  cleanupExpired: (...args: unknown[]) => mockCleanupExpiredProposals(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-lifecycle
// ---------------------------------------------------------------------------

const mockHandlePostExecution = vi.fn()
const mockRunLifecycleCheck = vi.fn()
const mockRunMemoryCleanup = vi.fn()

vi.mock('../src/agent-lifecycle', () => ({
  handlePostExecution: (...args: unknown[]) => mockHandlePostExecution(...args),
  runLifecycleCheck: (...args: unknown[]) => mockRunLifecycleCheck(...args),
  runMemoryCleanup: (...args: unknown[]) => mockRunMemoryCleanup(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  initAgentCron,
  stopAgentCron,
  registerAgentCronJob,
  unregisterAgentCronJob,
  registerAllAgentCronJobs,
  registerLifecycleCron,
  fieldMatches,
  cronMatchesNow,
  tick,
  _testOnly,
} from '../src/agent-cron'
import type { DbPool } from '../src/types'
import type { AgentResult, LlmClient } from '../src/agent-executor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockPool: DbPool = { query: vi.fn() }
const mockLlmClient: LlmClient = {
  chat: vi.fn(async () => ({
    stop_reason: 'end_turn' as const,
    content: [{ type: 'text' as const, text: 'done' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  })),
}
const mockOnResult = vi.fn(async () => undefined)

function makeAgentDef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-agent-abc123',
    userId: 'user-42',
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'You are helpful',
    tools: ['web-search'],
    model: 'haiku',
    riskProfile: 'read-only',
    maxSteps: 5,
    maxTokens: 4096,
    timeoutMs: 30000,
    memoryNamespace: 'agent-test-agent-abc123',
    cronSchedule: '0 9 * * *',
    cronTask: 'Check for new emails',
    retention: 'persistent',
    status: 'active',
    trustLevel: 'intern',
    trustMetrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSuccessResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    status: 'success',
    output: 'Task completed.',
    toolCalls: 2,
    pendingActions: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  stopAgentCron()

  // Defaults
  mockGetAgent.mockResolvedValue(makeAgentDef())
  mockGetScheduledAgents.mockResolvedValue([])
  mockGetAllUserIds.mockResolvedValue([])
  mockExecuteAgent.mockResolvedValue(makeSuccessResult())
  mockCheckBudget.mockResolvedValue({ allowed: true, today: { inputTokens: 0, outputTokens: 0, toolCalls: 0 }, limits: {}, remaining: {} })
  mockRecordUsage.mockResolvedValue(undefined)
  mockResetExpired.mockResolvedValue(0)
  mockHandlePostExecution.mockResolvedValue({ action: 'none' })
  mockRunLifecycleCheck.mockResolvedValue({ dormant: [], archived: [], deleted: [], notifications: [] })
  mockRunMemoryCleanup.mockResolvedValue(0)
})

afterEach(() => {
  stopAgentCron()
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
// fieldMatches
// ===========================================================================

describe('fieldMatches', () => {
  it('matches wildcard *', () => {
    expect(fieldMatches('*', 0)).toBe(true)
    expect(fieldMatches('*', 59)).toBe(true)
  })

  it('matches step pattern */N', () => {
    expect(fieldMatches('*/15', 0)).toBe(true)
    expect(fieldMatches('*/15', 15)).toBe(true)
    expect(fieldMatches('*/15', 30)).toBe(true)
    expect(fieldMatches('*/15', 7)).toBe(false)
  })

  it('matches single value', () => {
    expect(fieldMatches('5', 5)).toBe(true)
    expect(fieldMatches('5', 6)).toBe(false)
  })

  it('matches range N-M', () => {
    expect(fieldMatches('1-5', 1)).toBe(true)
    expect(fieldMatches('1-5', 3)).toBe(true)
    expect(fieldMatches('1-5', 5)).toBe(true)
    expect(fieldMatches('1-5', 0)).toBe(false)
    expect(fieldMatches('1-5', 6)).toBe(false)
  })

  it('matches comma-separated list', () => {
    expect(fieldMatches('0,15,30,45', 0)).toBe(true)
    expect(fieldMatches('0,15,30,45', 15)).toBe(true)
    expect(fieldMatches('0,15,30,45', 10)).toBe(false)
  })

  it('matches range with step N-M/S', () => {
    expect(fieldMatches('0-30/10', 0)).toBe(true)
    expect(fieldMatches('0-30/10', 10)).toBe(true)
    expect(fieldMatches('0-30/10', 20)).toBe(true)
    expect(fieldMatches('0-30/10', 30)).toBe(true)
    expect(fieldMatches('0-30/10', 5)).toBe(false)
    expect(fieldMatches('0-30/10', 40)).toBe(false)
  })
})

// ===========================================================================
// cronMatchesNow
// ===========================================================================

describe('cronMatchesNow', () => {
  it('matches every-minute cron', () => {
    const now = new Date('2026-03-01T09:30:00Z')
    expect(cronMatchesNow('* * * * *', now)).toBe(true)
  })

  it('matches specific time', () => {
    // 2026-03-01 is a Sunday (dow=0), March (month=3), day 1
    const now = new Date('2026-03-01T09:00:00Z')
    expect(cronMatchesNow('0 9 * * *', now)).toBe(true)
    expect(cronMatchesNow('0 10 * * *', now)).toBe(false)
  })

  it('matches day-of-week', () => {
    const monday = new Date('2026-03-02T09:00:00Z') // Monday = dow 1
    expect(cronMatchesNow('0 9 * * 1-5', monday)).toBe(true)

    const sunday = new Date('2026-03-01T09:00:00Z') // Sunday = dow 0
    expect(cronMatchesNow('0 9 * * 1-5', sunday)).toBe(false)
  })

  it('rejects invalid expression', () => {
    expect(cronMatchesNow('not valid', new Date())).toBe(false)
    expect(cronMatchesNow('* * *', new Date())).toBe(false)
  })

  it('matches monthly cron', () => {
    const now = new Date('2026-03-01T00:00:00Z')
    expect(cronMatchesNow('0 0 1 * *', now)).toBe(true)
    const notFirst = new Date('2026-03-02T00:00:00Z')
    expect(cronMatchesNow('0 0 1 * *', notFirst)).toBe(false)
  })
})

// ===========================================================================
// Job Registration
// ===========================================================================

describe('registration', () => {
  it('registers and unregisters agent cron jobs', () => {
    registerAgentCronJob('agent-1', 'user-1', '0 9 * * *')
    expect(_testOnly.getJobs().has('agent-1')).toBe(true)

    unregisterAgentCronJob('agent-1')
    expect(_testOnly.getJobs().has('agent-1')).toBe(false)
  })

  it('registerAllAgentCronJobs loads from DB', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })

    mockGetScheduledAgents.mockResolvedValue([
      makeAgentDef({ id: 'a1', userId: 'u1', cronSchedule: '0 9 * * *' }),
      makeAgentDef({ id: 'a2', userId: 'u2', cronSchedule: '*/30 * * * *' }),
    ])

    const count = await registerAllAgentCronJobs()

    expect(count).toBe(2)
    expect(_testOnly.getJobs().has('a1')).toBe(true)
    expect(_testOnly.getJobs().has('a2')).toBe(true)
  })

  it('throws if not initialized', async () => {
    await expect(registerAllAgentCronJobs()).rejects.toThrow('not initialized')
  })
})

// ===========================================================================
// Tick — Agent Execution
// ===========================================================================

describe('tick — agent execution', () => {
  it('executes agent when cron matches', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })

    // Set time to 09:00 UTC
    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)

    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    expect(mockGetAgent).toHaveBeenCalledWith(mockPool, 'user-42', 'agent-1')
    expect(mockCheckBudget).toHaveBeenCalledWith(mockPool, 'agent-1', 'user-42')
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1)
    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(mockHandlePostExecution).toHaveBeenCalledTimes(1)
    expect(mockOnResult).toHaveBeenCalledTimes(1)
  })

  it('uses cronTask for execution task', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    mockGetAgent.mockResolvedValue(makeAgentDef({ cronTask: 'Check emails' }))

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    const taskArg = mockExecuteAgent.mock.calls[0]![0] as Record<string, unknown>
    expect(taskArg['task']).toBe('Check emails')
  })

  it('falls back to description when cronTask is null', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    mockGetAgent.mockResolvedValue(makeAgentDef({ cronTask: null, description: 'My agent purpose' }))

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    const taskArg = mockExecuteAgent.mock.calls[0]![0] as Record<string, unknown>
    expect(taskArg['task']).toBe('My agent purpose')
  })

  it('skips when budget exhausted', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    mockCheckBudget.mockResolvedValue({ allowed: false })

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('unregisters and skips when agent no longer active', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    mockGetAgent.mockResolvedValue(makeAgentDef({ status: 'dormant' }))

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    expect(mockExecuteAgent).not.toHaveBeenCalled()
    expect(_testOnly.getJobs().has('agent-1')).toBe(false)
  })

  it('unregisters when agent not found', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    mockGetAgent.mockResolvedValue(null)

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    expect(_testOnly.getJobs().has('agent-1')).toBe(false)
  })

  it('unregisters ephemeral agent after post-execution delete', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    mockHandlePostExecution.mockResolvedValue({ action: 'deleted', message: 'Removed.' })

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    expect(_testOnly.getJobs().has('agent-1')).toBe(false)
  })

  it('stores proposals for needs-approval results', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    const pendingActions = [
      { id: 'p1', toolName: 'gmail', params: { action: 'send' }, riskTier: 3 as const, description: 'send email' },
    ]
    mockExecuteAgent.mockResolvedValue(makeSuccessResult({
      status: 'needs-approval',
      pendingActions,
    }))

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()

    expect(mockStoreProposal).toHaveBeenCalledWith(pendingActions[0], 'agent-1')
  })
})

// ===========================================================================
// Anti-Double-Fire
// ===========================================================================

describe('anti-double-fire', () => {
  it('does not fire same job twice in the same minute', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })

    const now = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(now)
    registerAgentCronJob('agent-1', 'user-42', '0 9 * * *')

    await tick()
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1)

    // Tick again in same minute
    await tick()
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1)
  })

  it('fires again in the next matching minute', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })

    const t1 = new Date('2026-03-02T09:00:00Z')
    vi.setSystemTime(t1)
    registerAgentCronJob('agent-1', 'user-42', '* * * * *')

    await tick()
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1)

    // Advance 1 minute
    const t2 = new Date('2026-03-02T09:01:00Z')
    vi.setSystemTime(t2)

    await tick()
    expect(mockExecuteAgent).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// Lifecycle Cron
// ===========================================================================

describe('lifecycle cron', () => {
  it('registers lifecycle cron job', () => {
    registerLifecycleCron()
    expect(_testOnly.getJobs().has('__lifecycle__')).toBe(true)
  })

  it('executes lifecycle at 03:00 UTC', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    registerLifecycleCron()

    mockGetAllUserIds.mockResolvedValue(['user-1', 'user-2'])

    const now = new Date('2026-03-02T03:00:00Z')
    vi.setSystemTime(now)

    await tick()

    expect(mockGetAllUserIds).toHaveBeenCalledWith(mockPool)
    expect(mockRunLifecycleCheck).toHaveBeenCalledTimes(2)
    expect(mockRunLifecycleCheck).toHaveBeenCalledWith(mockPool, 'user-1')
    expect(mockRunLifecycleCheck).toHaveBeenCalledWith(mockPool, 'user-2')
    expect(mockRunMemoryCleanup).toHaveBeenCalledWith(mockPool)
    expect(mockResetExpired).toHaveBeenCalledWith(mockPool)
    expect(mockCleanupExpiredProposals).toHaveBeenCalled()
  })

  it('unregisters cron jobs for affected agents', async () => {
    initAgentCron({ pool: mockPool, llmClient: mockLlmClient, onResult: mockOnResult })
    registerLifecycleCron()
    registerAgentCronJob('dormant-agent', 'user-1', '0 9 * * *')

    mockGetAllUserIds.mockResolvedValue(['user-1'])
    mockRunLifecycleCheck.mockResolvedValue({
      dormant: ['dormant-agent'],
      archived: [],
      deleted: [],
      notifications: [],
    })

    const now = new Date('2026-03-02T03:00:00Z')
    vi.setSystemTime(now)

    await tick()

    expect(_testOnly.getJobs().has('dormant-agent')).toBe(false)
  })
})
