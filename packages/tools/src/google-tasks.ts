/**
 * Google Tasks tool — manage task lists and tasks.
 * Full CRUD via Google Tasks API.
 *
 * URL policy: Only requests to tasks.googleapis.com.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'
import { createGoogleApiClient, type GoogleApiClient } from './google-api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://tasks.googleapis.com/tasks/v1'
const MAX_PAGE_SIZE = 100
const MAX_TITLE_LENGTH = 1_000
const MAX_NOTES_LENGTH = 8_000
const DEFAULT_LIST_ID = '@default'

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'tasks.googleapis.com',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListsArgs {
  readonly action: 'lists'
}

interface CreateListArgs {
  readonly action: 'createList'
  readonly title: string
}

interface ListTasksArgs {
  readonly action: 'list'
  readonly listId: string
  readonly showCompleted: boolean
}

interface AddArgs {
  readonly action: 'add'
  readonly title: string
  readonly notes?: string
  readonly due?: string
  readonly listId: string
}

interface CompleteArgs {
  readonly action: 'complete'
  readonly taskId: string
  readonly listId: string
}

interface UpdateArgs {
  readonly action: 'update'
  readonly taskId: string
  readonly updates: {
    readonly title?: string
    readonly notes?: string
    readonly due?: string
    readonly status?: string
  }
  readonly listId: string
}

interface DeleteArgs {
  readonly action: 'delete'
  readonly taskId: string
  readonly listId: string
}

type TasksArgs = ListsArgs | CreateListArgs | ListTasksArgs | AddArgs | CompleteArgs | UpdateArgs | DeleteArgs

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function getAccessToken(): Promise<string> {
  const token = process.env['GOOGLE_ACCESS_TOKEN']
  if (token) return Promise.resolve(token)
  throw new Error('GOOGLE_ACCESS_TOKEN environment variable is required')
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: GoogleApiClient | undefined

function getClient(): GoogleApiClient {
  if (!client) {
    client = createGoogleApiClient({
      getAccessToken,
      allowedHosts: ALLOWED_HOSTS,
    })
  }
  return client
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

function validateDueDate(due: string): void {
  if (!ISO_8601_REGEX.test(due)) {
    throw new Error('due must be a valid ISO 8601 date string')
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): TasksArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'lists') {
    return { action: 'lists' }
  }

  if (action === 'createList') {
    const title = obj['title']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('createList requires a non-empty "title" string')
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      throw new Error(`title must be at most ${String(MAX_TITLE_LENGTH)} characters`)
    }
    return { action: 'createList', title: title.trim() }
  }

  if (action === 'list') {
    const listId = typeof obj['listId'] === 'string' && obj['listId'].trim() !== ''
      ? obj['listId'].trim()
      : DEFAULT_LIST_ID
    const showCompleted = obj['showCompleted'] === true
    return { action: 'list', listId, showCompleted }
  }

  if (action === 'add') {
    const title = obj['title']
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('add requires a non-empty "title" string')
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      throw new Error(`title must be at most ${String(MAX_TITLE_LENGTH)} characters`)
    }
    const notes = typeof obj['notes'] === 'string' ? obj['notes'].trim() : undefined
    if (notes !== undefined && notes.length > MAX_NOTES_LENGTH) {
      throw new Error(`notes must be at most ${String(MAX_NOTES_LENGTH)} characters`)
    }
    const due = typeof obj['due'] === 'string' ? obj['due'].trim() : undefined
    if (due !== undefined) {
      validateDueDate(due)
    }
    const listId = typeof obj['listId'] === 'string' && obj['listId'].trim() !== ''
      ? obj['listId'].trim()
      : DEFAULT_LIST_ID
    return { action: 'add', title: title.trim(), notes, due, listId }
  }

  if (action === 'complete') {
    const taskId = obj['taskId']
    if (typeof taskId !== 'string' || taskId.trim() === '') {
      throw new Error('complete requires a non-empty "taskId" string')
    }
    const listId = typeof obj['listId'] === 'string' && obj['listId'].trim() !== ''
      ? obj['listId'].trim()
      : DEFAULT_LIST_ID
    return { action: 'complete', taskId: taskId.trim(), listId }
  }

  if (action === 'update') {
    const taskId = obj['taskId']
    if (typeof taskId !== 'string' || taskId.trim() === '') {
      throw new Error('update requires a non-empty "taskId" string')
    }
    const updates = obj['updates']
    if (typeof updates !== 'object' || updates === null) {
      throw new Error('update requires an "updates" object')
    }
    const u = updates as Record<string, unknown>
    const title = typeof u['title'] === 'string' ? u['title'].trim() : undefined
    if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
      throw new Error(`title must be at most ${String(MAX_TITLE_LENGTH)} characters`)
    }
    const notes = typeof u['notes'] === 'string' ? u['notes'].trim() : undefined
    if (notes !== undefined && notes.length > MAX_NOTES_LENGTH) {
      throw new Error(`notes must be at most ${String(MAX_NOTES_LENGTH)} characters`)
    }
    const due = typeof u['due'] === 'string' ? u['due'].trim() : undefined
    if (due !== undefined) {
      validateDueDate(due)
    }
    const status = typeof u['status'] === 'string' ? u['status'].trim() : undefined
    const listId = typeof obj['listId'] === 'string' && obj['listId'].trim() !== ''
      ? obj['listId'].trim()
      : DEFAULT_LIST_ID
    return {
      action: 'update',
      taskId: taskId.trim(),
      updates: { title, notes, due, status },
      listId,
    }
  }

  if (action === 'delete') {
    const taskId = obj['taskId']
    if (typeof taskId !== 'string' || taskId.trim() === '') {
      throw new Error('delete requires a non-empty "taskId" string')
    }
    const listId = typeof obj['listId'] === 'string' && obj['listId'].trim() !== ''
      ? obj['listId'].trim()
      : DEFAULT_LIST_ID
    return { action: 'delete', taskId: taskId.trim(), listId }
  }

  throw new Error(
    'action must be "lists", "createList", "list", "add", "complete", "update", or "delete"',
  )
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

async function executeLists(): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.get(`${API_BASE}/users/@me/lists`)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeCreateList(title: string): Promise<AgentToolResult> {
  const api = getClient()
  const result = await api.post(`${API_BASE}/users/@me/lists`, { title })
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeListTasks(listId: string, showCompleted: boolean): Promise<AgentToolResult> {
  const api = getClient()
  const params: Record<string, string> = {
    maxResults: String(MAX_PAGE_SIZE),
  }
  if (showCompleted) {
    params['showCompleted'] = 'true'
    params['showHidden'] = 'true'
  }
  const encodedListId = encodeURIComponent(listId)
  const result = await api.get(`${API_BASE}/lists/${encodedListId}/tasks`, params)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeAdd(parsed: AddArgs): Promise<AgentToolResult> {
  const api = getClient()
  const body: Record<string, unknown> = { title: parsed.title }
  if (parsed.notes !== undefined) body['notes'] = parsed.notes
  if (parsed.due !== undefined) body['due'] = parsed.due
  const encodedListId = encodeURIComponent(parsed.listId)
  const result = await api.post(`${API_BASE}/lists/${encodedListId}/tasks`, body)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeComplete(taskId: string, listId: string): Promise<AgentToolResult> {
  const api = getClient()
  const encodedListId = encodeURIComponent(listId)
  const encodedTaskId = encodeURIComponent(taskId)
  const result = await api.patch(
    `${API_BASE}/lists/${encodedListId}/tasks/${encodedTaskId}`,
    { status: 'completed' },
  )
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeUpdate(parsed: UpdateArgs): Promise<AgentToolResult> {
  const api = getClient()
  const body: Record<string, unknown> = {}
  if (parsed.updates.title !== undefined) body['title'] = parsed.updates.title
  if (parsed.updates.notes !== undefined) body['notes'] = parsed.updates.notes
  if (parsed.updates.due !== undefined) body['due'] = parsed.updates.due
  if (parsed.updates.status !== undefined) body['status'] = parsed.updates.status
  const encodedListId = encodeURIComponent(parsed.listId)
  const encodedTaskId = encodeURIComponent(parsed.taskId)
  const result = await api.patch(
    `${API_BASE}/lists/${encodedListId}/tasks/${encodedTaskId}`,
    body,
  )
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

async function executeDelete(taskId: string, listId: string): Promise<AgentToolResult> {
  const api = getClient()
  const encodedListId = encodeURIComponent(listId)
  const encodedTaskId = encodeURIComponent(taskId)
  await api.del(`${API_BASE}/lists/${encodedListId}/tasks/${encodedTaskId}`)
  return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, taskId }) }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const tasksParameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform: lists, createList, list, add, complete, update, or delete',
      enum: ['lists', 'createList', 'list', 'add', 'complete', 'update', 'delete'],
    },
    title: {
      type: 'string',
      description: 'Task or list title (createList, add)',
    },
    taskId: {
      type: 'string',
      description: 'Task ID (complete, update, delete)',
    },
    listId: {
      type: 'string',
      description: 'Task list ID (defaults to @default)',
    },
    showCompleted: {
      type: 'boolean',
      description: 'Show completed tasks (list, default false)',
    },
    notes: {
      type: 'string',
      description: 'Task notes (add)',
    },
    due: {
      type: 'string',
      description: 'Due date as ISO 8601 (add)',
    },
    updates: {
      type: 'object',
      description: 'Fields to update (update)',
      properties: {
        title: { type: 'string', description: 'New title' },
        notes: { type: 'string', description: 'New notes' },
        due: { type: 'string', description: 'New due date (ISO 8601)' },
        status: { type: 'string', description: 'New status (needsAction or completed)' },
      },
    },
  },
  required: ['action'],
}

export const googleTasksTool: ExtendedAgentTool = {
  name: 'google-tasks',
  description:
    'Manage Google Tasks. Actions: lists(), createList(title), list(listId?, showCompleted?), add(title, notes?, due?, listId?), complete(taskId, listId?), update(taskId, updates, listId?), delete(taskId, listId?). Confirmation required.',
  parameters: tasksParameters,
  permissions: ['net:http', 'google:tasks'],
  requiresConfirmation: true,
  defaultRiskTier: 2,
  riskTiers: { lists: 1, list: 1, add: 2, complete: 2, update: 2, createList: 2, delete: 4 },
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'lists':
        return executeLists()
      case 'createList':
        return executeCreateList(parsed.title)
      case 'list':
        return executeListTasks(parsed.listId, parsed.showCompleted)
      case 'add':
        return executeAdd(parsed)
      case 'complete':
        return executeComplete(parsed.taskId, parsed.listId)
      case 'update':
        return executeUpdate(parsed)
      case 'delete':
        return executeDelete(parsed.taskId, parsed.listId)
    }
  },
}

export { parseArgs }

/** Test-only: resets the client instance. */
export function _resetClient(): void {
  client = undefined
}
