import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch, assertNoInnerHTML } from './helpers'
import type { DbPool } from '../src/types'
import type { AgentDefinition } from '../src/agent-registry'
import type { AgentResult, LlmClient } from '../src/agent-executor'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/delegate-tool.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — agent-registry
// ---------------------------------------------------------------------------

const mockGetAgent = vi.fn()

vi.mock('../src/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-executor
// ---------------------------------------------------------------------------

const mockExecuteAgent = vi.fn()

vi.mock('../src/agent-executor', () => ({
  executeAgent: (...args: unknown[]) => mockExecuteAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-lifecycle
// ---------------------------------------------------------------------------

const mockHandlePostExecution = vi.fn()
const mockReactivateAgent = vi.fn()

vi.mock('../src/agent-lifecycle', () => ({
  handlePostExecution: (...args: unknown[]) => mockHandlePostExecution(...args),
  reactivateAgent: (...args: unknown[]) => mockReactivateAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-cron
// ---------------------------------------------------------------------------

const mockUnregisterAgentCronJob = vi.fn()

vi.mock('../src/agent-cron', () => ({
  unregisterAgentCronJob: (...args: unknown[]) => mockUnregisterAgentCronJob(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createDelegateTool, parseArgs } from '../src/delegate-tool'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_ID = 'research-bot-abc123'
const USER_ID = 'user-42'

const mockPool: DbPool = { query: vi.fn() }

const mockLlmClient: LlmClient = {
  chat: vi.fn(async () => ({
    stop_reason: 'end_turn' as const,
    content: [{ type: 'text' as const, text: 'unused' }],
    usage: { input_tokens: 0, output_tokens: 0 },
  })),
}

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: AGENT_ID,
    userId: USER_ID,
    name: 'Research Bot',
    description: 'A research agent',
    systemPrompt: 'Du bist ein Recherche-Assistent.',
    tools: ['web-search'],
    model: 'haiku',
    riskProfile: 'read-only',
    maxSteps: 10,
    maxTokens: 4096,
    timeoutMs: 30_000,
    memoryNamespace: 'agent-research-bot-abc123',
    cronSchedule: null,
    cronTask: null,
    retention: 'persistent' as const,
    status: 'active',
    trustLevel: 'junior',
    trustMetrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSuccessResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    status: 'success',
    output: 'Die Recherche ergab 3 relevante Quellen.',
    toolCalls: 2,
    pendingActions: [],
    usage: { inputTokens: 500, outputTokens: 200 },
    ...overrides,
  }
}

function parseResultContent(result: { content: readonly { type: string; text?: string }[] }): Record<string, unknown> {
  const text = result.content[0]
  if (!text || text.type !== 'text' || !('text' in text)) {
    throw new Error('Expected text content in result')
  }
  return JSON.parse(text.text as string) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAgent.mockResolvedValue(makeAgentDef())
  mockExecuteAgent.mockResolvedValue(makeSuccessResult())
  mockHandlePostExecution.mockResolvedValue({ action: 'none' })
  mockReactivateAgent.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe('Security', () => {
  it('contains no code-execution patterns', () => {
    assertNoEval(sourceCode)
  })

  it('contains no inner' + 'HTML patterns', () => {
    assertNoInnerHTML(sourceCode)
  })

  it('contains no unauthorized fetch calls', () => {
    assertNoUnauthorizedFetch(sourceCode, [])
  })
})

// ---------------------------------------------------------------------------
// Metadata tests
// ---------------------------------------------------------------------------

describe('Metadata', () => {
  it('has name "delegate"', () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    expect(tool.name).toBe('delegate')
  })

  it('runs on server', () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    expect(tool.runsOn).toBe('server')
  })

  it('has empty permissions', () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    expect(tool.permissions).toEqual([])
  })

  it('has defaultRiskTier 2', () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    expect(tool.defaultRiskTier).toBe(2)
  })

  it('has correct parameters schema', () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.required).toEqual(['agentId', 'task'])
    expect(tool.parameters.properties).toHaveProperty('agentId')
    expect(tool.parameters.properties).toHaveProperty('task')
    expect(tool.parameters.properties).toHaveProperty('context')
  })
})

// ---------------------------------------------------------------------------
// parseArgs tests
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('rejects null args', () => {
    expect(() => parseArgs(null)).toThrow('Arguments must be a non-null object')
  })

  it('rejects missing agentId', () => {
    expect(() => parseArgs({ task: 'do something' })).toThrow('agentId must be a non-empty string')
  })

  it('rejects empty agentId', () => {
    expect(() => parseArgs({ agentId: '  ', task: 'do something' })).toThrow('agentId must be a non-empty string')
  })

  it('rejects agentId exceeding 100 characters', () => {
    const longId = 'a'.repeat(101)
    expect(() => parseArgs({ agentId: longId, task: 'do something' })).toThrow('agentId must be at most 100 characters')
  })

  it('rejects agentId with invalid characters', () => {
    expect(() => parseArgs({ agentId: 'bot/../etc/passwd', task: 'do something' })).toThrow('agentId must contain only lowercase letters, digits, and hyphens')
    expect(() => parseArgs({ agentId: 'BOT-123', task: 'do something' })).toThrow('agentId must contain only lowercase letters, digits, and hyphens')
    expect(() => parseArgs({ agentId: 'bot 123', task: 'do something' })).toThrow('agentId must contain only lowercase letters, digits, and hyphens')
    expect(() => parseArgs({ agentId: 'bot_123', task: 'do something' })).toThrow('agentId must contain only lowercase letters, digits, and hyphens')
    expect(() => parseArgs({ agentId: '-bot-123', task: 'do something' })).toThrow('agentId must contain only lowercase letters, digits, and hyphens')
  })

  it('accepts valid kebab-case agentId', () => {
    const result = parseArgs({ agentId: 'research-bot-abc123', task: 'do something' })
    expect(result.agentId).toBe('research-bot-abc123')
  })

  it('rejects missing task', () => {
    expect(() => parseArgs({ agentId: 'bot-123' })).toThrow('task must be a non-empty string')
  })

  it('rejects empty task', () => {
    expect(() => parseArgs({ agentId: 'bot-123', task: '' })).toThrow('task must be a non-empty string')
  })

  it('rejects task exceeding 10K characters', () => {
    const longTask = 'x'.repeat(10_001)
    expect(() => parseArgs({ agentId: 'bot-123', task: longTask })).toThrow('task must be at most 10000 characters')
  })

  it('rejects context exceeding 5K characters', () => {
    const longContext = 'y'.repeat(5_001)
    expect(() => parseArgs({ agentId: 'bot-123', task: 'do it', context: longContext })).toThrow('context must be at most 5000 characters')
  })

  it('parses valid args with and without context', () => {
    const withContext = parseArgs({ agentId: 'bot-123', task: 'search for X', context: 'extra info' })
    expect(withContext).toEqual({ agentId: 'bot-123', task: 'search for X', context: 'extra info' })

    const withoutContext = parseArgs({ agentId: 'bot-123', task: 'search for X' })
    expect(withoutContext).toEqual({ agentId: 'bot-123', task: 'search for X' })
  })
})

// ---------------------------------------------------------------------------
// Delegation tests
// ---------------------------------------------------------------------------

describe('Delegation', () => {
  it('returns success result with summary, toolCalls, and usage', async () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: AGENT_ID, task: 'Recherchiere TypeScript.' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('success')
    expect(data['agentId']).toBe(AGENT_ID)
    expect(data['summary']).toBe('Die Recherche ergab 3 relevante Quellen.')
    expect(data['toolCalls']).toBe(2)
    expect(data['usage']).toEqual({ inputTokens: 500, outputTokens: 200 })
  })

  it('returns failure when agent is not found', async () => {
    mockGetAgent.mockResolvedValue(null)
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: 'nonexistent-123', task: 'do something' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('failure')
    expect(data['reason']).toBe('agent-not-found')
    expect(data['agentId']).toBe('nonexistent-123')
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('returns failure when agent is dormant (non-seasonal)', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ status: 'dormant', retention: 'persistent' }))
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('failure')
    expect(data['reason']).toBe('agent-inactive')
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('auto-reactivates dormant seasonal agent', async () => {
    // First call returns dormant seasonal, second call (after reactivation) returns active
    mockGetAgent
      .mockResolvedValueOnce(makeAgentDef({ status: 'dormant', retention: 'seasonal' }))
      .mockResolvedValueOnce(makeAgentDef({ status: 'active', retention: 'seasonal' }))

    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('success')
    expect(mockReactivateAgent).toHaveBeenCalledWith(mockPool, USER_ID, AGENT_ID)
    expect(mockExecuteAgent).toHaveBeenCalledTimes(1)
  })

  it('returns failure when agent is archived', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ status: 'archived' }))
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('failure')
    expect(data['reason']).toBe('agent-inactive')
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('passes context to executeAgent', async () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    await tool.execute({ agentId: AGENT_ID, task: 'search', context: 'focus on React' })

    expect(mockExecuteAgent).toHaveBeenCalledTimes(1)
    const taskArg = mockExecuteAgent.mock.calls[0]![0]! as Record<string, unknown>
    expect(taskArg['context']).toBe('focus on React')
  })

  it('uses timeoutMs from agent definition', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ timeoutMs: 60_000 }))
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    await tool.execute({ agentId: AGENT_ID, task: 'long task' })

    const taskArg = mockExecuteAgent.mock.calls[0]![0]! as Record<string, unknown>
    expect(taskArg['timeout']).toBe(60_000)
  })

  it('maps needs-approval result with pendingActions', async () => {
    const pendingActions = [
      {
        id: 'action-1',
        toolName: 'gmail',
        params: { action: 'sendEmail', to: 'x@y.com' },
        riskTier: 3 as const,
        description: 'gmail({"action":"sendEmail","to":"x@y.com"})',
      },
    ]
    mockExecuteAgent.mockResolvedValue({
      status: 'needs-approval',
      output: 'Ich muss eine E-Mail senden.',
      toolCalls: 1,
      pendingActions,
      usage: { inputTokens: 200, outputTokens: 100 },
      reason: 'Tier 3 erfordert Genehmigung (Schwelle: 2)',
    })

    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    const result = await tool.execute({ agentId: AGENT_ID, task: 'send email' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('needs-approval')
    expect(data['agentId']).toBe(AGENT_ID)
    expect(data['summary']).toBe('Ich muss eine E-Mail senden.')
    expect(data['pendingActions']).toEqual(pendingActions)
    expect(data['reason']).toBe('Tier 3 erfordert Genehmigung (Schwelle: 2)')
  })

  it('maps partial result', async () => {
    mockExecuteAgent.mockResolvedValue({
      status: 'partial',
      output: 'Teilergebnis',
      toolCalls: 5,
      pendingActions: [],
      usage: { inputTokens: 300, outputTokens: 150 },
      reason: 'Budget erschöpft',
    })

    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    const result = await tool.execute({ agentId: AGENT_ID, task: 'big task' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('partial')
    expect(data['summary']).toBe('Teilergebnis')
    expect(data['reason']).toBe('Budget erschöpft')
    expect(data['toolCalls']).toBe(5)
    expect(data['usage']).toEqual({ inputTokens: 300, outputTokens: 150 })
  })

  it('maps failure result from executor', async () => {
    mockExecuteAgent.mockResolvedValue({
      status: 'failure',
      output: 'LLM-Fehler: rate limit exceeded',
      toolCalls: 0,
      pendingActions: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: 'llm-error',
    })

    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    const result = await tool.execute({ agentId: AGENT_ID, task: 'failing task' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('failure')
    expect(data['agentId']).toBe(AGENT_ID)
    expect(data['error']).toBe('LLM-Fehler: rate limit exceeded')
    expect(data['reason']).toBe('llm-error')
  })

  it('scopes agent lookup to the correct userId', async () => {
    const otherUserId = 'user-99'
    const tool = createDelegateTool(otherUserId, mockPool, mockLlmClient)

    await tool.execute({ agentId: AGENT_ID, task: 'do something' })

    // getAgent must be called with the factory userId, not some other user
    expect(mockGetAgent).toHaveBeenCalledWith(mockPool, otherUserId, AGENT_ID)
    // executeAgent task must also carry the correct userId
    const taskArg = mockExecuteAgent.mock.calls[0]![0]! as Record<string, unknown>
    expect(taskArg['userId']).toBe(otherUserId)
  })

  it('returns sanitized failure when getAgent throws', async () => {
    mockGetAgent.mockRejectedValue(new Error('connection refused'))
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('failure')
    expect(data['reason']).toBe('internal-error')
    // Must NOT leak internal error details
    expect(data['error']).toBe('Delegation failed due to an internal error.')
    expect(JSON.stringify(data)).not.toContain('connection refused')
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('returns sanitized failure when executeAgent throws', async () => {
    mockExecuteAgent.mockRejectedValue(new Error('LLM provider unreachable'))
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('failure')
    expect(data['reason']).toBe('internal-error')
    // Must NOT leak internal error details
    expect(data['error']).toBe('Delegation failed due to an internal error.')
    expect(JSON.stringify(data)).not.toContain('LLM provider unreachable')
  })

  it('does not expose agent status value in inactive error', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ status: 'dormant', retention: 'persistent' }))
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)

    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    // Error message must NOT contain internal status value
    expect(String(data['error'])).not.toContain('dormant')
  })

  it('calls handlePostExecution after success', async () => {
    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    await tool.execute({ agentId: AGENT_ID, task: 'do something' })

    expect(mockHandlePostExecution).toHaveBeenCalledWith(
      mockPool, USER_ID, AGENT_ID, 'Research Bot', 'persistent', 'success',
    )
  })

  it('does not call handlePostExecution after failure', async () => {
    mockExecuteAgent.mockResolvedValue({
      status: 'failure',
      output: 'Error occurred',
      toolCalls: 0,
      pendingActions: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: 'llm-error',
    })

    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    await tool.execute({ agentId: AGENT_ID, task: 'do something' })

    expect(mockHandlePostExecution).not.toHaveBeenCalled()
  })

  it('appends retentionNote to success output when post-execution has message', async () => {
    mockHandlePostExecution.mockResolvedValue({
      action: 'deleted',
      message: 'Einmal-Agent wurde entfernt.',
    })

    const tool = createDelegateTool(USER_ID, mockPool, mockLlmClient)
    const result = await tool.execute({ agentId: AGENT_ID, task: 'do something' })
    const data = parseResultContent(result)

    expect(data['retentionNote']).toBe('Einmal-Agent wurde entfernt.')
  })
})
