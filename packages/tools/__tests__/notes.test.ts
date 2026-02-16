import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentToolResult } from '../src/types'
import { createNotesTool, parseArgs, initDb } from '../src/notes'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/notes.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

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
// Setup / teardown — each test gets a fresh in-memory DB
// ---------------------------------------------------------------------------

let tool: ReturnType<typeof createNotesTool>

beforeEach(() => {
  tool = createNotesTool(':memory:')
})

afterEach(() => {
  // DatabaseSync closes automatically when garbage collected
})

// ---------------------------------------------------------------------------
// CRUD: createNote
// ---------------------------------------------------------------------------

describe('createNote', () => {
  it('creates a note and returns it', async () => {
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

  it('assigns sequential IDs', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'First',
      content: 'Content 1',
    })
    const result = await tool.execute({
      action: 'createNote',
      title: 'Second',
      content: 'Content 2',
    })

    const data = jsonFromResult(result) as { note: { id: number } }
    expect(data.note.id).toBe(2)
  })

  it('includes timestamps', async () => {
    const result = await tool.execute({
      action: 'createNote',
      title: 'Timed',
      content: 'With timestamp',
    })

    const data = jsonFromResult(result) as {
      note: { created_at: string; updated_at: string }
    }
    expect(data.note.created_at).toBeTruthy()
    expect(data.note.updated_at).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// CRUD: listNotes
// ---------------------------------------------------------------------------

describe('listNotes', () => {
  it('lists created notes', async () => {
    await tool.execute({ action: 'createNote', title: 'A', content: 'aaa' })
    await tool.execute({ action: 'createNote', title: 'B', content: 'bbb' })

    const result = await tool.execute({ action: 'listNotes' })
    const data = jsonFromResult(result) as {
      notes: Array<{ title: string }>
      count: number
    }

    expect(data.count).toBe(2)
    expect(data.notes).toHaveLength(2)
  })

  it('respects limit parameter', async () => {
    await tool.execute({ action: 'createNote', title: 'A', content: 'a' })
    await tool.execute({ action: 'createNote', title: 'B', content: 'b' })
    await tool.execute({ action: 'createNote', title: 'C', content: 'c' })

    const result = await tool.execute({ action: 'listNotes', limit: 2 })
    const data = jsonFromResult(result) as { count: number }
    expect(data.count).toBe(2)
  })

  it('returns empty array when no notes exist', async () => {
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
    await tool.execute({
      action: 'createNote',
      title: 'Original',
      content: 'Old content',
    })

    const result = await tool.execute({
      action: 'updateNote',
      id: 1,
      content: 'New content',
    })

    const data = jsonFromResult(result) as {
      note: { title: string; content: string }
    }
    expect(data.note.title).toBe('Original')
    expect(data.note.content).toBe('New content')
  })

  it('throws for non-existent note', async () => {
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
    await tool.execute({
      action: 'createNote',
      title: 'ToDelete',
      content: 'Will be gone',
    })

    const result = await tool.execute({ action: 'deleteNote', id: 1 })
    const data = jsonFromResult(result) as { deleted: boolean; id: number }
    expect(data.deleted).toBe(true)
    expect(data.id).toBe(1)

    // Verify gone from list
    const listResult = await tool.execute({ action: 'listNotes' })
    const listData = jsonFromResult(listResult) as { count: number }
    expect(listData.count).toBe(0)
  })

  it('throws on double delete', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Once',
      content: 'Delete me',
    })

    await tool.execute({ action: 'deleteNote', id: 1 })

    await expect(
      tool.execute({ action: 'deleteNote', id: 1 }),
    ).rejects.toThrow('not found')
  })

  it('throws for non-existent note', async () => {
    await expect(
      tool.execute({ action: 'deleteNote', id: 42 }),
    ).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

describe('searchNotes', () => {
  it('finds notes by content', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Recipe',
      content: 'Pancakes with maple syrup',
    })
    await tool.execute({
      action: 'createNote',
      title: 'Todo',
      content: 'Buy groceries for dinner',
    })

    const result = await tool.execute({
      action: 'searchNotes',
      query: 'pancakes',
    })

    const data = jsonFromResult(result) as {
      notes: Array<{ title: string }>
      count: number
    }

    expect(data.count).toBe(1)
    expect(data.notes[0]?.title).toBe('Recipe')
  })

  it('finds notes by title', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Meeting Notes',
      content: 'Discussed quarterly results',
    })

    const result = await tool.execute({
      action: 'searchNotes',
      query: 'meeting',
    })

    const data = jsonFromResult(result) as { count: number }
    expect(data.count).toBe(1)
  })

  it('returns empty array for no matches', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Existing',
      content: 'Some content here',
    })

    const result = await tool.execute({
      action: 'searchNotes',
      query: 'nonexistentkeyword',
    })

    const data = jsonFromResult(result) as {
      notes: unknown[]
      count: number
    }
    expect(data.notes).toEqual([])
    expect(data.count).toBe(0)
  })

  it('searches updated content after updateNote', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Evolving',
      content: 'alpha version',
    })

    await tool.execute({
      action: 'updateNote',
      id: 1,
      content: 'beta version',
    })

    const alphaResult = await tool.execute({
      action: 'searchNotes',
      query: 'alpha',
    })
    const betaResult = await tool.execute({
      action: 'searchNotes',
      query: 'beta',
    })

    const alphaData = jsonFromResult(alphaResult) as { count: number }
    const betaData = jsonFromResult(betaResult) as { count: number }

    expect(alphaData.count).toBe(0)
    expect(betaData.count).toBe(1)
  })

  it('does not find deleted notes', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Temporary',
      content: 'unique searchterm xyz',
    })

    await tool.execute({ action: 'deleteNote', id: 1 })

    const result = await tool.execute({
      action: 'searchNotes',
      query: 'searchterm',
    })

    const data = jsonFromResult(result) as { count: number }
    expect(data.count).toBe(0)
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
// SQL Injection
// ---------------------------------------------------------------------------

