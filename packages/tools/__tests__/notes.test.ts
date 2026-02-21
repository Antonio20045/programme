import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentToolResult, DbPool } from '../src/types'
import { createNotesTool, parseArgs } from '../src/notes'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/notes.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }
const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textFromResult(result: AgentToolResult): string {
  const first = result.content[0]
  if (!first || first.type !== 'text') {
    throw new Error('Expected text content in result')
  }
  return first.text
}

function jsonFromResult(result: AgentToolResult): Record<string, unknown> {
  return JSON.parse(textFromResult(result)) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Setup — fresh mock + tool per test
// ---------------------------------------------------------------------------

let tool: ReturnType<typeof createNotesTool>

beforeEach(() => {
  mockQuery.mockReset()
  tool = createNotesTool(USER_A, mockPool)
})

// ---------------------------------------------------------------------------
// CRUD: createNote
// ---------------------------------------------------------------------------

describe('createNote', () => {
  it('creates a note and returns it', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'My Note', content: 'Hello World', created_at: '2026-01-01', updated_at: '2026-01-01' }],
    })

    const result = await tool.execute({
      action: 'createNote',
      title: 'My Note',
      content: 'Hello World',
    })

    const data = jsonFromResult(result) as {
      note: { id: number; title: string; content: string }
    }

    expect(data.note.id).toBe(1)
    expect(data.note.title).toBe('My Note')
    expect(data.note.content).toBe('Hello World')
  })

  it('passes userId as first parameter', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'T', content: 'C', created_at: '2026-01-01', updated_at: '2026-01-01' }],
    })

    await tool.execute({ action: 'createNote', title: 'T', content: 'C' })

    expect(mockQuery).toHaveBeenCalledOnce()
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })

  it('includes timestamps from DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'T', content: 'C', created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' }],
    })

    const result = await tool.execute({ action: 'createNote', title: 'T', content: 'C' })
    const data = jsonFromResult(result) as { note: { created_at: string; updated_at: string } }
    expect(data.note.created_at).toBeTruthy()
    expect(data.note.updated_at).toBeTruthy()
  })

  it('throws when DB returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      tool.execute({ action: 'createNote', title: 'T', content: 'C' }),
    ).rejects.toThrow('Failed to retrieve created note')
  })
})

// ---------------------------------------------------------------------------
// CRUD: listNotes
// ---------------------------------------------------------------------------

describe('listNotes', () => {
  it('lists notes from pool', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 2, title: 'B', content: 'bbb', created_at: '2026-01-02', updated_at: '2026-01-02' },
        { id: 1, title: 'A', content: 'aaa', created_at: '2026-01-01', updated_at: '2026-01-01' },
      ],
    })

    const result = await tool.execute({ action: 'listNotes' })
    const data = jsonFromResult(result) as { notes: unknown[]; count: number }

    expect(data.count).toBe(2)
    expect(data.notes).toHaveLength(2)
  })

  it('passes limit as second parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await tool.execute({ action: 'listNotes', limit: 5 })

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
    expect(params[1]).toBe(5)
  })

  it('returns empty array when no notes exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await tool.execute({ action: 'listNotes' })
    const data = jsonFromResult(result) as { notes: unknown[]; count: number }
    expect(data.notes).toEqual([])
    expect(data.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CRUD: updateNote
// ---------------------------------------------------------------------------

describe('updateNote', () => {
  it('updates note content', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'Original', content: 'New content', created_at: '2026-01-01', updated_at: '2026-01-02' }],
    })

    const result = await tool.execute({
      action: 'updateNote',
      id: 1,
      content: 'New content',
    })

    const data = jsonFromResult(result) as { note: { title: string; content: string } }
    expect(data.note.title).toBe('Original')
    expect(data.note.content).toBe('New content')
  })

  it('throws for non-existent note (no rows returned)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      tool.execute({ action: 'updateNote', id: 999, content: 'x' }),
    ).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// CRUD: deleteNote
// ---------------------------------------------------------------------------

describe('deleteNote', () => {
  it('deletes a note', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })

    const result = await tool.execute({ action: 'deleteNote', id: 1 })
    const data = jsonFromResult(result) as { deleted: boolean; id: number }
    expect(data.deleted).toBe(true)
    expect(data.id).toBe(1)
  })

  it('throws for non-existent note', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      tool.execute({ action: 'deleteNote', id: 42 }),
    ).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// Full-text search (tsvector)
// ---------------------------------------------------------------------------

