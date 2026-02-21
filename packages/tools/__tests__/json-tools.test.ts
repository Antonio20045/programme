import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { jsonToolsTool, parsePath, queryJson, repairJson } from '../src/json-tools'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/json-tools.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): unknown {
  const first = result.content[0] as { type: 'text'; text: string }
  return JSON.parse(first.text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('json-tools tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(jsonToolsTool.name).toBe('json-tools')
    })

    it('runs on server', () => {
      expect(jsonToolsTool.runsOn).toBe('server')
    })

    it('has no permissions', () => {
      expect(jsonToolsTool.permissions).toEqual([])
    })

    it('does not require confirmation', () => {
      expect(jsonToolsTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // validate()
  // -------------------------------------------------------------------------

  describe('validate()', () => {
    it('validates correct JSON', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'validate', json: '{"key": "value"}',
      })) as { valid: boolean }
      expect(result.valid).toBe(true)
    })

    it('detects invalid JSON', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'validate', json: '{key: value}',
      })) as { valid: boolean; error: string }
      expect(result.valid).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('validates arrays', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'validate', json: '[1, 2, 3]',
      })) as { valid: boolean }
      expect(result.valid).toBe(true)
    })

    it('validates primitives', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'validate', json: '"hello"',
      })) as { valid: boolean }
      expect(result.valid).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // format()
  // -------------------------------------------------------------------------

  describe('format()', () => {
    it('formats with default indent', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'format', json: '{"a":1,"b":2}',
      })) as { formatted: string }
      expect(result.formatted).toContain('\n')
      expect(result.formatted).toContain('  ') // 2-space indent
    })

    it('formats with custom indent', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'format', json: '{"a":1}', indent: 4,
      })) as { formatted: string }
      expect(result.formatted).toContain('    "a"')
    })

    it('rejects indent > 8', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'format', json: '{}', indent: 10 }),
      ).rejects.toThrow('between 0 and 8')
    })

    it('rejects invalid JSON', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'format', json: '{bad}' }),
      ).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  describe('query()', () => {
    const sampleJson = JSON.stringify({
      store: {
        books: [
          { title: 'A', author: 'X', price: 10 },
          { title: 'B', author: 'Y', price: 20 },
        ],
        name: 'TestStore',
      },
    })

    it('queries a simple key', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'query', json: sampleJson, path: '$.store.name',
      })) as { results: unknown[] }
      expect(result.results).toEqual(['TestStore'])
    })

    it('queries array index', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'query', json: sampleJson, path: '$.store.books[0].title',
      })) as { results: unknown[] }
      expect(result.results).toEqual(['A'])
    })

    it('queries with wildcard', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'query', json: sampleJson, path: '$.store.books[*].author',
      })) as { results: unknown[] }
      expect(result.results).toEqual(['X', 'Y'])
    })

    it('queries with recursive descent', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'query', json: sampleJson, path: '$..author',
      })) as { results: unknown[] }
      expect(result.results).toEqual(['X', 'Y'])
    })

    it('returns empty for non-existent path', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'query', json: sampleJson, path: '$.missing',
      })) as { results: unknown[]; count: number }
      expect(result.results).toEqual([])
      expect(result.count).toBe(0)
    })

    it('queries deeply nested', async () => {
      const deep = JSON.stringify({ a: { b: { c: { d: { e: 42 } } } } })
      const result = parseResult(await jsonToolsTool.execute({
        action: 'query', json: deep, path: '$.a.b.c.d.e',
      })) as { results: unknown[] }
      expect(result.results).toEqual([42])
    })

    it('rejects path not starting with $', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'query', json: '{}', path: 'store' }),
      ).rejects.toThrow('must start with "$"')
    })
  })

  // -------------------------------------------------------------------------
  // merge()
  // -------------------------------------------------------------------------

  describe('merge()', () => {
    it('merges two objects', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'merge',
        json1: '{"a": 1, "b": 2}',
        json2: '{"b": 3, "c": 4}',
      })) as { merged: Record<string, number> }
      expect(result.merged).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('json2 overrides json1 on conflicts', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'merge',
        json1: '{"x": "old"}',
        json2: '{"x": "new"}',
      })) as { merged: Record<string, string> }
      expect(result.merged['x']).toBe('new')
    })

    it('rejects non-object json1', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'merge', json1: '[1,2]', json2: '{}' }),
      ).rejects.toThrow('json1 must be a JSON object')
    })

    it('rejects non-object json2', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'merge', json1: '{}', json2: '"string"' }),
      ).rejects.toThrow('json2 must be a JSON object')
    })
  })

  // -------------------------------------------------------------------------
  // repair()
  // -------------------------------------------------------------------------

  describe('repair()', () => {
    it('fixes trailing commas', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'repair', json: '{"a": 1, "b": 2,}',
      })) as { success: boolean; parsed: unknown }
      expect(result.success).toBe(true)
      expect(result.parsed).toEqual({ a: 1, b: 2 })
    })

    it('fixes single quotes', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'repair', json: "{'a': 1}",
      })) as { success: boolean; parsed: unknown }
      expect(result.success).toBe(true)
      expect(result.parsed).toEqual({ a: 1 })
    })

    it('fixes unquoted keys', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'repair', json: '{name: "test"}',
      })) as { success: boolean; parsed: unknown }
      expect(result.success).toBe(true)
      expect(result.parsed).toEqual({ name: 'test' })
    })

    it('fixes missing closing brackets', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'repair', json: '{"a": [1, 2',
      })) as { success: boolean }
      expect(result.success).toBe(true)
    })

    it('reports failure when repair is not enough', async () => {
      const result = parseResult(await jsonToolsTool.execute({
        action: 'repair', json: ':::invalid:::',
      })) as { success: boolean; error: string }
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('round-trips valid JSON through repair', async () => {
      const original = '{"key": "value", "arr": [1, 2, 3]}'
      const result = parseResult(await jsonToolsTool.execute({
        action: 'repair', json: original,
      })) as { success: boolean; parsed: unknown }
      expect(result.success).toBe(true)
      expect(result.parsed).toEqual(JSON.parse(original))
    })
  })

  // -------------------------------------------------------------------------
  // parsePath() — exported
  // -------------------------------------------------------------------------

  describe('parsePath()', () => {
    it('parses simple dot notation', () => {
      const segments = parsePath('$.store.name')
      expect(segments).toEqual([
        { type: 'key', value: 'store' },
        { type: 'key', value: 'name' },
      ])
    })

    it('parses bracket index', () => {
      const segments = parsePath('$.items[0]')
      expect(segments).toEqual([
        { type: 'key', value: 'items' },
        { type: 'index', value: '0' },
      ])
    })

    it('parses wildcard', () => {
      const segments = parsePath('$.items[*]')
      expect(segments).toEqual([
        { type: 'key', value: 'items' },
        { type: 'wildcard', value: '*' },
      ])
    })

    it('parses recursive descent', () => {
      const segments = parsePath('$..author')
      expect(segments).toEqual([
        { type: 'recursive', value: 'author' },
      ])
    })

    it('parses quoted bracket key', () => {
      const segments = parsePath("$['key with spaces']")
      expect(segments).toEqual([
        { type: 'key', value: 'key with spaces' },
      ])
    })
  })

  // -------------------------------------------------------------------------
  // queryJson() — exported
  // -------------------------------------------------------------------------

  describe('queryJson()', () => {
    it('queries root with empty segments', () => {
      const result = queryJson({ a: 1 }, [])
      expect(result).toEqual([{ a: 1 }])
    })

    it('respects depth limit', () => {
      // Build deeply nested object
      let obj: unknown = 'leaf'
      for (let i = 0; i < 25; i++) {
        obj = { nested: obj }
      }
      const segments = Array.from({ length: 25 }, () => ({ type: 'key' as const, value: 'nested' }))
      expect(() => queryJson(obj, segments)).toThrow('maximum depth')
    })
  })

  // -------------------------------------------------------------------------
  // repairJson() — exported
  // -------------------------------------------------------------------------

  describe('repairJson()', () => {
    it('removes trailing comma in array', () => {
      const result = repairJson('[1, 2, 3,]')
      expect(JSON.parse(result)).toEqual([1, 2, 3])
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(jsonToolsTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(jsonToolsTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects validate without json', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'validate' }),
      ).rejects.toThrow('"json" string')
    })

    it('rejects query without path', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'query', json: '{}' }),
      ).rejects.toThrow('non-empty "path"')
    })

    it('rejects merge without json1', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'merge', json2: '{}' }),
      ).rejects.toThrow('"json1" string')
    })

    it('rejects merge without json2', async () => {
      await expect(
        jsonToolsTool.execute({ action: 'merge', json1: '{}' }),
      ).rejects.toThrow('"json2" string')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })
  })
})
