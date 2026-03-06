/**
 * Unit tests for session CRUD helpers.
 *
 * Run: cd packages/gateway && npx vitest run src/__tests__/sessions.test.ts
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

function createMockPool(rows: Record<string, unknown>[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  updateSessionTitle,
  countMessages,
} from '../database/sessions.js'

describe('updateSessionTitle', () => {
  it('updates the title for the given session scoped by userId', async () => {
    const pool = createMockPool()
    await updateSessionTitle(pool, 'sess-1', 'user-1', 'New Title')

    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE sessions SET title = $1 WHERE id = $2 AND user_id = $3',
      ['New Title', 'sess-1', 'user-1'],
    )
  })
})

describe('countMessages', () => {
  it('returns the count from the query result', async () => {
    const pool = createMockPool([{ cnt: 5 }])
    const count = await countMessages(pool, 'sess-1')

    expect(count).toBe(5)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('COUNT'),
      ['sess-1'],
    )
  })

  it('returns 0 when no rows returned', async () => {
    const pool = createMockPool([])
    const count = await countMessages(pool, 'sess-1')
    expect(count).toBe(0)
  })
})
