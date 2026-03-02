import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch, assertNoInnerHTML } from './helpers'
import type { DbPool } from '../src/types'
import type { AgentDefinition } from '../src/agent-registry'
import type {
  LlmClient,
  LlmResponse,
  LlmContentBlock,
  AgentTask,
} from '../src/agent-executor'
import {
  executeAgent,
  getToolRiskTier,
  getApprovalThreshold,
} from '../src/agent-executor'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/agent-executor.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — agent-registry
// ---------------------------------------------------------------------------

const mockGetAgent = vi.fn()
const mockTouchAgent = vi.fn()

vi.mock('../src/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  touchAgent: (...args: unknown[]) => mockTouchAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-memory
// ---------------------------------------------------------------------------

const mockFormatForSystemPrompt = vi.fn()

vi.mock('../src/agent-memory', () => ({
  formatForSystemPrompt: (...args: unknown[]) => mockFormatForSystemPrompt(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — model-resolver
// ---------------------------------------------------------------------------

const mockResolveModelForAgent = vi.fn()

vi.mock('../src/model-resolver', () => ({
  resolveModelForAgent: (...args: unknown[]) => mockResolveModelForAgent(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — index (getTool)
// ---------------------------------------------------------------------------

const mockGetTool = vi.fn()

vi.mock('../src/index', () => ({
  getTool: (...args: unknown[]) => mockGetTool(...args),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_ID = 'test-agent-abc123'
const USER_ID = 'user-123'

const mockPool: DbPool = { query: vi.fn() }

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: AGENT_ID,
    userId: USER_ID,
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'Du bist ein hilfreicher Assistent.',
    tools: ['web-search'],
    model: 'haiku',
    riskProfile: 'write-with-approval',
    maxSteps: 10,
    maxTokens: 4096,
    timeoutMs: 30_000,
    memoryNamespace: 'test',
    cronSchedule: null,
    cronTask: null,
    retention: 'persistent',
    status: 'active',
    trustLevel: 'senior',
    trustMetrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    userId: USER_ID,
    agentId: AGENT_ID,
    task: 'Finde Informationen über TypeScript.',
    timeout: 10_000,
    ...overrides,
  }
}

function endTurnResponse(text: string): LlmResponse {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

function toolUseResponse(calls: Array<{ id: string; name: string; input: Record<string, unknown> }>, text?: string): LlmResponse {
  const content: LlmContentBlock[] = []
  if (text) {
    content.push({ type: 'text', text })
  }
  for (const call of calls) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
  }
  return {
    stop_reason: 'tool_use',
    content,
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

function createMockLlmClient(responses: LlmResponse[]): LlmClient {
  let callIndex = 0
  return {
    chat: vi.fn(async () => {
      const idx = callIndex++
      const resp = responses[idx]
      if (!resp) {
        throw new Error(`Unexpected LLM call #${String(idx + 1)}`)
      }
      return resp
    }),
  }
}

function createMockTool(name: string, result = 'ok') {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object' as const, properties: {}, required: [] as string[] },
    permissions: [] as string[],
    requiresConfirmation: false,
    runsOn: 'server' as const,
    execute: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: result }],
    })),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Defaults
  mockGetAgent.mockResolvedValue(makeAgentDef())
  mockTouchAgent.mockResolvedValue(undefined)
  mockFormatForSystemPrompt.mockResolvedValue('')
  mockResolveModelForAgent.mockReturnValue({
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    fallbackModel: 'anthropic/claude-haiku-4-5',
  })

  const webSearchTool = createMockTool('web-search', 'Search results here')
  mockGetTool.mockImplementation((name: string) => {
    if (name === 'web-search') return webSearchTool
    return undefined
  })
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
// getToolRiskTier
// ---------------------------------------------------------------------------

describe('getToolRiskTier', () => {
  it('classifies read actions as tier 1', () => {
    expect(getToolRiskTier('gmail', { action: 'readInbox' })).toBe(1)
    expect(getToolRiskTier('filesystem', { action: 'list' })).toBe(1)
    expect(getToolRiskTier('youtube', { action: 'search' })).toBe(1)
  })

  it('classifies write actions as tier 2', () => {
    expect(getToolRiskTier('filesystem', { action: 'writeFile' })).toBe(2)
    expect(getToolRiskTier('notes', { action: 'createNote' })).toBe(2)
  })

  it('classifies send actions as tier 3', () => {
    expect(getToolRiskTier('gmail', { action: 'sendEmail' })).toBe(3)
    expect(getToolRiskTier('whatsapp', { action: 'sendMessage' })).toBe(3)
  })

  it('classifies delete actions as tier 4', () => {
    expect(getToolRiskTier('filesystem', { action: 'deleteFile' })).toBe(4)
    expect(getToolRiskTier('calendar', { action: 'deleteEvent' })).toBe(4)
  })

  it('falls back to tool name when no action param', () => {
    expect(getToolRiskTier('readFile', {})).toBe(1)
    expect(getToolRiskTier('sendEmail', {})).toBe(3)
    expect(getToolRiskTier('deleteItem', {})).toBe(4)
  })

  it('defaults to tier 2 for unknown patterns', () => {
    expect(getToolRiskTier('calculator', { action: 'compute' })).toBe(2)
    expect(getToolRiskTier('unknown', {})).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// getApprovalThreshold
// ---------------------------------------------------------------------------

describe('getApprovalThreshold', () => {
  it('returns tier 2 for intern', () => {
    expect(getApprovalThreshold('intern')).toBe(2)
  })

  it('returns tier 3 for junior', () => {
    expect(getApprovalThreshold('junior')).toBe(3)
  })

  it('returns tier 4 for senior', () => {
    expect(getApprovalThreshold('senior')).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// executeAgent
// ---------------------------------------------------------------------------

describe('executeAgent', () => {
  it('returns failure when agent is not found', async () => {
    mockGetAgent.mockResolvedValue(null)

    const result = await executeAgent(makeTask(), mockPool, createMockLlmClient([]))

    expect(result.status).toBe('failure')
    expect(result.reason).toBe('agent-not-found')
  })

  // Test 8: Successful run — LLM answers directly
  it('returns success when LLM answers with end_turn', async () => {
    const llm = createMockLlmClient([endTurnResponse('Die Antwort ist 42.')])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('success')
    expect(result.output).toBe('Die Antwort ist 42.')
    expect(result.toolCalls).toBe(0)
    expect(result.pendingActions).toEqual([])
    expect(result.usage.inputTokens).toBe(100)
    expect(result.usage.outputTokens).toBe(50)
    expect(mockTouchAgent).toHaveBeenCalledWith(mockPool, USER_ID, AGENT_ID)
  })

  // Test 4: Memory in system prompt
  it('includes memory text in system prompt', async () => {
    mockFormatForSystemPrompt.mockResolvedValue('User mag TypeScript.')
    const llm = createMockLlmClient([endTurnResponse('ok')])

    await executeAgent(makeTask(), mockPool, llm)

    expect(llm.chat).toHaveBeenCalledTimes(1)
    const chatCall = vi.mocked(llm.chat).mock.calls[0]![0]
    expect(chatCall.system).toContain('## Erinnerungen')
    expect(chatCall.system).toContain('User mag TypeScript.')
    expect(chatCall.system).toContain('## Budget')
  })

  // Test 1: Budget limit — maxSteps=2, LLM gives 3 tool_uses across calls
  it('returns partial when budget is exhausted', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ maxSteps: 2 }))

    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'web-search', input: { query: 'a' } }]),
      toolUseResponse([{ id: 'tc2', name: 'web-search', input: { query: 'b' } }]),
      toolUseResponse([{ id: 'tc3', name: 'web-search', input: { query: 'c' } }]),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('partial')
    expect(result.reason).toBe('Budget erschöpft')
    // 2 calls completed, 3rd was over budget
    expect(result.toolCalls).toBe(2)
  })

  // Test 2: Timeout
  it('returns partial on timeout', async () => {
    const slowLlm: LlmClient = {
      chat: vi.fn(async () => {
        await new Promise(r => setTimeout(r, 500))
        return endTurnResponse('too late')
      }),
    }

    const result = await executeAgent(makeTask({ timeout: 50 }), mockPool, slowLlm)

    expect(result.status).toBe('partial')
    expect(result.reason).toBe('Timeout')
  })

  // Test 3: Risk tier stops loop — tool with tier 3, intern agent (threshold 2)
  it('returns needs-approval when risk tier exceeds threshold', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ trustLevel: 'intern', tools: ['gmail'] }))

    const gmailTool = createMockTool('gmail', 'Email sent')
    mockGetTool.mockImplementation((name: string) => {
      if (name === 'gmail') return gmailTool
      return undefined
    })

    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'gmail', input: { action: 'sendEmail', to: 'x@y.com' } }]),
    ])

    // gmail with sendEmail → tier 3, intern threshold → 2, so 3 >= 2 → needs-approval
    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('needs-approval')
    expect(result.pendingActions).toHaveLength(1)
    expect(result.pendingActions[0]!.toolName).toBe('gmail')
    expect(result.pendingActions[0]!.riskTier).toBe(3)
    expect(result.pendingActions[0]!.id).toBeTruthy()
    // Must be valid UUID format
    expect(result.pendingActions[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  // Test 5: Loop detection — LLM gives exact same tool_use twice
  it('returns partial on loop detection', async () => {
    const duplicateCall = { id: 'tc1', name: 'web-search', input: { query: 'same' } }

    const llm = createMockLlmClient([
      toolUseResponse([{ ...duplicateCall, id: 'tc1' }]),
      // Second call: same tool + same input → loop
      toolUseResponse([{ ...duplicateCall, id: 'tc2' }]),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('partial')
    expect(result.reason).toBe('Loop erkannt')
  })

  // Test 6: Gemini fallback — first chat() with google throws, second with anthropic succeeds
  it('falls back to anthropic when google provider fails', async () => {
    let callCount = 0
    const llm: LlmClient = {
      chat: vi.fn(async (params) => {
        callCount++
        // First 2 calls (initial + retry) fail with google
        if (callCount <= 2 && params.provider === 'google') {
          throw new Error('Gemini API unavailable')
        }
        // Third call should be with anthropic fallback
        return endTurnResponse('Fallback erfolgreich')
      }),
    }

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('success')
    expect(result.output).toBe('Fallback erfolgreich')

    // Verify fallback was used
    const calls = vi.mocked(llm.chat).mock.calls
    const lastCall = calls[calls.length - 1]![0]
    expect(lastCall.provider).toBe('anthropic')
    expect(lastCall.model).toBe('claude-haiku-4-5')
  })

  // Test 7: Tool error — tool throws, error passed to LLM, loop continues
  it('passes tool errors to LLM and continues', async () => {
    const failingTool = createMockTool('web-search')
    failingTool.execute.mockRejectedValueOnce(new Error('Network timeout'))
    failingTool.execute.mockResolvedValueOnce({
      content: [{ type: 'text' as const, text: 'Success on retry' }],
    })
    mockGetTool.mockImplementation((name: string) => {
      if (name === 'web-search') return failingTool
      return undefined
    })

    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'web-search', input: { query: 'fail' } }]),
      toolUseResponse([{ id: 'tc2', name: 'web-search', input: { query: 'retry' } }]),
      endTurnResponse('Ergebnis nach Fehler'),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('success')
    expect(result.output).toBe('Ergebnis nach Fehler')
    expect(result.toolCalls).toBe(2)

    // The error from tc1 was passed as tool_result in the 2nd LLM call's messages
    const secondChatCall = vi.mocked(llm.chat).mock.calls[1]![0]
    // Messages: [user original, assistant tc1, user [tool_result error]]
    const errorMsg = secondChatCall.messages[2]
    expect(errorMsg?.role).toBe('user')
    const blocks = errorMsg?.content
    expect(Array.isArray(blocks)).toBe(true)
    if (Array.isArray(blocks)) {
      const resultBlock = blocks[0] as { type: string; content: string }
      expect(resultBlock.type).toBe('tool_result')
      expect(resultBlock.content).toContain('Error: Network timeout')
    }
  })

  it('skips memory section when memory is empty', async () => {
    mockFormatForSystemPrompt.mockResolvedValue('')
    const llm = createMockLlmClient([endTurnResponse('ok')])

    await executeAgent(makeTask(), mockPool, llm)

    const chatCall = vi.mocked(llm.chat).mock.calls[0]![0]
    expect(chatCall.system).not.toContain('## Erinnerungen')
    expect(chatCall.system).toContain('## Budget')
  })

  it('includes context in user message when provided', async () => {
    const llm = createMockLlmClient([endTurnResponse('ok')])

    await executeAgent(
      makeTask({ context: 'Zusätzlicher Kontext hier.' }),
      mockPool,
      llm,
    )

    const chatCall = vi.mocked(llm.chat).mock.calls[0]![0]
    const firstMsg = chatCall.messages[0]
    expect(firstMsg?.content).toContain('Zusätzlicher Kontext hier.')
  })

  it('filters out unknown tools from agent definition', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({ tools: ['web-search', 'nonexistent-tool'] }))
    const llm = createMockLlmClient([endTurnResponse('ok')])

    await executeAgent(makeTask(), mockPool, llm)

    const chatCall = vi.mocked(llm.chat).mock.calls[0]![0]
    expect(chatCall.tools).toHaveLength(1)
    expect(chatCall.tools[0]!.name).toBe('web-search')
  })

  it('handles unknown tool in tool_use gracefully', async () => {
    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'nonexistent', input: {} }]),
      endTurnResponse('ok'),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('success')
    // Error message was passed as tool_result
    const secondCall = vi.mocked(llm.chat).mock.calls[1]![0]
    const userMsg = secondCall.messages[secondCall.messages.length - 1]
    expect(Array.isArray(userMsg?.content)).toBe(true)
  })

  it('accumulates token usage across multiple LLM calls', async () => {
    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'web-search', input: { query: 'first' } }]),
      toolUseResponse([{ id: 'tc2', name: 'web-search', input: { query: 'second' } }]),
      endTurnResponse('done'),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.usage.inputTokens).toBe(300)  // 3 calls × 100
    expect(result.usage.outputTokens).toBe(150)  // 3 calls × 50
  })

  it('senior agent can auto-execute send actions (tier 3)', async () => {
    mockGetAgent.mockResolvedValue(makeAgentDef({
      trustLevel: 'senior',
      tools: ['gmail'],
    }))

    const gmailTool = createMockTool('gmail', 'Email sent')
    mockGetTool.mockImplementation((name: string) => {
      if (name === 'gmail') return gmailTool
      return undefined
    })

    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'gmail', input: { action: 'sendEmail', to: 'x@y.com' } }]),
      endTurnResponse('Email gesendet'),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    // Senior threshold is 4, sendEmail is tier 3 → auto-execute
    expect(result.status).toBe('success')
    expect(gmailTool.execute).toHaveBeenCalled()
  })

  // Security: allowlist enforcement — LLM cannot call tools outside agent definition
  it('blocks tool calls not in the agent allowlist', async () => {
    // Agent only has web-search, but LLM tries to call filesystem
    mockGetAgent.mockResolvedValue(makeAgentDef({ tools: ['web-search'] }))

    const fsTool = createMockTool('filesystem', 'file content')
    mockGetTool.mockImplementation((name: string) => {
      if (name === 'web-search') return createMockTool('web-search')
      if (name === 'filesystem') return fsTool
      return undefined
    })

    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'filesystem', input: { action: 'readFile', path: '/etc/passwd' } }]),
      endTurnResponse('ok'),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    expect(result.status).toBe('success')
    // filesystem tool must NOT have been executed
    expect(fsTool.execute).not.toHaveBeenCalled()
    // Error should have been passed back to LLM
    const secondCall = vi.mocked(llm.chat).mock.calls[1]![0]
    const userMsg = secondCall.messages[secondCall.messages.length - 1]
    expect(Array.isArray(userMsg?.content)).toBe(true)
    if (Array.isArray(userMsg?.content)) {
      const resultBlock = userMsg.content[0] as { type: string; content: string }
      expect(resultBlock.content).toContain('nicht erlaubt')
    }
  })

  // Security: tool-defined riskTiers are respected over heuristics
  it('uses tool-defined riskTiers when available', async () => {
    // Tool defines riskTiers for its actions
    const customTool = createMockTool('custom-tool', 'result')
    Object.assign(customTool, {
      riskTiers: { processData: 4 },  // processData looks harmless by heuristic but is tier 4
      defaultRiskTier: 1,
    })
    mockGetAgent.mockResolvedValue(makeAgentDef({ trustLevel: 'junior', tools: ['custom-tool'] }))
    mockGetTool.mockImplementation((name: string) => {
      if (name === 'custom-tool') return customTool
      return undefined
    })

    const llm = createMockLlmClient([
      toolUseResponse([{ id: 'tc1', name: 'custom-tool', input: { action: 'processData' } }]),
    ])

    const result = await executeAgent(makeTask(), mockPool, llm)

    // junior threshold is 3, tool says processData is tier 4 → needs-approval
    expect(result.status).toBe('needs-approval')
    expect(result.pendingActions[0]!.riskTier).toBe(4)
    // Tool must NOT have been executed
    expect(customTool.execute).not.toHaveBeenCalled()
  })
})
