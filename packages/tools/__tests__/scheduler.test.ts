import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import {
  schedulerTool,
  parseArgs,
  countTodaysProactive,
  countHighPriority,
} from '../src/scheduler'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/scheduler.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock filesystem
// ---------------------------------------------------------------------------

let mockSchedules: string | null = null
let mockBuffer: string | null = null

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (filePath: string) => {
    if (typeof filePath === 'string' && filePath.includes('schedules.json')) {
      if (mockSchedules === null) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return mockSchedules
    }
    if (typeof filePath === 'string' && filePath.includes('working-buffer.json')) {
      if (mockBuffer === null) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return mockBuffer
    }
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    throw err
  }),
  writeFile: vi.fn(async (filePath: string, data: string) => {
    if (typeof filePath === 'string' && filePath.includes('schedules.json')) {
      mockSchedules = data
    } else if (typeof filePath === 'string' && filePath.includes('working-buffer.json')) {
      mockBuffer = data
    }
  }),
  rename: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}))

// Helper to parse result text
function parseResult(result: { content: readonly { type: string; text?: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler tool', () => {
  beforeEach(() => {
    mockSchedules = null
    mockBuffer = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(schedulerTool.name).toBe('scheduler')
    })

    it('runs on server', () => {
      expect(schedulerTool.runsOn).toBe('server')
    })

    it('has fs permissions', () => {
      expect(schedulerTool.permissions).toContain('fs:read')
      expect(schedulerTool.permissions).toContain('fs:write')
    })

    it('does not require confirmation', () => {
      expect(schedulerTool.requiresConfirmation).toBe(false)
    })

    it('has action enum in parameters', () => {
      const actionProp = schedulerTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual([
        'schedule', 'list', 'cancel', 'addProactive', 'buffer', 'clearBuffer',
      ])
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    it('parses schedule action', () => {
      const result = parseArgs({
        action: 'schedule', name: 'Morning report', cron: '0 8 * * *', taskAction: 'Generate report',
      })
      expect(result).toEqual({
        action: 'schedule', name: 'Morning report', cron: '0 8 * * *', taskAction: 'Generate report',
      })
    })

    it('rejects schedule without name', () => {
      expect(() => parseArgs({ action: 'schedule', cron: '0 8 * * *', taskAction: 'x' }))
        .toThrow('non-empty "name"')
    })

    it('rejects schedule with invalid cron', () => {
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: 'invalid', taskAction: 'x' }))
        .toThrow('Invalid cron')
    })

    it('rejects schedule without taskAction', () => {
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: '0 8 * * *' }))
        .toThrow('non-empty "taskAction"')
    })

    it('rejects schedule with too-long action', () => {
      expect(() => parseArgs({
        action: 'schedule', name: 'x', cron: '0 8 * * *', taskAction: 'x'.repeat(2001),
      })).toThrow('Action too long')
    })

    it('parses list action', () => {
      expect(parseArgs({ action: 'list' })).toEqual({ action: 'list' })
    })

    it('parses cancel action', () => {
      expect(parseArgs({ action: 'cancel', id: 'abc' })).toEqual({ action: 'cancel', id: 'abc' })
    })

    it('rejects cancel without id', () => {
      expect(() => parseArgs({ action: 'cancel' })).toThrow('non-empty "id"')
    })

    it('parses addProactive action', () => {
      const result = parseArgs({
        action: 'addProactive',
        proactiveAction: 'Check emails',
        priority: 'normal',
        triggerAt: '2026-02-18T10:00:00Z',
        source: 'calendar',
      })
      expect(result).toHaveProperty('action', 'addProactive')
      expect(result).toHaveProperty('priority', 'normal')
    })

    it('rejects addProactive with invalid priority', () => {
      expect(() => parseArgs({
        action: 'addProactive', proactiveAction: 'x', priority: 'urgent',
        triggerAt: '2026-02-18T10:00:00Z', source: 'test',
      })).toThrow('priority')
    })

    it('parses buffer action', () => {
      expect(parseArgs({ action: 'buffer' })).toEqual({ action: 'buffer' })
    })

    it('parses clearBuffer action', () => {
      expect(parseArgs({ action: 'clearBuffer' })).toEqual({ action: 'clearBuffer' })
    })
  })

  // -------------------------------------------------------------------------
  // Cron validation
  // -------------------------------------------------------------------------

  describe('cron validation', () => {
    it('accepts standard cron expressions', () => {
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: '0 8 * * *', taskAction: 'x' })).not.toThrow()
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: '*/15 * * * *', taskAction: 'x' })).not.toThrow()
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: '0 9 1 * 1-5', taskAction: 'x' })).not.toThrow()
    })

    it('rejects invalid cron expressions', () => {
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: '0 8 * *', taskAction: 'x' })).toThrow('Invalid cron')
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: '', taskAction: 'x' })).toThrow()
      expect(() => parseArgs({ action: 'schedule', name: 'x', cron: 'every 5 min', taskAction: 'x' })).toThrow('Invalid cron')
    })
  })

  // -------------------------------------------------------------------------
  // schedule()
  // -------------------------------------------------------------------------

  describe('schedule()', () => {
    it('creates a scheduled task', async () => {
      const result = await schedulerTool.execute({
        action: 'schedule', name: 'Morning', cron: '0 8 * * *', taskAction: 'Report',
      })
      const parsed = parseResult(result)
      expect(parsed['scheduled']).toBe(true)
      expect(parsed['id']).toBeDefined()
      expect(parsed['name']).toBe('Morning')
    })

    it('enforces max tasks limit', async () => {
      const tasks = Array.from({ length: 50 }, (_, i) => ({
        id: String(i), name: `task${String(i)}`, cron: '0 8 * * *',
        action: 'test', enabled: true, createdAt: new Date().toISOString(),
      }))
      mockSchedules = JSON.stringify({ tasks })

      await expect(
        schedulerTool.execute({ action: 'schedule', name: 'x', cron: '0 8 * * *', taskAction: 'x' }),
      ).rejects.toThrow('Max scheduled tasks')
    })
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('lists all tasks', async () => {
      await schedulerTool.execute({
        action: 'schedule', name: 'Task A', cron: '0 8 * * *', taskAction: 'A',
      })

      const result = await schedulerTool.execute({ action: 'list' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
    })

    it('returns empty when no tasks', async () => {
      const result = await schedulerTool.execute({ action: 'list' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(0)
      expect(parsed['tasks']).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------

  describe('cancel()', () => {
    it('cancels a task by id', async () => {
      const createResult = await schedulerTool.execute({
        action: 'schedule', name: 'To cancel', cron: '0 8 * * *', taskAction: 'x',
      })
      const taskId = parseResult(createResult)['id'] as string

      const result = await schedulerTool.execute({ action: 'cancel', id: taskId })
      const parsed = parseResult(result)
      expect(parsed['cancelled']).toBe(true)

      const listResult = await schedulerTool.execute({ action: 'list' })
      expect(parseResult(listResult)['count']).toBe(0)
    })

    it('throws on non-existent id', async () => {
      await expect(
        schedulerTool.execute({ action: 'cancel', id: 'non-existent' }),
      ).rejects.toThrow('Task not found')
    })
  })

  // -------------------------------------------------------------------------
  // addProactive()
  // -------------------------------------------------------------------------

  describe('addProactive()', () => {
    it('adds a proactive action to buffer', async () => {
      const result = await schedulerTool.execute({
        action: 'addProactive',
        proactiveAction: 'Check emails',
        priority: 'normal',
        triggerAt: '2026-02-18T10:00:00Z',
        source: 'calendar',
      })
      const parsed = parseResult(result)
      expect(parsed['added']).toBe(true)
      expect(parsed['id']).toBeDefined()
      expect(parsed['dailyCount']).toBe(1)
    })

    it('enforces max buffer entries', async () => {
      const pendingActions = Array.from({ length: 50 }, (_, i) => ({
        id: String(i), priority: 'normal', action: `action${String(i)}`,
        triggerAt: '2026-02-18T10:00:00Z', source: 'test',
        createdAt: '2026-01-01T00:00:00Z', // old date to not hit daily limit
      }))
      mockBuffer = JSON.stringify({ pendingActions })

      await expect(
        schedulerTool.execute({
          action: 'addProactive', proactiveAction: 'one more',
          priority: 'normal', triggerAt: '2026-02-18T10:00:00Z', source: 'test',
        }),
      ).rejects.toThrow('buffer full')
    })

    it('enforces daily proactive limit', async () => {
      const today = new Date().toISOString()
      const pendingActions = Array.from({ length: 10 }, (_, i) => ({
        id: String(i), priority: 'normal', action: `action${String(i)}`,
        triggerAt: '2026-02-18T10:00:00Z', source: 'test', createdAt: today,
      }))
      mockBuffer = JSON.stringify({ pendingActions })

      await expect(
        schedulerTool.execute({
          action: 'addProactive', proactiveAction: 'one more',
          priority: 'normal', triggerAt: '2026-02-18T10:00:00Z', source: 'test',
        }),
      ).rejects.toThrow('Daily proactive limit')
    })

    it('enforces max high-priority limit', async () => {
      const pendingActions = Array.from({ length: 3 }, (_, i) => ({
        id: String(i), priority: 'high', action: `action${String(i)}`,
        triggerAt: '2026-02-18T10:00:00Z', source: 'test',
        createdAt: '2026-01-01T00:00:00Z',
      }))
      mockBuffer = JSON.stringify({ pendingActions })

      await expect(
        schedulerTool.execute({
          action: 'addProactive', proactiveAction: 'urgent',
          priority: 'high', triggerAt: '2026-02-18T10:00:00Z', source: 'test',
        }),
      ).rejects.toThrow('Max high-priority')
    })
  })

  // -------------------------------------------------------------------------
  // buffer()
  // -------------------------------------------------------------------------

  describe('buffer()', () => {
    it('shows pending actions', async () => {
      await schedulerTool.execute({
        action: 'addProactive', proactiveAction: 'Check mail',
        priority: 'normal', triggerAt: '2026-02-18T10:00:00Z', source: 'test',
      })

      const result = await schedulerTool.execute({ action: 'buffer' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(1)
    })

    it('returns empty when no actions', async () => {
      const result = await schedulerTool.execute({ action: 'buffer' })
      const parsed = parseResult(result)
      expect(parsed['count']).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // clearBuffer()
  // -------------------------------------------------------------------------

  describe('clearBuffer()', () => {
    it('clears all pending actions', async () => {
      await schedulerTool.execute({
        action: 'addProactive', proactiveAction: 'Check mail',
        priority: 'normal', triggerAt: '2026-02-18T10:00:00Z', source: 'test',
      })

      const result = await schedulerTool.execute({ action: 'clearBuffer' })
      expect(parseResult(result)['cleared']).toBe(true)

      const bufferResult = await schedulerTool.execute({ action: 'buffer' })
      expect(parseResult(bufferResult)['count']).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Exported helpers
  // -------------------------------------------------------------------------

  describe('countTodaysProactive()', () => {
    it('counts only todays actions', () => {
      const today = new Date().toISOString()
      const yesterday = new Date(Date.now() - 86_400_000).toISOString()
      const actions = [
        { id: '1', priority: 'normal' as const, action: 'a', triggerAt: '', source: '', createdAt: today },
        { id: '2', priority: 'normal' as const, action: 'b', triggerAt: '', source: '', createdAt: yesterday },
      ]
      expect(countTodaysProactive(actions)).toBe(1)
    })
  })

  describe('countHighPriority()', () => {
    it('counts high priority actions', () => {
      const actions = [
        { id: '1', priority: 'high' as const, action: 'a', triggerAt: '', source: '', createdAt: '' },
        { id: '2', priority: 'normal' as const, action: 'b', triggerAt: '', source: '', createdAt: '' },
        { id: '3', priority: 'high' as const, action: 'c', triggerAt: '', source: '', createdAt: '' },
      ]
      expect(countHighPriority(actions)).toBe(2)
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

    it('has no network access', () => {
      const fetchPattern = /\bfetch\s*\(/
      expect(sourceCode).not.toMatch(fetchPattern)
    })

    it('uses hardcoded workspace path', () => {
      expect(sourceCode).toContain('.openclaw')
      expect(sourceCode).toContain('workspace')
    })

    it('enforces action length limit', () => {
      expect(sourceCode).toContain('MAX_ACTION_LENGTH')
    })

    it('enforces max tasks limit', () => {
      expect(sourceCode).toContain('MAX_SCHEDULED_TASKS')
    })

    it('validates cron expressions', () => {
      expect(sourceCode).toContain('CRON_REGEX')
    })
  })
})