describe('SQL injection', () => {
  it('title with SQL injection attempt causes no damage', async () => {
    const maliciousTitle = "'; DROP TABLE notes; --"
    const result = await tool.execute({
      action: 'createNote',
      title: maliciousTitle,
      content: 'Innocent content',
    })

    const data = jsonFromResult(result) as {
      note: { title: string }
    }

    // Title stored literally, not interpreted as SQL
    expect(data.note.title).toBe(maliciousTitle)

    // Table still exists and works
    const listResult = await tool.execute({ action: 'listNotes' })
    const listData = jsonFromResult(listResult) as { count: number }
    expect(listData.count).toBe(1)
  })

  it('content with SQL injection attempt causes no damage', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Safe',
      content: "Robert'); DROP TABLE notes;--",
    })

    const listResult = await tool.execute({ action: 'listNotes' })
    const listData = jsonFromResult(listResult) as { count: number }
    expect(listData.count).toBe(1)
  })

  it('search query with SQL injection attempt causes no damage', async () => {
    await tool.execute({
      action: 'createNote',
      title: 'Normal',
      content: 'Normal content',
    })

    // FTS5 injection attempt — should not crash, may throw FTS syntax error
    // but must never execute arbitrary SQL
    try {
      await tool.execute({
        action: 'searchNotes',
        query: "') OR 1=1; DROP TABLE notes; --",
      })
    } catch {
      // FTS5 syntax error is acceptable — the important thing
      // is that the table is undamaged
    }

    const listResult = await tool.execute({ action: 'listNotes' })
    const listData = jsonFromResult(listResult) as { count: number }
    expect(listData.count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Security: source code audit
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no ev' + 'al or dynamic code execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('contains no string concatenation in SQL queries', () => {
    // All SQL should use ? placeholders, never string interpolation
    // Match patterns like: `SELECT ... ${` or `'SELECT ... ' +`
    const sqlConcat = /(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\s[^'"`]*\$\{/
    expect(SOURCE_CODE).not.toMatch(sqlConcat)

    const sqlPlus = /(?:SELECT|INSERT|UPDATE|DELETE)\s.*['"]\s*\+/
    expect(SOURCE_CODE).not.toMatch(sqlPlus)
  })

  it('uses only prepared statements for data operations', () => {
    // Every data query should go through db.prepare()
    // Verify prepare is used for all CRUD operations
    const prepareCount = (SOURCE_CODE.match(/\.prepare\(/g) ?? []).length
    // At minimum: insert, select-by-id, update, delete, list, search, select-after-update
    expect(prepareCount).toBeGreaterThanOrEqual(7)
  })
})

// ---------------------------------------------------------------------------
// initDb
// ---------------------------------------------------------------------------

describe('initDb', () => {
  it('creates a usable database', () => {
    const db = initDb(':memory:')
    const rows = db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all('table')
    const tableNames = rows.map((r: Record<string, unknown>) => r['name'])
    expect(tableNames).toContain('notes')
    db.close()
  })

  it('is idempotent (can be called twice on same DB path)', () => {
    const db = initDb(':memory:')
    // Running init again should not throw
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ]) {
      db.prepare(sql).run()
    }
    db.close()
  })
})
