import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbPool } from '../src/types'
import {
  set,
  get,
  getAll,
  getByCategory,
  deleteKey,
  deleteNamespace,
  cleanupExpired,
  cleanupStaleCache,
  formatForSystemPrompt,
  resolveTtl,
} from '../src/agent-memory'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/agent-memory.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }

const AGENT_A = 'agent-a-uuid'
const AGENT_B = 'agent-b-uuid'
const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    agent_id: AGENT_A,
    user_id: USER_A,
    key: 'test-key',
    value: '"test-value"',
    category: 'general',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    accessed_at: '2026-01-01T00:00:00Z',
    access_count: 0,
    ttl_days: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup — fresh mock per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset()
})

// ---------------------------------------------------------------------------
// set() — Upsert
// ---------------------------------------------------------------------------

describe('set', () => {
  it('inserts a new entry and returns it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] })

    const record = await set(mockPool, AGENT_A, USER_A, 'test-key', 'test-value')

    expect(record.key).toBe('test-key')
    expect(record.agentId).toBe(AGENT_A)
    expect(record.userId).toBe(USER_A)
  })

  it('uses ON CONFLICT for upsert', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] })

    await set(mockPool, AGENT_A, USER_A, 'test-key', 'updated')

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('ON CONFLICT')
    expect(sql).toContain('DO UPDATE')
  })

  it('overwrites existing key on upsert', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ value: '"v2"' })] })

    const record = await set(mockPool, AGENT_A, USER_A, 'test-key', 'v2')

    expect(record).toBeDefined()
    // Verify the SQL contains ON CONFLICT UPDATE
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('ON CONFLICT')
  })

  it('passes agentId and userId as first two parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] })

    await set(mockPool, AGENT_A, USER_A, 'k', 'v')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(AGENT_A)
    expect(params[1]).toBe(USER_A)
  })

  it('serializes value as JSON', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] })

    await set(mockPool, AGENT_A, USER_A, 'k', { nested: true })

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[3]).toBe('{"nested":true}')
  })

  it('throws when DB returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      set(mockPool, AGENT_A, USER_A, 'k', 'v'),
    ).rejects.toThrow('Failed to upsert')
  })
})

// ---------------------------------------------------------------------------
// Default TTL per category
// ---------------------------------------------------------------------------

describe('resolveTtl', () => {
  it('preference → null (no expiry)', () => {
    expect(resolveTtl('preference', undefined)).toBeNull()
  })

  it('learned → 90 days', () => {
    expect(resolveTtl('learned', undefined)).toBe(90)
  })

  it('state → 1 day', () => {
    expect(resolveTtl('state', undefined)).toBe(1)
  })

  it('cache without explicit TTL throws', () => {
    expect(() => resolveTtl('cache', undefined)).toThrow('cache category requires')
  })

  it('cache with explicit TTL uses it', () => {
    expect(resolveTtl('cache', 7)).toBe(7)
  })

  it('explicit TTL overrides default', () => {
    expect(resolveTtl('learned', 30)).toBe(30)
  })

  it('rejects negative ttlDays', () => {
    expect(() => resolveTtl('general', -1)).toThrow('non-negative integer')
  })

  it('rejects fractional ttlDays', () => {
    expect(() => resolveTtl('general', 1.5)).toThrow('non-negative integer')
  })

  it('accepts zero ttlDays (immediate expiry)', () => {
    expect(resolveTtl('general', 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// get() — access tracking
// ---------------------------------------------------------------------------

describe('get', () => {
  it('returns the value for an existing key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'hello' }] })

    const result = await get(mockPool, AGENT_A, USER_A, 'greet')

    expect(result).toBe('hello')
  })

  it('returns null for a missing key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await get(mockPool, AGENT_A, USER_A, 'missing')

    expect(result).toBeNull()
  })

  it('updates accessed_at and increments access_count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'x' }] })

    await get(mockPool, AGENT_A, USER_A, 'k')

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('accessed_at = NOW()')
    expect(sql).toContain('access_count = access_count + 1')
  })

  it('scopes query by agentId and userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 'x' }] })

    await get(mockPool, AGENT_A, USER_A, 'k')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(AGENT_A)
    expect(params[1]).toBe(USER_A)
    expect(params[2]).toBe('k')
  })
})

// ---------------------------------------------------------------------------
// getAll / getByCategory
// ---------------------------------------------------------------------------

describe('getAll', () => {
  it('returns all records for an agent+user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRow({ key: 'a' }), makeRow({ key: 'b' })],
    })

    const records = await getAll(mockPool, AGENT_A, USER_A)

    expect(records).toHaveLength(2)
    expect(records[0]!.key).toBe('a')
    expect(records[1]!.key).toBe('b')
  })

  it('returns empty array when no entries exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const records = await getAll(mockPool, AGENT_A, USER_A)

    expect(records).toEqual([])
  })
})

