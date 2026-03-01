import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

import {
  checkBudget,
  recordUsage,
  getDailyStats,
  resetExpired,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_TOOL_CALLS,
} from '../src/budget-controller'
import type { DbPool } from '../src/types'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/budget-controller.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const AGENT_ID = 'helper-abc123'
const USER_ID = 'user-test-uuid'

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }

beforeEach(() => {
  vi.clearAllMocks()
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

  it('uses parameterized queries (no string interpolation in SQL)', () => {
    // Ensure SQL uses $1, $2 etc. — no template literals or concatenation with variables
    const sqlStatements = SOURCE_CODE.match(/pool\.query\(\s*`[^`]+`/g) ?? []
    for (const stmt of sqlStatements) {
      expect(stmt).toMatch(/\$\d/)
    }
    // No string interpolation in SQL (${...})
    const templateInterpolations = SOURCE_CODE.match(/pool\.query\(\s*`[^`]*\$\{[^`]*`/g)
    expect(templateInterpolations).toBeNull()
  })

  it('uses make_interval instead of string-concatenation for INTERVAL', () => {
    // Ensure no ($N || ' days')::INTERVAL pattern — use make_interval(days => $N::int)
    const concatInterval = SOURCE_CODE.match(/\|\|\s*['"].*days['"].*::INTERVAL/gi)
    expect(concatInterval).toBeNull()
  })

  it('validates all inputs before querying', () => {
    // Every public function with agentId should call validateAgentId
    expect(SOURCE_CODE).toContain('validateAgentId(agentId)')
    expect(SOURCE_CODE).toContain('validateUserId(userId)')
    expect(SOURCE_CODE).toContain('validateUsageInput(usage)')
    expect(SOURCE_CODE).toContain('validatePositiveInteger(days')
    expect(SOURCE_CODE).toContain('validatePositiveInteger(maxAgeDays')
  })
})

// ===========================================================================
// checkBudget
// ===========================================================================

describe('checkBudget', () => {
  it('returns allowed: true when under all limits', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ input_tokens: 5000, output_tokens: 2000, tool_calls: 5 }],
    })

    const status = await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(status.allowed).toBe(true)
    expect(status.today).toEqual({ inputTokens: 5000, outputTokens: 2000, toolCalls: 5 })
    expect(status.remaining).toEqual({
      inputTokens: DEFAULT_MAX_INPUT_TOKENS - 5000,
      outputTokens: DEFAULT_MAX_OUTPUT_TOKENS - 2000,
      toolCalls: DEFAULT_MAX_TOOL_CALLS - 5,
    })
  })

  it('returns allowed: true when no row exists (first call of the day)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const status = await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(status.allowed).toBe(true)
    expect(status.today).toEqual({ inputTokens: 0, outputTokens: 0, toolCalls: 0 })
    expect(status.remaining).toEqual({
      inputTokens: DEFAULT_MAX_INPUT_TOKENS,
      outputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      toolCalls: DEFAULT_MAX_TOOL_CALLS,
    })
  })

  it('returns allowed: false when input tokens at limit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ input_tokens: 100_000, output_tokens: 0, tool_calls: 0 }],
    })

    const status = await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(status.allowed).toBe(false)
    expect(status.remaining.inputTokens).toBe(0)
  })

  it('returns allowed: false when output tokens at limit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ input_tokens: 0, output_tokens: 50_000, tool_calls: 0 }],
    })

    const status = await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(status.allowed).toBe(false)
    expect(status.remaining.outputTokens).toBe(0)
  })

  it('returns allowed: false when tool calls at limit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ input_tokens: 0, output_tokens: 0, tool_calls: 100 }],
    })

    const status = await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(status.allowed).toBe(false)
    expect(status.remaining.toolCalls).toBe(0)
  })

  it('uses parameterized query with agentId and userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
    expect(params).toEqual([AGENT_ID, USER_ID])
  })

  it('exposes correct default limits', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const status = await checkBudget(mockPool, AGENT_ID, USER_ID)

    expect(status.limits).toEqual({
      maxInputTokens: 100_000,
      maxOutputTokens: 50_000,
      maxToolCalls: 100,
    })
  })
})

// ===========================================================================
// recordUsage
// ===========================================================================

describe('recordUsage', () => {
  it('executes upsert query with correct parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await recordUsage(mockPool, AGENT_ID, USER_ID, {
      inputTokens: 1500,
      outputTokens: 800,
      toolCalls: 3,
    })

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ON CONFLICT')
    expect(sql).toContain('EXCLUDED')
    expect(params).toEqual([AGENT_ID, USER_ID, 1500, 800, 3])
  })

  it('can be called multiple times (additive upsert)', async () => {
    mockQuery.mockResolvedValue({ rows: [] })

    await recordUsage(mockPool, AGENT_ID, USER_ID, {
      inputTokens: 1000,
      outputTokens: 500,
      toolCalls: 2,
    })
    await recordUsage(mockPool, AGENT_ID, USER_ID, {
      inputTokens: 2000,
      outputTokens: 1000,
      toolCalls: 1,
    })

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery.mock.calls[0]![1]).toEqual([AGENT_ID, USER_ID, 1000, 500, 2])
    expect(mockQuery.mock.calls[1]![1]).toEqual([AGENT_ID, USER_ID, 2000, 1000, 1])
  })
})

// ===========================================================================
// getDailyStats
// ===========================================================================

describe('getDailyStats', () => {
  it('returns correctly mapped rows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { budget_date: '2026-03-01', input_tokens: 5000, output_tokens: 2000, tool_calls: 10 },
        { budget_date: '2026-02-28', input_tokens: 3000, output_tokens: 1000, tool_calls: 5 },
      ],
    })

    const stats = await getDailyStats(mockPool, AGENT_ID, USER_ID)

    expect(stats).toHaveLength(2)
    expect(stats[0]).toEqual({
      date: '2026-03-01',
      inputTokens: 5000,
      outputTokens: 2000,
      toolCalls: 10,
    })
    expect(stats[1]).toEqual({
      date: '2026-02-28',
      inputTokens: 3000,
      outputTokens: 1000,
      toolCalls: 5,
    })
  })

  it('returns empty array when no data', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const stats = await getDailyStats(mockPool, AGENT_ID, USER_ID)

    expect(stats).toEqual([])
  })

  it('defaults to 7 days', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getDailyStats(mockPool, AGENT_ID, USER_ID)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toContain(7)
  })

  it('accepts custom days parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getDailyStats(mockPool, AGENT_ID, USER_ID, 14)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toContain(14)
  })
})

// ===========================================================================
// resetExpired
// ===========================================================================

describe('resetExpired', () => {
  it('deletes old records and returns count', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ agent_id: 'a' }, { agent_id: 'b' }],
    })

    const count = await resetExpired(mockPool)

    expect(count).toBe(2)
  })

  it('returns 0 when nothing to delete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const count = await resetExpired(mockPool)

    expect(count).toBe(0)
  })

  it('defaults to 30 days', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await resetExpired(mockPool)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toContain(30)
  })

  it('accepts custom maxAgeDays', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await resetExpired(mockPool, 60)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toContain(60)
  })

  it('rejects zero maxAgeDays', async () => {
    await expect(resetExpired(mockPool, 0)).rejects.toThrow('Invalid maxAgeDays')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects negative maxAgeDays', async () => {
    await expect(resetExpired(mockPool, -5)).rejects.toThrow('Invalid maxAgeDays')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects non-integer maxAgeDays', async () => {
    await expect(resetExpired(mockPool, 1.5)).rejects.toThrow('Invalid maxAgeDays')
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Input validation
// ===========================================================================

describe('input validation', () => {
  it('rejects empty agentId in checkBudget', async () => {
    await expect(checkBudget(mockPool, '', USER_ID)).rejects.toThrow('Invalid agentId')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects invalid agentId format (uppercase)', async () => {
    await expect(checkBudget(mockPool, 'INVALID', USER_ID)).rejects.toThrow('Invalid agentId')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects empty userId in checkBudget', async () => {
    await expect(checkBudget(mockPool, AGENT_ID, '')).rejects.toThrow('Invalid userId')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects negative inputTokens in recordUsage', async () => {
    await expect(
      recordUsage(mockPool, AGENT_ID, USER_ID, { inputTokens: -1, outputTokens: 0, toolCalls: 0 }),
    ).rejects.toThrow('Invalid inputTokens')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects negative outputTokens in recordUsage', async () => {
    await expect(
      recordUsage(mockPool, AGENT_ID, USER_ID, { inputTokens: 0, outputTokens: -100, toolCalls: 0 }),
    ).rejects.toThrow('Invalid outputTokens')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects negative toolCalls in recordUsage', async () => {
    await expect(
      recordUsage(mockPool, AGENT_ID, USER_ID, { inputTokens: 0, outputTokens: 0, toolCalls: -1 }),
    ).rejects.toThrow('Invalid toolCalls')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects non-integer usage values', async () => {
    await expect(
      recordUsage(mockPool, AGENT_ID, USER_ID, { inputTokens: 1.5, outputTokens: 0, toolCalls: 0 }),
    ).rejects.toThrow('Invalid inputTokens')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects zero days in getDailyStats', async () => {
    await expect(getDailyStats(mockPool, AGENT_ID, USER_ID, 0)).rejects.toThrow('Invalid days')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects negative days in getDailyStats', async () => {
    await expect(getDailyStats(mockPool, AGENT_ID, USER_ID, -7)).rejects.toThrow('Invalid days')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects float days in getDailyStats', async () => {
    await expect(getDailyStats(mockPool, AGENT_ID, USER_ID, 7.5)).rejects.toThrow('Invalid days')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('accepts zero usage values (no-op recording)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await recordUsage(mockPool, AGENT_ID, USER_ID, { inputTokens: 0, outputTokens: 0, toolCalls: 0 })

    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
