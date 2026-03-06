/**
 * Unit tests for Session/Message CRUD repository.
 * Mock Pool — no real DB needed.
 *
 * Run: cd packages/gateway && npx vitest run src/database/__tests__/sessions.test.ts
 */

import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  upsertSession,
  getSession,
  listSessions,
  deleteSession,
  insertMessage,
  listMessages,
} from '../sessions.js'

// ---------------------------------------------------------------------------
// Source code for security audit
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../sessions.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool = { query: mockQuery }

const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'
const SESSION_ID = '11111111-1111-1111-1111-111111111111'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset()
})

// ---------------------------------------------------------------------------
// upsertSession
// ---------------------------------------------------------------------------

describe('upsertSession', () => {
  it('passes sessionId, userId, title as parameters', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: SESSION_ID, title: 'Hello', created_at: '2026-01-01', last_message_at: '2026-01-01' }],
    })

    const result = await upsertSession(mockPool, SESSION_ID, USER_A, 'Hello')

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT INTO sessions')
    expect(sql).toContain('ON CONFLICT')
    expect(params).toEqual([SESSION_ID, USER_A, 'Hello'])
    expect(result.id).toBe(SESSION_ID)
    expect(result.title).toBe('Hello')
  })

  it('uses $-placeholders in SQL', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: SESSION_ID, title: 'T', created_at: '2026-01-01', last_message_at: '2026-01-01' }],
    })

    await upsertSession(mockPool, SESSION_ID, USER_A, 'T')

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
    expect(sql).toContain('$3')
  })

  it('throws when DB returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(upsertSession(mockPool, SESSION_ID, USER_A, 'T')).rejects.toThrow('Failed to upsert session')
  })
})

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  it('returns session for correct user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: SESSION_ID, title: 'Chat', created_at: '2026-01-01', last_message_at: '2026-01-01' }],
    })

    const result = await getSession(mockPool, SESSION_ID, USER_A)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(SESSION_ID)
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toEqual([SESSION_ID, USER_A])
  })

  it('returns null when no rows (wrong user)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getSession(mockPool, SESSION_ID, USER_B)
    expect(result).toBeNull()
  })

  it('scopes by user_id in WHERE clause', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getSession(mockPool, SESSION_ID, USER_A)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('user_id = $2')
  })
})

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('listSessions', () => {
  it('returns sessions ordered by last_message_at DESC', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'sess-2', title: 'Recent', created_at: '2026-01-02', last_message_at: '2026-01-02' },
        { id: 'sess-1', title: 'Old', created_at: '2026-01-01', last_message_at: '2026-01-01' },
      ],
    })

    const result = await listSessions(mockPool, USER_A)

    expect(result).toHaveLength(2)
    expect(result[0]!.id).toBe('sess-2')
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('ORDER BY last_message_at DESC')
  })

  it('uses default limit of 50', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await listSessions(mockPool, USER_A)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[1]).toBe(50)
  })

  it('passes custom limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await listSessions(mockPool, USER_A, 10)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[1]).toBe(10)
  })

  it('scopes by user_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await listSessions(mockPool, USER_A)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('deleteSession', () => {
  it('returns true when session deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: SESSION_ID }] })

    const result = await deleteSession(mockPool, SESSION_ID, USER_A)
    expect(result).toBe(true)
  })

  it('returns false when session not found (wrong user)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await deleteSession(mockPool, SESSION_ID, USER_B)
    expect(result).toBe(false)
  })

  it('scopes by user_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await deleteSession(mockPool, SESSION_ID, USER_A)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('user_id = $2')
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params).toEqual([SESSION_ID, USER_A])
  })
})

// ---------------------------------------------------------------------------
// insertMessage
// ---------------------------------------------------------------------------