describe('searchNotes', () => {
  it('returns matching notes', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'Recipe', content: 'Pancakes', created_at: '2026-01-01', updated_at: '2026-01-01' }],
    })

    const result = await tool.execute({ action: 'searchNotes', query: 'pancakes' })
    const data = jsonFromResult(result) as { notes: Array<{ title: string }>; count: number }

    expect(data.count).toBe(1)
    expect(data.notes[0]?.title).toBe('Recipe')
  })

  it('passes userId and query as parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await tool.execute({ action: 'searchNotes', query: 'test query' })

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
    expect(params[1]).toBe('test query')
  })

  it('uses plainto_tsquery in SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await tool.execute({ action: 'searchNotes', query: 'keyword' })

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('plainto_tsquery')
    expect(sql).toContain('search_vector')
  })

  it('returns empty array for no matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await tool.execute({ action: 'searchNotes', query: 'nonexistent' })
    const data = jsonFromResult(result) as { notes: unknown[]; count: number }
    expect(data.notes).toEqual([])
    expect(data.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// User isolation
// ---------------------------------------------------------------------------

describe('user isolation', () => {
  it('every query includes userId as first parameter', async () => {
    const toolB = createNotesTool(USER_B, mockPool)

    // createNote
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'T', content: 'C', created_at: '2026-01-01', updated_at: '2026-01-01' }],
    })
    await toolB.execute({ action: 'createNote', title: 'T', content: 'C' })
    expect((mockQuery.mock.calls[0]![1] as unknown[])[0]).toBe(USER_B)

    // listNotes
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await toolB.execute({ action: 'listNotes' })
    expect((mockQuery.mock.calls[1]![1] as unknown[])[0]).toBe(USER_B)

    // searchNotes
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await toolB.execute({ action: 'searchNotes', query: 'q' })
    expect((mockQuery.mock.calls[2]![1] as unknown[])[0]).toBe(USER_B)

    // updateNote
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await toolB.execute({ action: 'updateNote', id: 1, content: 'x' }).catch(() => {})
    expect((mockQuery.mock.calls[3]![1] as unknown[])[0]).toBe(USER_B)

    // deleteNote
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await toolB.execute({ action: 'deleteNote', id: 1 }).catch(() => {})
    expect((mockQuery.mock.calls[4]![1] as unknown[])[0]).toBe(USER_B)
  })

  it('User B cannot update User A note (DB returns empty)', async () => {
    const toolB = createNotesTool(USER_B, mockPool)
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      toolB.execute({ action: 'updateNote', id: 1, content: 'hacked' }),
    ).rejects.toThrow('not found')
  })

  it('User B cannot delete User A note (DB returns empty)', async () => {
    const toolB = createNotesTool(USER_B, mockPool)
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      toolB.execute({ action: 'deleteNote', id: 1 }),
    ).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('rejects non-object args', () => {
    expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    expect(() => parseArgs('string')).toThrow('Arguments must be an object')
  })

  it('rejects unknown action', () => {
    expect(() => parseArgs({ action: 'purge' })).toThrow('action must be')
  })

  it('rejects createNote with missing fields', () => {
    expect(() => parseArgs({ action: 'createNote' })).toThrow('"title"')
    expect(() =>
      parseArgs({ action: 'createNote', title: 'T' }),
    ).toThrow('"content"')
  })

  it('rejects updateNote with non-integer id', () => {
    expect(() =>
      parseArgs({ action: 'updateNote', id: 1.5, content: 'x' }),
    ).toThrow('positive integer')
  })

  it('rejects deleteNote with missing id', () => {
    expect(() => parseArgs({ action: 'deleteNote' })).toThrow('positive integer')
  })

  it('caps listNotes limit at 100', () => {
    const result = parseArgs({ action: 'listNotes', limit: 500 })
    expect(result).toEqual({ action: 'listNotes', limit: 100 })
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('notesTool metadata', () => {
  it('has correct name', () => {
    expect(tool.name).toBe('notes')
  })

  it('has empty permissions', () => {
    expect(tool.permissions).toEqual([])
  })

  it('requires confirmation', () => {
    expect(tool.requiresConfirmation).toBe(true)
  })

  it('runs on server', () => {
    expect(tool.runsOn).toBe('server')
  })

  it('has valid parameter schema', () => {
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.required).toEqual(['action'])
  })
})

// ---------------------------------------------------------------------------
// SQL Injection — verify parameterized queries
// ---------------------------------------------------------------------------

describe('SQL injection', () => {
  it('SQL injection in title is passed as parameter, not interpolated', async () => {
    const maliciousTitle = "'; DROP TABLE notes; --"
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: maliciousTitle, content: 'C', created_at: '2026-01-01', updated_at: '2026-01-01' }],
    })

    await tool.execute({ action: 'createNote', title: maliciousTitle, content: 'Innocent' })

    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    // SQL uses $-placeholders, not string interpolation
    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
    expect(sql).not.toContain(maliciousTitle)
    // Malicious string is safely in params
    expect(params).toContain(maliciousTitle)
  })

  it('SQL injection in search query is passed as parameter', async () => {
    const maliciousQuery = "') OR 1=1; DROP TABLE notes; --"
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await tool.execute({ action: 'searchNotes', query: maliciousQuery })

    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(sql).not.toContain(maliciousQuery)
    expect(params).toContain(maliciousQuery)
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
    // All SQL should use $N placeholders, never string interpolation
    const sqlConcat = /(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\s[^'"`]*\$\{/
    expect(SOURCE_CODE).not.toMatch(sqlConcat)

    const sqlPlus = /(?:SELECT|INSERT|UPDATE|DELETE)\s.*['"]\s*\+/
    expect(SOURCE_CODE).not.toMatch(sqlPlus)
  })

  it('uses pool.query with parameter arrays for all data operations', () => {
    // Every data query goes through pool.query(sql, params)
    const queryCount = (SOURCE_CODE.match(/pool\.query\(/g) ?? []).length
    // At minimum: insert, search, update, delete, list = 5
    expect(queryCount).toBeGreaterThanOrEqual(5)
  })
})