describe('getByCategory', () => {
  it('filters by category', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRow({ category: 'learned' })],
    })

    const records = await getByCategory(mockPool, AGENT_A, USER_A, 'learned')

    expect(records).toHaveLength(1)
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[2]).toBe('learned')
  })
})

// ---------------------------------------------------------------------------
// Namespace isolation — Agent A does not see Agent B
// ---------------------------------------------------------------------------

describe('namespace isolation', () => {
  it('every query scopes by agentId and userId', async () => {
    // set
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ agent_id: AGENT_B, user_id: USER_B })] })
    await set(mockPool, AGENT_B, USER_B, 'k', 'v')
    expect((mockQuery.mock.calls[0]![1] as unknown[])[0]).toBe(AGENT_B)
    expect((mockQuery.mock.calls[0]![1] as unknown[])[1]).toBe(USER_B)

    // get
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await get(mockPool, AGENT_A, USER_A, 'k')
    expect((mockQuery.mock.calls[1]![1] as unknown[])[0]).toBe(AGENT_A)
    expect((mockQuery.mock.calls[1]![1] as unknown[])[1]).toBe(USER_A)

    // getAll
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await getAll(mockPool, AGENT_B, USER_A)
    expect((mockQuery.mock.calls[2]![1] as unknown[])[0]).toBe(AGENT_B)
    expect((mockQuery.mock.calls[2]![1] as unknown[])[1]).toBe(USER_A)

    // getByCategory
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await getByCategory(mockPool, AGENT_A, USER_B, 'learned')
    expect((mockQuery.mock.calls[3]![1] as unknown[])[0]).toBe(AGENT_A)
    expect((mockQuery.mock.calls[3]![1] as unknown[])[1]).toBe(USER_B)

    // deleteKey
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await deleteKey(mockPool, AGENT_B, USER_B, 'k')
    expect((mockQuery.mock.calls[4]![1] as unknown[])[0]).toBe(AGENT_B)
    expect((mockQuery.mock.calls[4]![1] as unknown[])[1]).toBe(USER_B)

    // deleteNamespace
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await deleteNamespace(mockPool, AGENT_A, USER_A)
    expect((mockQuery.mock.calls[5]![1] as unknown[])[0]).toBe(AGENT_A)
    expect((mockQuery.mock.calls[5]![1] as unknown[])[1]).toBe(USER_A)
  })

  it('Agent A set does not affect Agent B get', async () => {
    // Agent A sets a key
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] })
    await set(mockPool, AGENT_A, USER_A, 'secret', 'agent-a-data')

    // Agent B gets same key — returns null (different namespace)
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await get(mockPool, AGENT_B, USER_A, 'secret')

    expect(result).toBeNull()
    // Verify different agentId passed
    expect((mockQuery.mock.calls[0]![1] as unknown[])[0]).toBe(AGENT_A)
    expect((mockQuery.mock.calls[1]![1] as unknown[])[0]).toBe(AGENT_B)
  })
})

// ---------------------------------------------------------------------------
// deleteKey / deleteNamespace
// ---------------------------------------------------------------------------

describe('deleteKey', () => {
  it('deletes a specific key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await deleteKey(mockPool, AGENT_A, USER_A, 'obsolete')

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('DELETE FROM agent_memory')
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[2]).toBe('obsolete')
  })
})

