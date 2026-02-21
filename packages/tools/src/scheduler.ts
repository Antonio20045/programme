/**
 * Scheduler tool — schedule tasks and manage a proactive working buffer.
 * Data stored as JSON in ~/.openclaw/workspace/.
 *
 * No external dependencies. Atomic writes via tmp+rename.
 * No network access. No eval.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduledTask {
  readonly id: string
  readonly name: string
  readonly cron: string
  readonly action: string
  readonly enabled: boolean
  readonly createdAt: string
}

interface ProactiveAction {
  readonly id: string
  readonly priority: 'high' | 'normal' | 'low'
  readonly action: string
  readonly triggerAt: string
  readonly source: string
  readonly createdAt: string
}

interface SchedulerStore {
  readonly tasks: ScheduledTask[]
}

interface WorkingBuffer {
  readonly pendingActions: ProactiveAction[]
}

// ---------------------------------------------------------------------------
// Arg types
// ---------------------------------------------------------------------------

interface ScheduleArgs {
  readonly action: 'schedule'
  readonly name: string
  readonly cron: string
  readonly taskAction: string
}

interface ListArgs {
  readonly action: 'list'
}

interface CancelArgs {
  readonly action: 'cancel'
  readonly id: string
}

interface AddProactiveArgs {
  readonly action: 'addProactive'
  readonly proactiveAction: string
  readonly priority: 'high' | 'normal' | 'low'
  readonly triggerAt: string
  readonly source: string
}

interface BufferArgs {
  readonly action: 'buffer'
}

interface ClearBufferArgs {
  readonly action: 'clearBuffer'
}

type SchedulerArgs = ScheduleArgs | ListArgs | CancelArgs | AddProactiveArgs | BufferArgs | ClearBufferArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_DIR = path.join(os.homedir(), '.openclaw', 'workspace')
const SCHEDULES_PATH = path.join(WORKSPACE_DIR, 'schedules.json')
const BUFFER_PATH = path.join(WORKSPACE_DIR, 'working-buffer.json')

const MAX_SCHEDULED_TASKS = 50
const MAX_BUFFER_ENTRIES = 50
const MAX_HIGH_PRIORITY = 3
const MAX_DAILY_PROACTIVE = 10
const MAX_ACTION_LENGTH = 2_000
const MAX_NAME_LENGTH = 200

// Cron: 5 fields (min hour dom month dow)
const CRON_REGEX = /^(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)$/

const VALID_PRIORITIES = ['high', 'normal', 'low'] as const
type Priority = (typeof VALID_PRIORITIES)[number]

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function loadSchedules(): Promise<SchedulerStore> {
  try {
    const raw = await fs.readFile(SCHEDULES_PATH, 'utf-8')
    const data = JSON.parse(raw) as { tasks?: unknown[] }
    if (!Array.isArray(data.tasks)) {
      return { tasks: [] }
    }
    return data as SchedulerStore
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { tasks: [] }
    }
    throw err
  }
}

async function saveSchedules(store: SchedulerStore): Promise<void> {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true })
  const tmpPath = SCHEDULES_PATH + '.tmp.' + String(Date.now())
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf-8')
  await fs.rename(tmpPath, SCHEDULES_PATH)
}

async function loadBuffer(): Promise<WorkingBuffer> {
  try {
    const raw = await fs.readFile(BUFFER_PATH, 'utf-8')
    const data = JSON.parse(raw) as { pendingActions?: unknown[] }
    if (!Array.isArray(data.pendingActions)) {
      return { pendingActions: [] }
    }
    return data as WorkingBuffer
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { pendingActions: [] }
    }
    throw err
  }
}

async function saveBuffer(buffer: WorkingBuffer): Promise<void> {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true })
  const tmpPath = BUFFER_PATH + '.tmp.' + String(Date.now())
  await fs.writeFile(tmpPath, JSON.stringify(buffer, null, 2), 'utf-8')
  await fs.rename(tmpPath, BUFFER_PATH)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

function generateId(): string {
  return crypto.randomUUID()
}

function countTodaysProactive(actions: readonly ProactiveAction[]): number {
  const today = new Date().toISOString().slice(0, 10)
  return actions.filter((a) => a.createdAt.slice(0, 10) === today).length
}

function countHighPriority(actions: readonly ProactiveAction[]): number {
  return actions.filter((a) => a.priority === 'high').length
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): SchedulerArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'schedule') {
    const name = obj['name']
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('schedule requires a non-empty "name" string')
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Name too long (max ${String(MAX_NAME_LENGTH)} characters)`)
    }
    const cron = obj['cron']
    if (typeof cron !== 'string' || cron.trim() === '') {
      throw new Error('schedule requires a non-empty "cron" string')
    }
    if (!CRON_REGEX.test(cron.trim())) {
      throw new Error('Invalid cron expression — must be 5 fields: min hour dom month dow')
    }
    const taskAction = obj['taskAction']
    if (typeof taskAction !== 'string' || taskAction.trim() === '') {
      throw new Error('schedule requires a non-empty "taskAction" string')
    }
    if (taskAction.length > MAX_ACTION_LENGTH) {
      throw new Error(`Action too long (max ${String(MAX_ACTION_LENGTH)} characters)`)
    }
    return {
      action: 'schedule',
      name: name.trim(),
      cron: cron.trim(),
      taskAction: taskAction.trim(),
    }
  }

  if (action === 'list') {
    return { action: 'list' }
  }

  if (action === 'cancel') {
    const id = obj['id']
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('cancel requires a non-empty "id" string')
    }
    return { action: 'cancel', id: id.trim() }
  }

  if (action === 'addProactive') {
    const proactiveAction = obj['proactiveAction']
    if (typeof proactiveAction !== 'string' || proactiveAction.trim() === '') {
      throw new Error('addProactive requires a non-empty "proactiveAction" string')
    }
    if (proactiveAction.length > MAX_ACTION_LENGTH) {
      throw new Error(`Action too long (max ${String(MAX_ACTION_LENGTH)} characters)`)
    }
    const priority = obj['priority']
    if (typeof priority !== 'string' || !(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      throw new Error('addProactive requires priority: "high", "normal", or "low"')
    }
    const triggerAt = obj['triggerAt']
    if (typeof triggerAt !== 'string' || triggerAt.trim() === '') {
      throw new Error('addProactive requires a non-empty "triggerAt" ISO timestamp')
    }
    const source = obj['source']
    if (typeof source !== 'string' || source.trim() === '') {
      throw new Error('addProactive requires a non-empty "source" string')
    }
    return {
      action: 'addProactive',
      proactiveAction: proactiveAction.trim(),
      priority: priority as Priority,
      triggerAt: triggerAt.trim(),
      source: source.trim(),
    }
  }

  if (action === 'buffer') {
    return { action: 'buffer' }
  }

  if (action === 'clearBuffer') {
    return { action: 'clearBuffer' }
  }

  throw new Error('action must be "schedule", "list", "cancel", "addProactive", "buffer", or "clearBuffer"')
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform',
      enum: ['schedule', 'list', 'cancel', 'addProactive', 'buffer', 'clearBuffer'],
    },
    name: {
      type: 'string',
      description: 'Task name (schedule)',
    },
    cron: {
      type: 'string',
      description: 'Cron expression: min hour dom month dow (schedule)',
    },
    taskAction: {
      type: 'string',
      description: 'Prompt/action to execute (schedule)',
    },
    id: {
      type: 'string',
      description: 'Task ID (cancel)',
    },
    proactiveAction: {
      type: 'string',
      description: 'Action description (addProactive)',
    },
    priority: {
      type: 'string',
      description: 'Priority: high, normal, or low (addProactive)',
      enum: ['high', 'normal', 'low'],
    },
    triggerAt: {
      type: 'string',
      description: 'ISO timestamp when to trigger (addProactive)',
    },
    source: {
      type: 'string',
      description: 'Source of the proactive action (addProactive)',
    },
  },
  required: ['action'],
}

export const schedulerTool: ExtendedAgentTool = {
  name: 'scheduler',
  description:
    'Schedule tasks and manage a proactive working buffer. Actions: schedule(name, cron, taskAction) creates a scheduled task; list() shows all tasks; cancel(id) removes a task; addProactive(proactiveAction, priority, triggerAt, source) adds to buffer; buffer() shows pending; clearBuffer() empties buffer.',
  parameters,
  permissions: ['fs:read', 'fs:write'],
  requiresConfirmation: false,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'schedule': {
        const store = await loadSchedules()
        if (store.tasks.length >= MAX_SCHEDULED_TASKS) {
          throw new Error(`Max scheduled tasks reached (${String(MAX_SCHEDULED_TASKS)})`)
        }

        const task: ScheduledTask = {
          id: generateId(),
          name: parsed.name,
          cron: parsed.cron,
          action: parsed.taskAction,
          enabled: true,
          createdAt: new Date().toISOString(),
        }

        await saveSchedules({ tasks: [...store.tasks, task] })
        return textResult(JSON.stringify({ scheduled: true, id: task.id, name: task.name, cron: task.cron }))
      }

      case 'list': {
        const store = await loadSchedules()
        return textResult(JSON.stringify({ tasks: store.tasks, count: store.tasks.length }))
      }

      case 'cancel': {
        const store = await loadSchedules()
        const idx = store.tasks.findIndex((t) => t.id === parsed.id)
        if (idx === -1) {
          throw new Error(`Task not found: ${parsed.id}`)
        }
        const mutableTasks = [...store.tasks]
        mutableTasks.splice(idx, 1)
        await saveSchedules({ tasks: mutableTasks })
        return textResult(JSON.stringify({ cancelled: true, id: parsed.id }))
      }

      case 'addProactive': {
        const buffer = await loadBuffer()

        if (buffer.pendingActions.length >= MAX_BUFFER_ENTRIES) {
          throw new Error(`Working buffer full (max ${String(MAX_BUFFER_ENTRIES)} entries)`)
        }

        const todayCount = countTodaysProactive(buffer.pendingActions)
        if (todayCount >= MAX_DAILY_PROACTIVE) {
          throw new Error(`Daily proactive limit reached (max ${String(MAX_DAILY_PROACTIVE)} per day)`)
        }

        if (parsed.priority === 'high') {
          const highCount = countHighPriority(buffer.pendingActions)
          if (highCount >= MAX_HIGH_PRIORITY) {
            throw new Error(`Max high-priority actions reached (${String(MAX_HIGH_PRIORITY)})`)
          }
        }

        const proactive: ProactiveAction = {
          id: generateId(),
          priority: parsed.priority,
          action: parsed.proactiveAction,
          triggerAt: parsed.triggerAt,
          source: parsed.source,
          createdAt: new Date().toISOString(),
        }

        await saveBuffer({ pendingActions: [...buffer.pendingActions, proactive] })
        return textResult(JSON.stringify({
          added: true,
          id: proactive.id,
          priority: proactive.priority,
          dailyCount: todayCount + 1,
        }))
      }

      case 'buffer': {
        const buffer = await loadBuffer()
        return textResult(JSON.stringify({
          pendingActions: buffer.pendingActions,
          count: buffer.pendingActions.length,
        }))
      }

      case 'clearBuffer': {
        await saveBuffer({ pendingActions: [] })
        return textResult(JSON.stringify({ cleared: true }))
      }
    }
  },
}

export { parseArgs, loadSchedules, saveSchedules, loadBuffer, saveBuffer, countTodaysProactive, countHighPriority }
