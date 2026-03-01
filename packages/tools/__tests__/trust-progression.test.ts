import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbPool } from '../src/types'
import {
  updateTrustMetrics,
  checkAndApplyPromotion,
  DEMOTION_MIN_TASKS,
} from '../src/agent-registry'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/agent-registry.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }
const USER_A = 'user-a-uuid'
const AGENT_ID = 'test-agent-abc123'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeAgentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AGENT_ID,
    user_id: USER_A,
    name: 'Test Agent',
    description: 'A test agent',
    system_prompt: 'You are helpful',
    tools: ['web-search', 'notes'],
    model: 'haiku',
    risk_profile: 'read-only',
    max_steps: 5,
    max_tokens: 4096,
    timeout_ms: 30000,
    memory_namespace: 'agent-test-agent-abc123',
    cron_schedule: null,
    status: 'active',
    trust_level: 'intern',
    trust_metrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usage_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Creates a date string N days before now. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// updateTrustMetrics
// ---------------------------------------------------------------------------

describe('updateTrustMetrics', () => {
  it('SQL contains jsonb_set and totalTasks', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ trust_metrics: { totalTasks: 1, successfulTasks: 1, userOverrides: 0, promotedAt: null } }],
    })

    await updateTrustMetrics(mockPool, USER_A, AGENT_ID, { success: true, overridden: false })

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('jsonb_set')
    expect(sql).toContain('totalTasks')
  })

  it('increments successfulTasks when success is true', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ trust_metrics: { totalTasks: 1, successfulTasks: 1, userOverrides: 0, promotedAt: null } }],
    })

    await updateTrustMetrics(mockPool, USER_A, AGENT_ID, { success: true, overridden: false })

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[2]).toBe(1) // successInc
  })

  it('increments userOverrides when overridden is true', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ trust_metrics: { totalTasks: 1, successfulTasks: 0, userOverrides: 1, promotedAt: null } }],
    })

    await updateTrustMetrics(mockPool, USER_A, AGENT_ID, { success: false, overridden: true })

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[3]).toBe(1) // overrideInc
  })

  it('throws when agent not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      updateTrustMetrics(mockPool, USER_A, 'nonexistent', { success: true, overridden: false }),
    ).rejects.toThrow('not found')
  })

  it('scopes query by userId', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ trust_metrics: { totalTasks: 1, successfulTasks: 1, userOverrides: 0, promotedAt: null } }],
    })

    await updateTrustMetrics(mockPool, USER_A, AGENT_ID, { success: true, overridden: false })

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })

  it('uses parameterized SQL (no userId/agentId in SQL string)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ trust_metrics: { totalTasks: 1, successfulTasks: 1, userOverrides: 0, promotedAt: null } }],
    })

    await updateTrustMetrics(mockPool, USER_A, AGENT_ID, { success: true, overridden: false })

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
    expect(sql).toContain('$3')
    expect(sql).toContain('$4')
    expect(sql).not.toContain(USER_A)
    expect(sql).not.toContain(AGENT_ID)
  })
})

// ---------------------------------------------------------------------------
// checkAndApplyPromotion
// ---------------------------------------------------------------------------

