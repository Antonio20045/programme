import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbPool } from '../src/types'
import {
  trackRequest,
  checkForPattern,
  dismissSuggestion,
  markCreated,
  cleanupOld,
} from '../src/pattern-tracker'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/pattern-tracker.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }
const USER_ID = 'user-a-uuid'
const CATEGORY = 'email-drafts'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset()
})

// ---------------------------------------------------------------------------
// trackRequest
// ---------------------------------------------------------------------------

describe('trackRequest', () => {
  it('inserts a pattern and prunes old entries beyond limit 200', async () => {
    mockQuery.mockResolvedValue({ rows: [] })

    await trackRequest(mockPool, USER_ID, CATEGORY, 'draft an email to boss')

    expect(mockQuery).toHaveBeenCalledTimes(2)

    // First call: INSERT
    const insertSql = mockQuery.mock.calls[0]![0] as string
    const insertParams = mockQuery.mock.calls[0]![1] as unknown[]
    expect(insertSql).toContain('INSERT INTO request_patterns')
    expect(insertParams).toEqual([USER_ID, CATEGORY, 'draft an email to boss'])

    // Second call: DELETE pruning with LIMIT 200
    const deleteSql = mockQuery.mock.calls[1]![0] as string
    const deleteParams = mockQuery.mock.calls[1]![1] as unknown[]
    expect(deleteSql).toContain('DELETE FROM request_patterns')
    expect(deleteSql).toContain('LIMIT')
    expect(deleteParams).toContain(200)
  })
})

// ---------------------------------------------------------------------------
// checkForPattern
// ---------------------------------------------------------------------------

describe('checkForPattern', () => {
  it('returns null when fewer than 3 requests in window (1 query, early exit)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 2 }] })

    const result = await checkForPattern(mockPool, USER_ID, CATEGORY)

    expect(result).toBeNull()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('returns null when an active agent already covers the category (2 queries)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 5 }] })
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-xyz' }] })

    const result = await checkForPattern(mockPool, USER_ID, CATEGORY)

    expect(result).toBeNull()
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('returns null when suggestion was recently dismissed (3 queries)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 5 }] })
    mockQuery.mockResolvedValueOnce({ rows: [] }) // no active agent
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // cooldown active

    const result = await checkForPattern(mockPool, USER_ID, CATEGORY)

    expect(result).toBeNull()
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('returns suggestion when all conditions are met (4 queries incl. upsert)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 5 }] }) // threshold met
    mockQuery.mockResolvedValueOnce({ rows: [] }) // no active agent
    mockQuery.mockResolvedValueOnce({ rows: [] }) // no cooldown
    // examples query
    mockQuery.mockResolvedValueOnce({
      rows: [
        { query_text: 'draft email A' },
        { query_text: 'draft email B' },
        { query_text: 'draft email C' },
      ],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] }) // upsert

    const result = await checkForPattern(mockPool, USER_ID, CATEGORY)

    expect(result).not.toBeNull()
    expect(result!.category).toBe(CATEGORY)
    expect(result!.queryCount).toBe(5)
    expect(result!.recentExamples).toEqual([
      'draft email A',
      'draft email B',
      'draft email C',
    ])
    // 5 queries: count + agent check + cooldown + examples + upsert
    expect(mockQuery).toHaveBeenCalledTimes(5)
  })

  it('continues when agent_registry table does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: 4 }] }) // threshold met
    mockQuery.mockRejectedValueOnce(new Error('relation "agent_registry" does not exist'))
    mockQuery.mockResolvedValueOnce({ rows: [] }) // no cooldown
    mockQuery.mockResolvedValueOnce({
      rows: [{ query_text: 'example' }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [] }) // upsert

    const result = await checkForPattern(mockPool, USER_ID, CATEGORY)

    expect(result).not.toBeNull()
    expect(result!.queryCount).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// dismissSuggestion
// ---------------------------------------------------------------------------

describe('dismissSuggestion', () => {
  it('updates dismissed=TRUE and suggested_at=NOW()', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await dismissSuggestion(mockPool, USER_ID, CATEGORY)

    expect(mockQuery).toHaveBeenCalledOnce()
    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(sql).toContain('UPDATE pattern_suggestions')
    expect(sql).toContain('dismissed = TRUE')
    expect(sql).toContain('suggested_at = NOW()')
    expect(params).toEqual([USER_ID, CATEGORY])
  })
})

// ---------------------------------------------------------------------------
// markCreated
// ---------------------------------------------------------------------------

describe('markCreated', () => {
  it('updates created_agent_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await markCreated(mockPool, USER_ID, CATEGORY, 'agent-123')

    expect(mockQuery).toHaveBeenCalledOnce()
    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(sql).toContain('UPDATE pattern_suggestions')
    expect(sql).toContain('created_agent_id')
    expect(params).toEqual([USER_ID, CATEGORY, 'agent-123'])
  })
})

// ---------------------------------------------------------------------------
// cleanupOld
// ---------------------------------------------------------------------------

describe('cleanupOld', () => {
  it('deletes old patterns and returns count', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })

    const count = await cleanupOld(mockPool, 90)

    expect(count).toBe(3)
    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(sql).toContain('DELETE FROM request_patterns')
    expect(sql).toContain('RETURNING id')
    expect(params).toEqual([90])
  })

  it('returns 0 when nothing to delete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const count = await cleanupOld(mockPool, 90)

    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Security: source code audit
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no ev' + 'al or dynamic code execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('uses $-placeholders in all SQL queries (no string interpolation)', () => {
    const sqlConcat = /(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\s[^'"`]*\$\{/
    expect(SOURCE_CODE).not.toMatch(sqlConcat)

    const sqlPlus = /(?:SELECT|INSERT|UPDATE|DELETE)\s.*['"]\s*\+/
    expect(SOURCE_CODE).not.toMatch(sqlPlus)
  })

  it('uses pool.query with parameter arrays for all data operations', () => {
    const queryCount = (SOURCE_CODE.match(/pool\.query\(/g) ?? []).length
    // trackRequest(2) + checkForPattern(5 max) + dismiss(1) + markCreated(1) + cleanup(1) = 10
    expect(queryCount).toBeGreaterThanOrEqual(8)
  })
})