describe('insertMessage', () => {
  it('inserts message with correct parameters', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'msg-1', role: 'user', content: 'Hello', tool_name: null, tool_result: null, created_at: '2026-01-01' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE sessions timestamp

    const result = await insertMessage(mockPool, SESSION_ID, 'user', 'Hello')

    expect(result.id).toBe('msg-1')
    expect(result.role).toBe('user')
    expect(result.content).toBe('Hello')
    expect(result.toolName).toBeNull()

    // First call: INSERT message
    const [sql1, params1] = mockQuery.mock.calls[0]!
    expect(sql1).toContain('INSERT INTO messages')
    expect(params1).toEqual([SESSION_ID, 'user', 'Hello', null, null])

    // Second call: UPDATE session timestamp
    const sql2 = mockQuery.mock.calls[1]![0] as string
    expect(sql2).toContain('UPDATE sessions')
  })

  it('passes toolName and toolResult when provided', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'msg-2', role: 'assistant', content: 'Result', tool_name: 'calculator', tool_result: '42', created_at: '2026-01-01' }],
      })
      .mockResolvedValueOnce({ rows: [] })

    const result = await insertMessage(mockPool, SESSION_ID, 'assistant', 'Result', {
      toolName: 'calculator',
      toolResult: '42',
    })

    expect(result.toolName).toBe('calculator')
    expect(result.toolResult).toBe('42')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[3]).toBe('calculator')
    expect(params[4]).toBe('42')
  })

  it('throws when DB returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(insertMessage(mockPool, SESSION_ID, 'user', 'Hello')).rejects.toThrow('Failed to insert message')
  })
})

// ---------------------------------------------------------------------------
// listMessages
// ---------------------------------------------------------------------------

describe('listMessages', () => {
  it('returns messages with user-scoped JOIN', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'msg-1', role: 'user', content: 'Hi', tool_name: null, tool_result: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 'msg-2', role: 'assistant', content: 'Hello', tool_name: null, tool_result: null, created_at: '2026-01-01T00:00:01Z' },
      ],
    })

    const result = await listMessages(mockPool, SESSION_ID, USER_A)

    expect(result).toHaveLength(2)
    expect(result[0]!.role).toBe('user')
    expect(result[1]!.role).toBe('assistant')

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('JOIN sessions s ON m.session_id = s.id')
    expect(sql).toContain('s.user_id = $2')
    expect(sql).toContain('ORDER BY m.created_at ASC')
  })

  it('returns empty array when user has no access', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await listMessages(mockPool, SESSION_ID, USER_B)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// User isolation
// ---------------------------------------------------------------------------

describe('user isolation', () => {
  it('User B cannot see User A sessions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getSession(mockPool, SESSION_ID, USER_B)
    expect(result).toBeNull()

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[1]).toBe(USER_B)
  })

  it('User B cannot delete User A session', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await deleteSession(mockPool, SESSION_ID, USER_B)
    expect(result).toBe(false)
  })

  it('User B cannot list User A messages', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await listMessages(mockPool, SESSION_ID, USER_B)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SQL Injection — verify parameterized queries
// ---------------------------------------------------------------------------

describe('SQL injection', () => {
  it('all queries use $-placeholders, no string concatenation', () => {
    // No template literal interpolation in SQL
    const sqlConcat = /(?:SELECT|INSERT|UPDATE|DELETE)\s[^'"`]*\$\{/
    expect(SOURCE_CODE).not.toMatch(sqlConcat)

    // No string concatenation with +
    const sqlPlus = /(?:SELECT|INSERT|UPDATE|DELETE)\s.*['"]\s*\+/
    expect(SOURCE_CODE).not.toMatch(sqlPlus)
  })

  it('uses pool.query with parameter arrays for all data operations', () => {
    const queryCount = (SOURCE_CODE.match(/pool\.query\(/g) ?? []).length
    // At minimum: upsert, get, list, delete, insertMsg, updateTimestamp, listMsgs = 7
    expect(queryCount).toBeGreaterThanOrEqual(7)
  })
})

// ---------------------------------------------------------------------------
// Security: source code audit
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no eval or dynamic code execution', () => {
    const evalCall = ['\\bev', 'al\\s*\\('].join('')
    const newFunc = ['\\bnew\\s+Fun', 'ction\\s*\\('].join('')
    expect(SOURCE_CODE).not.toMatch(new RegExp(evalCall))
    expect(SOURCE_CODE).not.toMatch(new RegExp(newFunc))
  })
})