describe('checkAndApplyPromotion', () => {
  it('intern + 20 tasks + 95% success + >14d → promoted to junior', async () => {
    // getAgent call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 20, successfulTasks: 19, userOverrides: 0, promotedAt: null },
        created_at: daysAgo(15),
      })],
    })
    // updateAgent call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ trust_level: 'junior' })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'promoted', from: 'intern', to: 'junior' })
  })

  it('intern + 15 tasks → unchanged (too few tasks)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 15, successfulTasks: 15, userOverrides: 0, promotedAt: null },
        created_at: daysAgo(30),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('intern + 20 tasks + 80% success → unchanged (success too low)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 20, successfulTasks: 16, userOverrides: 0, promotedAt: null },
        created_at: daysAgo(30),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('intern + <14 days old → unchanged (too young)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 20, successfulTasks: 20, userOverrides: 0, promotedAt: null },
        created_at: daysAgo(10),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('junior + 50 tasks + 96% success + 5% override → promoted to senior', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'junior',
        trust_metrics: { totalTasks: 100, successfulTasks: 96, userOverrides: 5, promotedAt: null },
        created_at: daysAgo(60),
      })],
    })
    // updateAgent call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ trust_level: 'senior' })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'promoted', from: 'junior', to: 'senior' })
  })

  it('senior + 20% override rate → demoted to junior', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'senior',
        trust_metrics: { totalTasks: 100, successfulTasks: 80, userOverrides: 20, promotedAt: null },
        created_at: daysAgo(90),
      })],
    })
    // updateAgent call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ trust_level: 'junior' })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'demoted', from: 'senior', to: 'junior' })
  })

  it('junior + 20% override rate → demoted to intern', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'junior',
        trust_metrics: { totalTasks: 100, successfulTasks: 80, userOverrides: 20, promotedAt: null },
        created_at: daysAgo(60),
      })],
    })
    // updateAgent call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ trust_level: 'intern' })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'demoted', from: 'junior', to: 'intern' })
  })

  it('intern + high override rate → unchanged (cannot go lower)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 50, successfulTasks: 30, userOverrides: 20, promotedAt: null },
        created_at: daysAgo(30),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('demotion takes priority over promotion', async () => {
    // Junior with enough tasks and success for senior promotion,
    // but override rate > 15% → demotion wins
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'junior',
        trust_metrics: { totalTasks: 100, successfulTasks: 96, userOverrides: 16, promotedAt: null },
        created_at: daysAgo(60),
      })],
    })
    // updateAgent call (demotion)
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ trust_level: 'intern' })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'demoted', from: 'junior', to: 'intern' })
  })

  it('boundary: exactly 90% success → NOT promoted (strict >)', async () => {
    // 18/20 = 0.90 exactly — should NOT trigger promotion (requires > 0.90)
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 20, successfulTasks: 18, userOverrides: 0, promotedAt: null },
        created_at: daysAgo(30),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('boundary: exactly 15% override → NOT demoted (strict >)', async () => {
    // 3/20 = 0.15 exactly — should NOT trigger demotion (requires > 0.15)
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'senior',
        trust_metrics: { totalTasks: 20, successfulTasks: 17, userOverrides: 3, promotedAt: null },
        created_at: daysAgo(60),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('totalTasks=0 → unchanged (division-by-zero guard)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        trust_level: 'intern',
        trust_metrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
        created_at: daysAgo(30),
      })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'unchanged' })
  })

  it('dormant agent can still be evaluated (no status guard)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({
        status: 'dormant',
        trust_level: 'junior',
        trust_metrics: { totalTasks: 100, successfulTasks: 96, userOverrides: 5, promotedAt: null },
        created_at: daysAgo(60),
      })],
    })
    // updateAgent call
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ trust_level: 'senior' })],
    })

    const result = await checkAndApplyPromotion(mockPool, USER_A, AGENT_ID)

    expect(result).toEqual({ result: 'promoted', from: 'junior', to: 'senior' })
  })

  it('throws for non-existent agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      checkAndApplyPromotion(mockPool, USER_A, 'nonexistent'),
    ).rejects.toThrow('not found')
  })

  it('scopes getAgent query by userId', async () => {
    const OTHER_USER = 'user-b-uuid'
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await checkAndApplyPromotion(mockPool, OTHER_USER, AGENT_ID).catch(() => {})

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(OTHER_USER)
  })
})

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no ev' + 'al or dynamic code execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('UpdateAgentInput does not export trustLevel or trustMetrics fields', () => {
    // Verify the exported interface does not allow direct trust level manipulation.
    // The InternalUpdateAgentInput (non-exported) extends it with those fields.
    // We match the FIRST occurrence: "interface UpdateAgentInput {" (without "extends")
    const lines = SOURCE_CODE.split('\n')
    const startIdx = lines.findIndex(l => l.includes('interface UpdateAgentInput {') && !l.includes('extends'))
    expect(startIdx).toBeGreaterThan(-1)
    // Collect lines until closing brace
    const bodyLines: string[] = []
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i]!.trim() === '}') break
      bodyLines.push(lines[i]!)
    }
    const body = bodyLines.join('\n')
    expect(body).not.toContain('trustLevel')
    expect(body).not.toContain('trustMetrics')
  })

  it('InternalUpdateAgentInput is not exported', () => {
    // The internal type must not appear in the export block
    const exportBlock = SOURCE_CODE.match(/export\s*\{[\s\S]*?\}/g)
    expect(exportBlock).not.toBeNull()
    const allExports = exportBlock!.join('\n')
    expect(allExports).not.toContain('InternalUpdateAgentInput')
  })
})

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

describe('exports', () => {
  it('DEMOTION_MIN_TASKS is exported and has correct value', () => {
    expect(DEMOTION_MIN_TASKS).toBe(20)
  })
})
