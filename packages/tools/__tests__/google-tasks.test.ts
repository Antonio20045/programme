import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { googleTasksTool, parseArgs, _resetClient } from '../src/google-tasks'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/google-tasks.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; statusText: string; data?: unknown }>): ReturnType<typeof vi.fn> {
  const queue = [...responses]
  const mock = vi.fn().mockImplementation(() => {
    const resp = queue.shift() ?? { ok: true, status: 200, statusText: 'OK', data: {} }
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: () => Promise.resolve(resp.data ?? {}),
      text: () => Promise.resolve(JSON.stringify(resp.data ?? {})),
      headers: new Headers(),
    })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('google-tasks tool', () => {
  beforeEach(() => {
    _resetClient()
    vi.stubEnv('GOOGLE_ACCESS_TOKEN', 'test-access-token')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'test-refresh-token')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(googleTasksTool.name).toBe('google-tasks')
    })

    it('runs on server', () => {
      expect(googleTasksTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(googleTasksTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(googleTasksTool.permissions).toContain('net:http')
      expect(googleTasksTool.permissions).toContain('google:tasks')
    })

    it('has action enum in parameters', () => {
      const actionProp = googleTasksTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual(['lists', 'createList', 'list', 'add', 'complete', 'update', 'delete'])
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects non-object args', () => {
      expect(() => parseArgs('string')).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    it('parses lists action', () => {
      expect(parseArgs({ action: 'lists' })).toEqual({ action: 'lists' })
    })

    it('parses createList action', () => {
      expect(parseArgs({ action: 'createList', title: 'My List' })).toEqual({
        action: 'createList',
        title: 'My List',
      })
    })

    it('rejects createList without title', () => {
      expect(() => parseArgs({ action: 'createList' })).toThrow('non-empty "title"')
    })

    it('rejects createList with title exceeding max length', () => {
      const longTitle = 'a'.repeat(1001)
      expect(() => parseArgs({ action: 'createList', title: longTitle })).toThrow('at most 1000')
    })

    it('parses list action with defaults', () => {
      expect(parseArgs({ action: 'list' })).toEqual({
        action: 'list',
        listId: '@default',
        showCompleted: false,
      })
    })

    it('parses list with custom listId', () => {
      expect(parseArgs({ action: 'list', listId: 'abc123' })).toEqual({
        action: 'list',
        listId: 'abc123',
        showCompleted: false,
      })
    })

    it('parses list with showCompleted', () => {
      expect(parseArgs({ action: 'list', showCompleted: true })).toEqual({
        action: 'list',
        listId: '@default',
        showCompleted: true,
      })
    })

    it('parses add action', () => {
      expect(parseArgs({ action: 'add', title: 'Buy milk' })).toEqual({
        action: 'add',
        title: 'Buy milk',
        notes: undefined,
        due: undefined,
        listId: '@default',
      })
    })

    it('parses add with all optional fields', () => {
      expect(parseArgs({
        action: 'add',
        title: 'Buy milk',
        notes: 'From store',
        due: '2025-12-31',
        listId: 'myList',
      })).toEqual({
        action: 'add',
        title: 'Buy milk',
        notes: 'From store',
        due: '2025-12-31',
        listId: 'myList',
      })
    })

    it('rejects add without title', () => {
      expect(() => parseArgs({ action: 'add' })).toThrow('non-empty "title"')
    })

    it('rejects add with title exceeding max length', () => {
      const longTitle = 'a'.repeat(1001)
      expect(() => parseArgs({ action: 'add', title: longTitle })).toThrow('at most 1000')
    })

    it('rejects add with notes exceeding max length', () => {
      const longNotes = 'a'.repeat(8001)
      expect(() => parseArgs({ action: 'add', title: 'Task', notes: longNotes })).toThrow('at most 8000')
    })

    it('rejects add with invalid due date', () => {
      expect(() => parseArgs({ action: 'add', title: 'Task', due: 'not-a-date' })).toThrow('ISO 8601')
    })

    it('accepts valid ISO 8601 due dates', () => {
      expect(() => parseArgs({ action: 'add', title: 'Task', due: '2025-06-15T10:00:00Z' })).not.toThrow()
      expect(() => parseArgs({ action: 'add', title: 'Task', due: '2025-06-15' })).not.toThrow()
    })

    it('parses complete action', () => {
      expect(parseArgs({ action: 'complete', taskId: 'task1' })).toEqual({
        action: 'complete',
        taskId: 'task1',
        listId: '@default',
      })
    })

    it('rejects complete without taskId', () => {
      expect(() => parseArgs({ action: 'complete' })).toThrow('non-empty "taskId"')
    })

    it('parses update action', () => {
      expect(parseArgs({ action: 'update', taskId: 'task1', updates: { title: 'New' } })).toEqual({
        action: 'update',
        taskId: 'task1',
        updates: { title: 'New', notes: undefined, due: undefined, status: undefined },
        listId: '@default',
      })
    })

    it('rejects update without taskId', () => {
      expect(() => parseArgs({ action: 'update', updates: {} })).toThrow('non-empty "taskId"')
    })

    it('rejects update without updates object', () => {
      expect(() => parseArgs({ action: 'update', taskId: 'task1' })).toThrow('"updates" object')
    })

    it('parses delete action', () => {
      expect(parseArgs({ action: 'delete', taskId: 'task1' })).toEqual({
        action: 'delete',
        taskId: 'task1',
        listId: '@default',
      })
    })

    it('rejects delete without taskId', () => {
      expect(() => parseArgs({ action: 'delete' })).toThrow('non-empty "taskId"')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — lists
  // -------------------------------------------------------------------------

  describe('execute lists', () => {
    it('calls task lists endpoint', async () => {
      const mock = mockFetchJson({ items: [{ id: 'list1', title: 'My Tasks' }] })

      const result = await googleTasksTool.execute({ action: 'lists' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { items: unknown[] }

      expect(parsed.items).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('users/@me/lists')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — createList
  // -------------------------------------------------------------------------

  describe('execute createList', () => {
    it('creates a new task list', async () => {
      const mock = mockFetchJson({ id: 'newList', title: 'Shopping' })

      const result = await googleTasksTool.execute({ action: 'createList', title: 'Shopping' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { id: string; title: string }

      expect(parsed.title).toBe('Shopping')
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('POST')
      expect(callArgs[1].body).toBe(JSON.stringify({ title: 'Shopping' }))
    })
  })

  // -------------------------------------------------------------------------
  // Execution — list tasks
  // -------------------------------------------------------------------------

  describe('execute list', () => {
    it('lists tasks from default list', async () => {
      const mock = mockFetchJson({ items: [{ id: 'task1', title: 'Do something' }] })

      const result = await googleTasksTool.execute({ action: 'list' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { items: unknown[] }

      expect(parsed.items).toHaveLength(1)
      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('lists/%40default/tasks')
    })

    it('passes showCompleted params', async () => {
      const mock = mockFetchJson({ items: [] })

      await googleTasksTool.execute({ action: 'list', showCompleted: true })

      const callUrl = (mock.mock.calls[0] as [string])[0]
      expect(callUrl).toContain('showCompleted=true')
      expect(callUrl).toContain('showHidden=true')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — add
  // -------------------------------------------------------------------------

  describe('execute add', () => {
    it('adds a task with title only', async () => {
      const mock = mockFetchJson({ id: 'newTask', title: 'Buy milk' })

      const result = await googleTasksTool.execute({ action: 'add', title: 'Buy milk' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { id: string; title: string }

      expect(parsed.title).toBe('Buy milk')
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('POST')
    })

    it('adds a task with all fields', async () => {
      const mock = mockFetchJson({ id: 'newTask', title: 'Buy milk', notes: 'Whole milk', due: '2025-12-31' })

      await googleTasksTool.execute({
        action: 'add',
        title: 'Buy milk',
        notes: 'Whole milk',
        due: '2025-12-31',
        listId: 'myList',
      })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
      expect(body['title']).toBe('Buy milk')
      expect(body['notes']).toBe('Whole milk')
      expect(body['due']).toBe('2025-12-31')
      expect(callArgs[0]).toContain('lists/myList/tasks')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — complete
  // -------------------------------------------------------------------------

  describe('execute complete', () => {
    it('marks task as completed via PATCH', async () => {
      const mock = mockFetchJson({ id: 'task1', status: 'completed' })

      const result = await googleTasksTool.execute({ action: 'complete', taskId: 'task1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { status: string }

      expect(parsed.status).toBe('completed')
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('PATCH')
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
      expect(body['status']).toBe('completed')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — update
  // -------------------------------------------------------------------------

  describe('execute update', () => {
    it('updates task fields via PATCH', async () => {
      const mock = mockFetchJson({ id: 'task1', title: 'Updated' })

      await googleTasksTool.execute({
        action: 'update',
        taskId: 'task1',
        updates: { title: 'Updated', notes: 'New notes' },
      })

      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('PATCH')
      const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>
      expect(body['title']).toBe('Updated')
      expect(body['notes']).toBe('New notes')
    })
  })

  // -------------------------------------------------------------------------
  // Execution — delete
  // -------------------------------------------------------------------------

  describe('execute delete', () => {
    it('deletes a task via DELETE', async () => {
      const mock = mockFetchJson({}, 204)

      const result = await googleTasksTool.execute({ action: 'delete', taskId: 'task1' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { deleted: boolean; taskId: string }

      expect(parsed.deleted).toBe(true)
      expect(parsed.taskId).toBe('task1')
      const callArgs = mock.mock.calls[0] as [string, RequestInit]
      expect(callArgs[1].method).toBe('DELETE')
    })
  })

  // -------------------------------------------------------------------------
  // Token refresh on 401
  // -------------------------------------------------------------------------

  describe('token refresh', () => {
    it('refreshes token and retries on 401', async () => {
      const mock = mockFetchSequence([
        { ok: false, status: 401, statusText: 'Unauthorized' },
        { ok: true, status: 200, statusText: 'OK', data: { access_token: 'new-token', expires_in: 3600 } },
        { ok: true, status: 200, statusText: 'OK', data: { items: [] } },
      ])

      const result = await googleTasksTool.execute({ action: 'lists' })
      const text = (result.content[0] as { type: 'text'; text: string }).text
      const parsed = JSON.parse(text) as { items: unknown[] }

      expect(parsed.items).toEqual([])
      expect(mock).toHaveBeenCalledTimes(3)
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
      assertNoUnauthorizedFetch(sourceCode, [
        'https://tasks.googleapis.com',
      ])
    })
  })
})
