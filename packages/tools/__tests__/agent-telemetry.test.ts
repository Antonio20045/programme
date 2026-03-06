import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch, assertNoInnerHTML } from './helpers'
import type { DbPool } from '../src/types'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/agent-telemetry.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-42'
const AGENT_ID = 'research-bot-abc123'

function makeMockPool(): DbPool & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  emitEvent,
  trackAgentStarted,
  trackAgentCompleted,
  trackAgentFailed,
  trackBudgetExceeded,
  trackTrustChanged,
  getAgentStats,
  cleanupOldEvents,
} from '../src/agent-telemetry'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockPool: ReturnType<typeof makeMockPool>

beforeEach(() => {
  vi.clearAllMocks()
  mockPool = makeMockPool()
})

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe('Security', () => {
  it('contains no code-execution patterns', () => {
    assertNoEval(sourceCode)
  })

  it('contains no inner' + 'HTML patterns', () => {
    assertNoInnerHTML(sourceCode)
  })

  it('contains no unauthorized fetch calls', () => {
    assertNoUnauthorizedFetch(sourceCode, [])
  })
})

// ---------------------------------------------------------------------------
// emitEvent
// ---------------------------------------------------------------------------

describe('emitEvent', () => {
  it('inserts event into agent_events table', async () => {
    await emitEvent(mockPool, USER_ID, AGENT_ID, 'agent.started', { task: 'test' })

    expect(mockPool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockPool.query.mock.calls[0]!
    expect(sql).toContain('INSERT INTO agent_events')
    expect(params).toEqual([USER_ID, AGENT_ID, 'agent.started', JSON.stringify({ task: 'test' })])
  })

  it('does not throw on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('connection refused'))

    // Must not throw
    await expect(emitEvent(mockPool, USER_ID, AGENT_ID, 'agent.started')).resolves.toBeUndefined()
  })

  it('uses empty metadata when not provided', async () => {
    await emitEvent(mockPool, USER_ID, AGENT_ID, 'agent.completed')

    const [, params] = mockPool.query.mock.calls[0]!
    expect(params![3]).toBe('{}')
  })
})

// ---------------------------------------------------------------------------
// Typed convenience functions
// ---------------------------------------------------------------------------

describe('trackAgentStarted', () => {
  it('emits agent.started event with truncated task', () => {
    const longTask = 'x'.repeat(1000)
    trackAgentStarted(mockPool, USER_ID, AGENT_ID, longTask)

    // Fire-and-forget — wait a tick for the void promise
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockPool.query).toHaveBeenCalledTimes(1)
        const [, params] = mockPool.query.mock.calls[0]!
        const metadata = JSON.parse(params![3] as string) as Record<string, unknown>
        expect((metadata['task'] as string).length).toBe(500)
        resolve()
      }, 0)
    })
  })
})

describe('trackAgentCompleted', () => {
  it('emits agent.completed event with usage stats', () => {
    trackAgentCompleted(mockPool, USER_ID, AGENT_ID, 5, 1000, 500)

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockPool.query).toHaveBeenCalledTimes(1)
        const [, params] = mockPool.query.mock.calls[0]!
        expect(params![2]).toBe('agent.completed')
        const metadata = JSON.parse(params![3] as string) as Record<string, unknown>
        expect(metadata['toolCalls']).toBe(5)
        expect(metadata['inputTokens']).toBe(1000)
        expect(metadata['outputTokens']).toBe(500)
        resolve()
      }, 0)
    })
  })
})

describe('trackAgentFailed', () => {
  it('emits agent.failed event with truncated reason', () => {
    trackAgentFailed(mockPool, USER_ID, AGENT_ID, 'r'.repeat(1000))

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const [, params] = mockPool.query.mock.calls[0]!
        const metadata = JSON.parse(params![3] as string) as Record<string, unknown>
        expect((metadata['reason'] as string).length).toBe(500)
        resolve()
      }, 0)
    })
  })
})

describe('trackBudgetExceeded', () => {
  it('emits budget.exceeded event', () => {
    trackBudgetExceeded(mockPool, USER_ID, AGENT_ID)

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockPool.query).toHaveBeenCalledTimes(1)
        const [, params] = mockPool.query.mock.calls[0]!
        expect(params![2]).toBe('budget.exceeded')
        resolve()
      }, 0)
    })
  })
})

describe('trackTrustChanged', () => {
  it('emits trust.changed event with change details', () => {
    trackTrustChanged(mockPool, USER_ID, AGENT_ID, 'promoted', 'intern', 'junior')

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const [, params] = mockPool.query.mock.calls[0]!
        expect(params![2]).toBe('trust.changed')
        const metadata = JSON.parse(params![3] as string) as Record<string, unknown>
        expect(metadata['changeResult']).toBe('promoted')
        expect(metadata['from']).toBe('intern')
        expect(metadata['to']).toBe('junior')
        resolve()
      }, 0)
    })
  })

  it('uses null for missing from/to', () => {
    trackTrustChanged(mockPool, USER_ID, AGENT_ID, 'unchanged')

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const [, params] = mockPool.query.mock.calls[0]!
        const metadata = JSON.parse(params![3] as string) as Record<string, unknown>
        expect(metadata['from']).toBeNull()
        expect(metadata['to']).toBeNull()
        resolve()
      }, 0)
    })
  })
})

// ---------------------------------------------------------------------------
// getAgentStats
// ---------------------------------------------------------------------------

describe('getAgentStats', () => {
  it('returns aggregated stats from DB', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        total: '10',
        started: '4',
        completed: '3',
        failed: '1',
        budget_exceeded: '1',
        trust_changed: '1',
      }],
    })

    const stats = await getAgentStats(mockPool, USER_ID, AGENT_ID, 7)

    expect(stats).toEqual({
      totalEvents: 10,
      started: 4,
      completed: 3,
      failed: 1,
      budgetExceeded: 1,
      trustChanged: 1,
    })
    expect(mockPool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockPool.query.mock.calls[0]!
    expect(sql).toContain('agent_events')
    expect(params).toEqual([USER_ID, AGENT_ID, 7])
  })

  it('returns zero stats on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('DB down'))

    const stats = await getAgentStats(mockPool, USER_ID, AGENT_ID)

    expect(stats.totalEvents).toBe(0)
    expect(stats.started).toBe(0)
    expect(stats.completed).toBe(0)
    expect(stats.failed).toBe(0)
  })

  it('returns zero stats when no rows returned', async () => {
    mockPool.query.mockResolvedValue({ rows: [{}] })

    const stats = await getAgentStats(mockPool, USER_ID, AGENT_ID)

    expect(stats.totalEvents).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// cleanupOldEvents
// ---------------------------------------------------------------------------

describe('cleanupOldEvents', () => {
  it('deletes old events and returns count', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })

    const count = await cleanupOldEvents(mockPool, 90)

    expect(count).toBe(3)
    const [sql, params] = mockPool.query.mock.calls[0]!
    expect(sql).toContain('DELETE FROM agent_events')
    expect(params).toEqual([90])
  })

  it('returns 0 on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('DB error'))

    const count = await cleanupOldEvents(mockPool)

    expect(count).toBe(0)
  })

  it('uses default 90 days when no argument provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] })

    await cleanupOldEvents(mockPool)

    const [, params] = mockPool.query.mock.calls[0]!
    expect(params).toEqual([90])
  })
})
