import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import {
  knowledgeTool,
  parseArgs,
  matchesFact,
  isSensitiveContent,
  countTodaysLearnings,
} from '../src/knowledge'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/knowledge.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock filesystem
// ---------------------------------------------------------------------------

// Shared in-memory store for fs mock
let mockStore: string | null = null

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (mockStore === null) {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    return mockStore
  }),
  writeFile: vi.fn(async (_path: string, data: string) => {
    mockStore = data
  }),
  rename: vi.fn(async () => {
    // noop — tmp→final handled by writeFile mock
  }),
  mkdir: vi.fn(async () => undefined),
}))

// Helper to parse result text
function parseResult(result: { content: readonly { type: string; text?: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('knowledge tool', () => {
  beforeEach(() => {
    // Reset to empty store (ENOENT)
    mockStore = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(knowledgeTool.name).toBe('knowledge')
    })

    it('runs on server', () => {
      expect(knowledgeTool.runsOn).toBe('server')
    })

    it('has fs permissions', () => {
      expect(knowledgeTool.permissions).toContain('fs:read')
      expect(knowledgeTool.permissions).toContain('fs:write')
    })

    it('does not require confirmation', () => {
      expect(knowledgeTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // store()
  // -------------------------------------------------------------------------

  describe('store()', () => {
    it('stores a fact and returns id', async () => {
      const result = await knowledgeTool.execute({
        action: 'store',
        content: 'User prefers dark mode',
        category: 'preferences',
        tags: ['ui', 'theme'],
      })
      const parsed = parseResult(result)
      expect(parsed['stored']).toBe(true)
      expect(parsed['id']).toBeDefined()
      expect(parsed['category']).toBe('preferences')
    })

    it('defaults category to other', async () => {
      const result = await knowledgeTool.execute({
        action: 'store',
        content: 'Random fact',
      })
      const parsed = parseResult(result)
      expect(parsed['category']).toBe('other')
    })

    it('warns on sensitive content', async () => {
      const result = await knowledgeTool.execute({
        action: 'store',
        content: 'My password is hunter2',
      })
      const parsed = parseResult(result)
      expect(parsed['warning']).toBeDefined()
      expect(String(parsed['warning'])).toContain('sensitive')
    })

    it('rejects empty content', async () => {
      await expect(
        knowledgeTool.execute({ action: 'store', content: '' }),
      ).rejects.toThrow('non-empty "content"')
    })

    it('rejects content exceeding max length', async () => {
      const longContent = 'x'.repeat(2001)
      await expect(
        knowledgeTool.execute({ action: 'store', content: longContent }),
      ).rejects.toThrow('too long')
    })

    it('rejects invalid confidence', async () => {
      await expect(
        knowledgeTool.execute({ action: 'store', content: 'fact', confidence: 2 }),
      ).rejects.toThrow('between 0 and 1')
    })

    it('enforces max facts limit', async () => {
      const facts = Array.from({ length: 5000 }, (_, i) => ({
        id: String(i),
        content: `fact ${String(i)}`,
        category: 'other',
        tags: [],
        confidence: 1,
        source: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
      mockStore = JSON.stringify({ facts })

      await expect(
        knowledgeTool.execute({ action: 'store', content: 'one more fact' }),
      ).rejects.toThrow('full')
    })
  })

  // -------------------------------------------------------------------------
  // recall()
  // -------------------------------------------------------------------------

  describe('recall()', () => {
    it('finds facts by content match', async () => {
      await knowledgeTool.execute({ action: 'store', content: 'User likes TypeScript', tags: ['programming'] })
      await knowledgeTool.execute({ action: 'store', content: 'User prefers Python', tags: ['programming'] })

      const result = await knowledgeTool.execute({ action: 'recall', query: 'TypeScript' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
      expect((parsed['results'] as Array<{ content: string }>)[0]?.content).toBe('User likes TypeScript')
    })

    it('finds facts by tag match', async () => {
      await knowledgeTool.execute({ action: 'store', content: 'Fact one', tags: ['coding'] })

      const result = await knowledgeTool.execute({ action: 'recall', query: 'coding' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
    })

    it('filters by category', async () => {
      await knowledgeTool.execute({ action: 'store', content: 'Work meeting at 10', category: 'work' })
      await knowledgeTool.execute({ action: 'store', content: 'Personal meeting at 3', category: 'personal' })

      const result = await knowledgeTool.execute({ action: 'recall', query: 'meeting', category: 'work' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
      expect((parsed['results'] as Array<{ category: string }>)[0]?.category).toBe('work')
    })

    it('returns empty results for no match', async () => {
      const result = await knowledgeTool.execute({ action: 'recall', query: 'nonexistent' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(0)
    })

    it('rejects empty query', async () => {
      await expect(
        knowledgeTool.execute({ action: 'recall', query: '' }),
      ).rejects.toThrow('non-empty "query"')
    })
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('lists all facts', async () => {
      await knowledgeTool.execute({ action: 'store', content: 'Fact A' })
      await knowledgeTool.execute({ action: 'store', content: 'Fact B' })

      const result = await knowledgeTool.execute({ action: 'list' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(2)
    })

    it('filters list by category', async () => {
      await knowledgeTool.execute({ action: 'store', content: 'Work fact', category: 'work' })
      await knowledgeTool.execute({ action: 'store', content: 'Health fact', category: 'health' })

      const result = await knowledgeTool.execute({ action: 'list', category: 'health' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
    })

    it('returns empty list when no facts', async () => {
      const result = await knowledgeTool.execute({ action: 'list' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(0)
      expect(parsed['facts']).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // forget()
  // -------------------------------------------------------------------------

  describe('forget()', () => {
    it('deletes a fact by id', async () => {
      const storeResult = await knowledgeTool.execute({ action: 'store', content: 'To be deleted' })
      const storeData = parseResult(storeResult)
      const factId = storeData['id'] as string

      const result = await knowledgeTool.execute({ action: 'forget', id: factId })
      const parsed = parseResult(result)
      expect(parsed['forgotten']).toBe(true)

      // Verify it's gone
      const listResult = await knowledgeTool.execute({ action: 'list' })
      const listData = parseResult(listResult)
      expect(listData['count']).toBe(0)
    })

    it('throws on non-existent id', async () => {
      await expect(
        knowledgeTool.execute({ action: 'forget', id: 'non-existent-id' }),
      ).rejects.toThrow('Fact not found')
    })

    it('rejects empty id', async () => {
      await expect(
        knowledgeTool.execute({ action: 'forget', id: '' }),
      ).rejects.toThrow('non-empty "id"')
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------

  describe('update()', () => {
    it('updates fact content', async () => {
      const storeResult = await knowledgeTool.execute({ action: 'store', content: 'Original' })
      const factId = parseResult(storeResult)['id'] as string

      await knowledgeTool.execute({ action: 'update', id: factId, content: 'Updated' })

      const listResult = await knowledgeTool.execute({ action: 'list' })
      const facts = (parseResult(listResult)['facts'] as Array<{ content: string }>)
      expect(facts[0]?.content).toBe('Updated')
    })

    it('updates fact category', async () => {
      const storeResult = await knowledgeTool.execute({ action: 'store', content: 'Fact', category: 'work' })
      const factId = parseResult(storeResult)['id'] as string

      await knowledgeTool.execute({ action: 'update', id: factId, category: 'personal' })

      const listResult = await knowledgeTool.execute({ action: 'list' })
      const facts = (parseResult(listResult)['facts'] as Array<{ category: string }>)
      expect(facts[0]?.category).toBe('personal')
    })

    it('throws on non-existent id', async () => {
      await expect(
        knowledgeTool.execute({ action: 'update', id: 'non-existent-id', content: 'new' }),
      ).rejects.toThrow('Fact not found')
    })

    it('rejects empty id', async () => {
      await expect(
        knowledgeTool.execute({ action: 'update', id: '' }),
      ).rejects.toThrow('non-empty "id"')
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(knowledgeTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(knowledgeTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        knowledgeTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })
  })

  // -------------------------------------------------------------------------
  // Exported helpers
  // -------------------------------------------------------------------------

  describe('matchesFact()', () => {
    const fact = {
      id: '1',
      content: 'User likes TypeScript',
      category: 'preferences' as const,
      tags: ['programming', 'language'],
      confidence: 1,
      source: '',
      createdAt: '',
      updatedAt: '',
    }

    it('matches on content (case-insensitive)', () => {
      expect(matchesFact(fact, 'typescript')).toBe(true)
    })

    it('matches on tags', () => {
      expect(matchesFact(fact, 'programming')).toBe(true)
    })

    it('returns false for non-match', () => {
      expect(matchesFact(fact, 'python')).toBe(false)
    })
  })

  describe('isSensitiveContent()', () => {
    it('detects password', () => {
      expect(isSensitiveContent('my password is secret')).toBe(true)
    })

    it('detects api key', () => {
      expect(isSensitiveContent('api_key: abc123')).toBe(true)
    })

    it('detects bearer token', () => {
      expect(isSensitiveContent('bearer abc123xyz')).toBe(true)
    })

    it('returns false for normal text', () => {
      expect(isSensitiveContent('User likes dark mode')).toBe(false)
    })
  })

  describe('parseArgs()', () => {
    it('defaults unknown category to other', () => {
      const result = parseArgs({ action: 'store', content: 'fact', category: 'unknown' })
      expect((result as { category: string }).category).toBe('other')
    })

    it('limits tags to MAX_TAGS', () => {
      const tags = Array.from({ length: 20 }, (_, i) => `tag${String(i)}`)
      const result = parseArgs({ action: 'store', content: 'fact', tags })
      expect((result as { tags: readonly string[] }).tags.length).toBe(10)
    })

    it('truncates long tags', () => {
      const longTag = 'a'.repeat(100)
      const result = parseArgs({ action: 'store', content: 'fact', tags: [longTag] })
      expect((result as unknown as { tags: readonly string[] }).tags[0]?.length).toBe(50)
    })
  })

  // -------------------------------------------------------------------------
  // logLearning()
  // -------------------------------------------------------------------------

  describe('logLearning()', () => {
    it('logs a learning and returns id', async () => {
      const result = await knowledgeTool.execute({
        action: 'logLearning',
        content: 'User prefers concise answers',
        type: 'user_correction',
        tags: ['style'],
      })
      const parsed = parseResult(result)
      expect(parsed['logged']).toBe(true)
      expect(parsed['id']).toBeDefined()
      expect(parsed['type']).toBe('user_correction')
      expect(parsed['dailyCount']).toBe(1)
    })

    it('stores with category learning', async () => {
      await knowledgeTool.execute({
        action: 'logLearning',
        content: 'Learned something',
        type: 'best_practice',
      })

      const result = await knowledgeTool.execute({ action: 'list', category: 'learning' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
    })

    it('stores trigger and appliesTo', async () => {
      await knowledgeTool.execute({
        action: 'logLearning',
        content: 'Do not use var',
        type: 'error_correction',
        trigger: 'User said var is bad',
        appliesTo: ['javascript', 'typescript'],
      })

      const result = await knowledgeTool.execute({ action: 'list', category: 'learning' })
      const facts = (parseResult(result)['facts'] as Array<{ trigger?: string; appliesTo?: string[] }>)
      expect(facts[0]?.trigger).toBe('User said var is bad')
      expect(facts[0]?.appliesTo).toEqual(['javascript', 'typescript'])
    })

    it('rejects invalid type', async () => {
      await expect(
        knowledgeTool.execute({ action: 'logLearning', content: 'test', type: 'invalid' }),
      ).rejects.toThrow('valid "type"')
    })

    it('rejects empty content', async () => {
      await expect(
        knowledgeTool.execute({ action: 'logLearning', content: '', type: 'best_practice' }),
      ).rejects.toThrow('non-empty "content"')
    })

    it('rejects trigger exceeding max length', async () => {
      await expect(
        knowledgeTool.execute({
          action: 'logLearning',
          content: 'test',
          type: 'best_practice',
          trigger: 'x'.repeat(501),
        }),
      ).rejects.toThrow('Trigger too long')
    })

    it('limits appliesTo to 10 entries', async () => {
      const appliesTo = Array.from({ length: 15 }, (_, i) => `ctx${String(i)}`)
      await knowledgeTool.execute({
        action: 'logLearning',
        content: 'test',
        type: 'best_practice',
        appliesTo,
      })

      const result = await knowledgeTool.execute({ action: 'list', category: 'learning' })
      const facts = (parseResult(result)['facts'] as Array<{ appliesTo?: string[] }>)
      expect(facts[0]?.appliesTo?.length).toBe(10)
    })

    it('enforces daily learning limit', async () => {
      const facts = Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        content: `learning ${String(i)}`,
        category: 'learning',
        tags: [],
        confidence: 1,
        source: 'self-learning',
        type: 'best_practice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
      mockStore = JSON.stringify({ facts })

      await expect(
        knowledgeTool.execute({ action: 'logLearning', content: 'one more', type: 'best_practice' }),
      ).rejects.toThrow('Daily learning limit')
    })
  })

  // -------------------------------------------------------------------------
  // reviewLearnings()
  // -------------------------------------------------------------------------

  describe('reviewLearnings()', () => {
    it('returns learnings sorted by createdAt desc', async () => {
      // Use mock store with explicit timestamps to ensure deterministic order
      const today = new Date().toISOString().slice(0, 10)
      mockStore = JSON.stringify({
        facts: [
          {
            id: 'l1', content: 'First', category: 'learning', tags: [], confidence: 1,
            source: 'self-learning', type: 'best_practice',
            createdAt: `${today}T01:00:00.000Z`, updatedAt: `${today}T01:00:00.000Z`,
          },
          {
            id: 'l2', content: 'Second', category: 'learning', tags: [], confidence: 1,
            source: 'self-learning', type: 'error_correction',
            createdAt: `${today}T02:00:00.000Z`, updatedAt: `${today}T02:00:00.000Z`,
          },
        ],
      })

      const result = await knowledgeTool.execute({ action: 'reviewLearnings' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(2)
      const learnings = parsed['learnings'] as Array<{ content: string }>
      expect(learnings[0]?.content).toBe('Second')
      expect(learnings[1]?.content).toBe('First')
    })

    it('limits results to 5', async () => {
      for (let i = 0; i < 8; i++) {
        await knowledgeTool.execute({
          action: 'logLearning', content: `Learning ${String(i)}`, type: 'best_practice',
        })
      }

      const result = await knowledgeTool.execute({ action: 'reviewLearnings' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(5)
    })

    it('filters by tags (substring match)', async () => {
      await knowledgeTool.execute({
        action: 'logLearning', content: 'JS thing', type: 'best_practice', tags: ['javascript'],
      })
      await knowledgeTool.execute({
        action: 'logLearning', content: 'Python thing', type: 'best_practice', tags: ['python'],
      })

      const result = await knowledgeTool.execute({ action: 'reviewLearnings', tags: ['java'] })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
      expect((parsed['learnings'] as Array<{ content: string }>)[0]?.content).toBe('JS thing')
    })

    it('filters by appliesTo (exact match)', async () => {
      await knowledgeTool.execute({
        action: 'logLearning', content: 'TS rule', type: 'best_practice', appliesTo: ['typescript'],
      })
      await knowledgeTool.execute({
        action: 'logLearning', content: 'Generic rule', type: 'best_practice',
      })

      const result = await knowledgeTool.execute({ action: 'reviewLearnings', appliesTo: 'typescript' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
      expect((parsed['learnings'] as Array<{ content: string }>)[0]?.content).toBe('TS rule')
    })

    it('returns empty when no learnings exist', async () => {
      const result = await knowledgeTool.execute({ action: 'reviewLearnings' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(0)
      expect(parsed['learnings']).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // countTodaysLearnings()
  // -------------------------------------------------------------------------

  describe('countTodaysLearnings()', () => {
    it('counts only todays learnings', () => {
      const today = new Date().toISOString()
      const yesterday = new Date(Date.now() - 86_400_000).toISOString()
      const facts = [
        { id: '1', content: 'a', category: 'learning' as const, tags: [], confidence: 1, source: '', createdAt: today, updatedAt: today },
        { id: '2', content: 'b', category: 'learning' as const, tags: [], confidence: 1, source: '', createdAt: yesterday, updatedAt: yesterday },
        { id: '3', content: 'c', category: 'other' as const, tags: [], confidence: 1, source: '', createdAt: today, updatedAt: today },
      ]
      expect(countTodaysLearnings(facts)).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('uses hardcoded knowledge path', () => {
      expect(sourceCode).toContain('.openclaw')
      expect(sourceCode).toContain('knowledge.json')
    })

    it('enforces content length limit', () => {
      expect(sourceCode).toContain('MAX_CONTENT_LENGTH')
    })

    it('enforces max facts limit', () => {
      expect(sourceCode).toContain('MAX_FACTS')
    })

    it('detects sensitive content before storing', () => {
      expect(sourceCode).toContain('isSensitiveContent')
    })

    it('has no network access', () => {
      // Knowledge tool should never make HTTP requests
      const fetchPattern = /\bfetch\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })
  })
})