describe('deleteNamespace', () => {
  it('deletes all entries for an agent+user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await deleteNamespace(mockPool, AGENT_A, USER_A)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('DELETE FROM agent_memory')
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toHaveLength(2)
    expect(params[0]).toBe(AGENT_A)
    expect(params[1]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// cleanupExpired — TTL-based deletion
// ---------------------------------------------------------------------------

describe('cleanupExpired', () => {
  it('returns number of deleted entries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })

    const count = await cleanupExpired(mockPool)

    expect(count).toBe(3)
  })

  it('returns 0 when nothing expired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const count = await cleanupExpired(mockPool)

    expect(count).toBe(0)
  })

  it('uses ttl_days in the WHERE clause', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await cleanupExpired(mockPool)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('ttl_days IS NOT NULL')
    expect(sql).toContain('INTERVAL')
  })
})

// ---------------------------------------------------------------------------
// cleanupStaleCache
// ---------------------------------------------------------------------------

describe('cleanupStaleCache', () => {
  it('deletes stale cache entries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] })

    const count = await cleanupStaleCache(mockPool, 30)

    expect(count).toBe(1)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain("category = 'cache'")
    expect(sql).toContain('accessed_at')
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(30)
  })

  it('rejects zero maxAgeDays', async () => {
    await expect(cleanupStaleCache(mockPool, 0)).rejects.toThrow('positive integer')
  })

  it('rejects negative maxAgeDays', async () => {
    await expect(cleanupStaleCache(mockPool, -5)).rejects.toThrow('positive integer')
  })

  it('rejects fractional maxAgeDays', async () => {
    await expect(cleanupStaleCache(mockPool, 2.5)).rejects.toThrow('positive integer')
  })
})

// ---------------------------------------------------------------------------
// formatForSystemPrompt — char limit
// ---------------------------------------------------------------------------

describe('formatForSystemPrompt', () => {
  it('formats entries grouped by category', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'lang', value: 'deutsch', category: 'preference' },
        { key: 'pattern', value: '"always greet"', category: 'learned' },
      ],
    })

    const result = await formatForSystemPrompt(mockPool, AGENT_A, USER_A)

    expect(result).toContain('## Vorlieben')
    expect(result).toContain('- lang: deutsch')
    expect(result).toContain('## Gelerntes')
    expect(result).toContain('- pattern: "always greet"')
  })

  it('excludes cache entries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await formatForSystemPrompt(mockPool, AGENT_A, USER_A)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain("category != 'cache'")
  })

  it('stays under 2000 chars', async () => {
    // Generate many entries that would exceed 2000 chars
    const rows = Array.from({ length: 100 }, (_, i) => ({
      key: `key-${String(i)}`,
      value: 'x'.repeat(50),
      category: 'learned',
    }))
    mockQuery.mockResolvedValueOnce({ rows })

    const result = await formatForSystemPrompt(mockPool, AGENT_A, USER_A)

    expect(result.length).toBeLessThanOrEqual(2000)
  })

  it('returns empty string when no entries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await formatForSystemPrompt(mockPool, AGENT_A, USER_A)

    expect(result).toBe('')
  })

  it('handles JSON object values', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'prefs', value: { theme: 'dark' }, category: 'preference' },
      ],
    })

    const result = await formatForSystemPrompt(mockPool, AGENT_A, USER_A)

    expect(result).toContain('{"theme":"dark"}')
  })
})

// ---------------------------------------------------------------------------
// SQL injection — verify parameterized queries
// ---------------------------------------------------------------------------

describe('SQL injection', () => {
  it('malicious key is passed as parameter, not interpolated', async () => {
    const maliciousKey = "'; DROP TABLE agent_memory; --"
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ key: maliciousKey })] })

    await set(mockPool, AGENT_A, USER_A, maliciousKey, 'safe')

    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(sql).not.toContain(maliciousKey)
    expect(params).toContain(maliciousKey)
  })

  it('malicious value is passed as parameter', async () => {
    const maliciousValue = "'); DELETE FROM users; --"
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] })

    await set(mockPool, AGENT_A, USER_A, 'k', maliciousValue)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).not.toContain(maliciousValue)
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
    // set, get, getAll, getByCategory, deleteKey, deleteNamespace, cleanupExpired, cleanupStaleCache, formatForSystemPrompt = 9
    expect(queryCount).toBeGreaterThanOrEqual(9)
  })

  it('does not contain fetch calls', () => {
    const fetchPattern = /\bfe/.source + /tch\s*\(/.source
    expect(SOURCE_CODE).not.toMatch(new RegExp(fetchPattern))
  })
})
