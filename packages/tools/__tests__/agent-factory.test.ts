import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch, assertNoInnerHTML } from './helpers'
import type { DbPool, ExtendedAgentTool, RiskTier } from '../src/types'
import type { AgentDefinition } from '../src/agent-registry'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/agent-factory.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — agent-registry
// ---------------------------------------------------------------------------

const mockCreateAgent = vi.fn()
const mockGetActiveAgents = vi.fn()

vi.mock('../src/agent-registry', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
  getActiveAgents: (...args: unknown[]) => mockGetActiveAgents(...args),
  VALID_RETENTIONS: ['persistent', 'seasonal', 'ephemeral'],
}))

// ---------------------------------------------------------------------------
// Mocks — index (getTool)
// ---------------------------------------------------------------------------

const mockGetTool = vi.fn()

vi.mock('../src/index', () => ({
  getTool: (...args: unknown[]) => mockGetTool(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-executor (getToolRiskTier)
// ---------------------------------------------------------------------------

const mockGetToolRiskTier = vi.fn()

vi.mock('../src/agent-executor', () => ({
  getToolRiskTier: (...args: unknown[]) => mockGetToolRiskTier(...args),
}))

// ---------------------------------------------------------------------------
// Mocks — agent-cron
// ---------------------------------------------------------------------------

const mockRegisterAgentCronJob = vi.fn()

vi.mock('../src/agent-cron', () => ({
  registerAgentCronJob: (...args: unknown[]) => mockRegisterAgentCronJob(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  createAgentFactoryTool,
  parseArgs,
  isValidCron,
  isCronTooFrequent,
} from '../src/agent-factory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-42'
const mockPool: DbPool = { query: vi.fn() }

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'test-agent-abc123',
    userId: USER_ID,
    name: 'Test Agent',
    description: 'A test agent',
    systemPrompt: 'Du bist Test Agent.',
    tools: ['web-search'],
    model: 'haiku',
    riskProfile: 'read-only',
    maxSteps: 5,
    maxTokens: 4096,
    timeoutMs: 30_000,
    memoryNamespace: 'agent-test-agent-abc123',
    cronSchedule: null,
    cronTask: null,
    retention: 'persistent',
    status: 'active',
    trustLevel: 'intern',
    trustMetrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeMockToolDef(name: string, defaultRiskTier: RiskTier = 1): ExtendedAgentTool {
  return {
    name,
    description: 'Mock tool ' + name,
    parameters: { type: 'object' as const, properties: {} },
    permissions: [] as string[],
    requiresConfirmation: false,
    runsOn: 'server' as const,
    defaultRiskTier,
    execute: vi.fn(),
  }
}

function parseResultContent(
  result: { content: readonly { type: string; text?: string }[] },
): Record<string, unknown> {
  const text = result.content[0]
  if (!text || text.type !== 'text' || !('text' in text)) {
    throw new Error('Expected text content in result')
  }
  return JSON.parse(text.text as string) as Record<string, unknown>
}

const VALID_ARGS = {
  name: 'Research Bot',
  purpose: 'Search the web for information and summarize results.',
  tools: ['web-search'],
  model: 'haiku',
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetActiveAgents.mockResolvedValue([])
  mockGetTool.mockImplementation((name: string) => makeMockToolDef(name))
  mockGetToolRiskTier.mockReturnValue(1 as RiskTier)
  mockCreateAgent.mockImplementation(
    (_pool: unknown, _userId: unknown, input: Record<string, unknown>) =>
      Promise.resolve(
        makeAgentDef({
          name: input['name'] as string,
          description: input['description'] as string,
          tools: input['tools'] as string[],
          model: input['model'] as string,
          riskProfile: input['riskProfile'] as 'read-only',
          maxSteps: input['maxSteps'] as number,
          cronSchedule: (input['cronSchedule'] as string | null) ?? null,
        }),
      ),
  )
})

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe('Security', () => {
  it('contains no code-execution patterns', () => {
    assertNoEval(sourceCode)
  })

  it('contains no HTML injection patterns', () => {
    assertNoInnerHTML(sourceCode)
  })

  it('contains no unauthorized fetch calls', () => {
    assertNoUnauthorizedFetch(sourceCode, [])
  })
})

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('Metadata', () => {
  it('has name "create-agent"', () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    expect(tool.name).toBe('create-agent')
  })

  it('runs on server', () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    expect(tool.runsOn).toBe('server')
  })

  it('requiresConfirmation is true', () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    expect(tool.requiresConfirmation).toBe(true)
  })

  it('has defaultRiskTier 2', () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    expect(tool.defaultRiskTier).toBe(2)
  })

  it('has correct parameters schema', () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    expect(tool.parameters.type).toBe('object')
    expect(tool.parameters.required).toEqual(['name', 'purpose', 'tools', 'model'])
    expect(tool.parameters.properties).toHaveProperty('name')
    expect(tool.parameters.properties).toHaveProperty('purpose')
    expect(tool.parameters.properties).toHaveProperty('tools')
    expect(tool.parameters.properties).toHaveProperty('schedule')
    expect(tool.parameters.properties).toHaveProperty('model')
    expect(tool.parameters.properties).toHaveProperty('retention')
    expect(tool.parameters.properties).toHaveProperty('cronTask')
  })
})

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('rejects null args', () => {
    expect(() => parseArgs(null)).toThrow('Arguments must be a non-null object')
  })

  it('rejects empty name', () => {
    expect(() => parseArgs({ ...VALID_ARGS, name: '' })).toThrow('name must be a non-empty string')
    expect(() => parseArgs({ ...VALID_ARGS, name: '   ' })).toThrow('name must be a non-empty string')
  })

  it('rejects name exceeding 50 characters', () => {
    expect(() => parseArgs({ ...VALID_ARGS, name: 'x'.repeat(51) })).toThrow(
      'name must be at most 50 characters',
    )
  })

  it('rejects empty purpose', () => {
    expect(() => parseArgs({ ...VALID_ARGS, purpose: '' })).toThrow(
      'purpose must be a non-empty string',
    )
  })

  it('rejects empty tools array', () => {
    expect(() => parseArgs({ ...VALID_ARGS, tools: [] })).toThrow(
      'tools must be a non-empty array of strings',
    )
  })

  it('rejects tools with non-string entries', () => {
    expect(() => parseArgs({ ...VALID_ARGS, tools: [123] })).toThrow(
      'Each tool must be a non-empty string',
    )
  })

  it('rejects name with control characters', () => {
    expect(() => parseArgs({ ...VALID_ARGS, name: 'Bot\nEvil' })).toThrow(
      'name contains invalid characters',
    )
    expect(() => parseArgs({ ...VALID_ARGS, name: 'Bot\x00' })).toThrow(
      'name contains invalid characters',
    )
  })

  it('rejects name with HTML tags', () => {
    expect(() => parseArgs({ ...VALID_ARGS, name: '<script>alert(1)</script>' })).toThrow(
      'name contains invalid characters',
    )
  })

  it('accepts name with German umlauts', () => {
    const result = parseArgs({ ...VALID_ARGS, name: 'Büro-Assistent' })
    expect(result.name).toBe('Büro-Assistent')
  })

  it('deduplicates tool entries', () => {
    const result = parseArgs({ ...VALID_ARGS, tools: ['web-search', 'web-search', 'notes'] })
    expect(result.tools).toEqual(['web-search', 'notes'])
  })

  it('rejects too many tools', () => {
    const manyTools = Array.from({ length: 11 }, (_, i) => 'tool-' + String(i))
    expect(() => parseArgs({ ...VALID_ARGS, tools: manyTools })).toThrow(
      'tools must have at most 10 entries',
    )
  })

  it('rejects invalid model', () => {
    expect(() => parseArgs({ ...VALID_ARGS, model: 'opus' })).toThrow(
      'model must be one of: haiku, sonnet',
    )
    expect(() => parseArgs({ ...VALID_ARGS, model: 'gpt-4' })).toThrow(
      'model must be one of: haiku, sonnet',
    )
  })

  it('parses valid args with null schedule', () => {
    const result = parseArgs(VALID_ARGS)
    expect(result.name).toBe('Research Bot')
    expect(result.purpose).toBe(VALID_ARGS.purpose)
    expect(result.tools).toEqual(['web-search'])
    expect(result.schedule).toBeNull()
    expect(result.model).toBe('haiku')
  })

  it('parses valid args with cron schedule and cronTask', () => {
    const result = parseArgs({ ...VALID_ARGS, schedule: '0 9 * * 1-5', cronTask: 'Check emails' })
    expect(result.schedule).toBe('0 9 * * 1-5')
    expect(result.cronTask).toBe('Check emails')
  })

  it('rejects schedule without cronTask', () => {
    expect(() => parseArgs({ ...VALID_ARGS, schedule: '0 9 * * 1-5' })).toThrow(
      'cronTask is required when schedule is set',
    )
  })

  it('applies heuristic: schedule set → persistent', () => {
    const result = parseArgs({ ...VALID_ARGS, schedule: '0 9 * * 1-5', cronTask: 'Check emails' })
    expect(result.retention).toBe('persistent')
  })

  it('applies heuristic: no schedule → ephemeral', () => {
    const result = parseArgs(VALID_ARGS)
    expect(result.retention).toBe('ephemeral')
  })

  it('accepts explicit retention override', () => {
    const result = parseArgs({ ...VALID_ARGS, retention: 'seasonal' })
    expect(result.retention).toBe('seasonal')
  })

  it('rejects invalid retention value', () => {
    expect(() => parseArgs({ ...VALID_ARGS, retention: 'forever' })).toThrow(
      'retention must be one of',
    )
  })

  it('trims whitespace from all string fields', () => {
    const result = parseArgs({
      ...VALID_ARGS,
      name: '  Research Bot  ',
      purpose: '  Do stuff  ',
      tools: ['  web-search  '],
    })
    expect(result.name).toBe('Research Bot')
    expect(result.purpose).toBe('Do stuff')
    expect(result.tools).toEqual(['web-search'])
  })
})

// ---------------------------------------------------------------------------
// Cron Validation
// ---------------------------------------------------------------------------

describe('Cron Validation', () => {
  describe('isValidCron', () => {
    it('accepts standard 5-field cron expressions', () => {
      expect(isValidCron('0 9 * * 1-5')).toBe(true)
      expect(isValidCron('*/30 * * * *')).toBe(true)
      expect(isValidCron('0 0 1 * *')).toBe(true)
      expect(isValidCron('15 14 1 * *')).toBe(true)
    })

    it('rejects invalid cron expressions', () => {
      expect(isValidCron('')).toBe(false)
      expect(isValidCron('not a cron')).toBe(false)
      expect(isValidCron('* * *')).toBe(false)
      expect(isValidCron('* * * * * *')).toBe(false)
    })

    it('rejects semantically invalid cron values', () => {
      expect(isValidCron('99 * * * *')).toBe(false)   // minute 99
      expect(isValidCron('0 25 * * *')).toBe(false)   // hour 25
      expect(isValidCron('0 0 32 * *')).toBe(false)   // day 32
      expect(isValidCron('0 0 * 13 *')).toBe(false)   // month 13
      expect(isValidCron('0 0 * * 8')).toBe(false)    // dow 8
    })
  })

  describe('isCronTooFrequent', () => {
    it('rejects every-minute cron', () => {
      expect(isCronTooFrequent('* * * * *')).toBe(true)
    })

    it('rejects cron running every 5 minutes', () => {
      expect(isCronTooFrequent('*/5 * * * *')).toBe(true)
    })

    it('rejects cron running every 10 minutes', () => {
      expect(isCronTooFrequent('*/10 * * * *')).toBe(true)
    })

    it('accepts cron running every 15 minutes', () => {
      expect(isCronTooFrequent('*/15 * * * *')).toBe(false)
    })

    it('accepts cron running every 30 minutes', () => {
      expect(isCronTooFrequent('*/30 * * * *')).toBe(false)
    })

    it('accepts hourly cron', () => {
      expect(isCronTooFrequent('0 * * * *')).toBe(false)
    })

    it('accepts daily cron', () => {
      expect(isCronTooFrequent('0 9 * * *')).toBe(false)
    })

    it('rejects comma-separated minutes closer than 15', () => {
      expect(isCronTooFrequent('0,10 * * * *')).toBe(true)
    })

    it('accepts comma-separated minutes 15+ apart', () => {
      expect(isCronTooFrequent('0,15,30,45 * * * *')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Agent Creation
// ---------------------------------------------------------------------------

describe('Agent Creation', () => {
  it('creates agent successfully with all fields', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    const result = await tool.execute(VALID_ARGS)
    const data = parseResultContent(result)

    expect(data['status']).toBe('success')
    expect(data['agent']).toBeDefined()
    const agent = data['agent'] as Record<string, unknown>
    expect(agent['name']).toBe('Research Bot')
    expect(agent['model']).toBe('haiku')
    expect(agent['tools']).toEqual(['web-search'])
    expect(agent['trustLevel']).toBe('intern')
    expect(agent['maxSteps']).toBe(5)
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
  })

  it('creates agent with schedule and cronTask', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)
    await tool.execute({ ...VALID_ARGS, schedule: '0 9 * * 1-5', cronTask: 'Check emails' })

    const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
    expect(createInput['cronSchedule']).toBe('0 9 * * 1-5')
    expect(createInput['cronTask']).toBe('Check emails')
  })

  it('returns error for duplicate agent name', async () => {
    mockGetActiveAgents.mockResolvedValue([makeAgentDef({ name: 'Research Bot' })])
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute(VALID_ARGS)
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(String(data['error'])).toContain('already exists')
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  it('duplicate name check is case-insensitive', async () => {
    mockGetActiveAgents.mockResolvedValue([makeAgentDef({ name: 'research bot' })])
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute(VALID_ARGS)
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(String(data['error'])).toContain('already exists')
  })

  it('returns error for unknown tool', async () => {
    mockGetTool.mockImplementation((name: string) => {
      if (name === 'nonexistent-tool') return undefined
      return makeMockToolDef(name)
    })
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute({ ...VALID_ARGS, tools: ['nonexistent-tool'] })
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(String(data['error'])).toContain('Unknown tool')
    expect(String(data['error'])).toContain('nonexistent-tool')
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  it('returns error for invalid cron expression', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute({ ...VALID_ARGS, schedule: 'not a cron', cronTask: 'Check' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(String(data['error'])).toContain('Invalid cron')
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  it('returns error for cron more frequent than 15 minutes', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute({ ...VALID_ARGS, schedule: '*/5 * * * *', cronTask: 'Check' })
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(String(data['error'])).toContain('too frequent')
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  describe('Risk Profile Derivation', () => {
    it('derives read-only when all tools have tier <= 1', async () => {
      mockGetToolRiskTier.mockReturnValue(1 as RiskTier)
      const tool = createAgentFactoryTool(USER_ID, mockPool)

      await tool.execute(VALID_ARGS)

      const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
      expect(createInput['riskProfile']).toBe('read-only')
    })

    it('derives write-with-approval when any tool has tier >= 2', async () => {
      mockGetToolRiskTier.mockImplementation((name: string) => {
        if (name === 'filesystem') return 2 as RiskTier
        return 1 as RiskTier
      })
      const tool = createAgentFactoryTool(USER_ID, mockPool)

      const result = await tool.execute({ ...VALID_ARGS, tools: ['web-search', 'filesystem'] })
      const data = parseResultContent(result)

      expect(data['status']).toBe('success')
      const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
      expect(createInput['riskProfile']).toBe('write-with-approval')
    })

    it('calls getToolRiskTier with empty params and tool definition', async () => {
      const tool = createAgentFactoryTool(USER_ID, mockPool)

      await tool.execute(VALID_ARGS)

      expect(mockGetToolRiskTier).toHaveBeenCalledWith(
        'web-search',
        {},
        expect.objectContaining({ name: 'web-search' }),
      )
    })
  })

  describe('Model Configuration', () => {
    it('sets maxSteps to 5 for haiku', async () => {
      const tool = createAgentFactoryTool(USER_ID, mockPool)

      await tool.execute({ ...VALID_ARGS, model: 'haiku' })

      const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
      expect(createInput['maxSteps']).toBe(5)
    })

    it('sets maxSteps to 10 for sonnet', async () => {
      const tool = createAgentFactoryTool(USER_ID, mockPool)

      await tool.execute({ ...VALID_ARGS, model: 'sonnet' })

      const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
      expect(createInput['maxSteps']).toBe(10)
    })

    it('rejects opus model via parseArgs', async () => {
      const tool = createAgentFactoryTool(USER_ID, mockPool)

      const result = await tool.execute({ ...VALID_ARGS, model: 'opus' })
      const data = parseResultContent(result)

      expect(data['status']).toBe('error')
      expect(String(data['error'])).toContain('model must be one of')
    })
  })

  it('trustLevel is always intern via registry defaults', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    await tool.execute(VALID_ARGS)

    // CreateAgentInput does not have a trustLevel field — registry defaults to 'intern'
    const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
    expect(createInput).not.toHaveProperty('trustLevel')

    // The returned agent should reflect 'intern' from registry default
    const result = await tool.execute(VALID_ARGS)
    const data = parseResultContent(result)
    const agent = data['agent'] as Record<string, unknown>
    expect(agent['trustLevel']).toBe('intern')
  })

  it('sets timeoutMs to 30000', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    await tool.execute(VALID_ARGS)

    const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
    expect(createInput['timeoutMs']).toBe(30_000)
  })

  it('sets maxTokens to 4096', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    await tool.execute(VALID_ARGS)

    const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
    expect(createInput['maxTokens']).toBe(4096)
  })

  it('passes system prompt containing name, purpose, and tools', async () => {
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    await tool.execute(VALID_ARGS)

    const createInput = mockCreateAgent.mock.calls[0]![2] as Record<string, unknown>
    const prompt = createInput['systemPrompt'] as string
    expect(prompt).toContain('Research Bot')
    expect(prompt).toContain(VALID_ARGS.purpose)
    expect(prompt).toContain('web-search')
  })

  it('returns sanitized error when createAgent throws', async () => {
    mockCreateAgent.mockRejectedValue(new Error('connection refused'))
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute(VALID_ARGS)
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(data['error']).toBe('Agent creation failed due to an internal error.')
    expect(JSON.stringify(data)).not.toContain('connection refused')
  })

  it('returns sanitized error when getActiveAgents throws', async () => {
    mockGetActiveAgents.mockRejectedValue(new Error('DB timeout'))
    const tool = createAgentFactoryTool(USER_ID, mockPool)

    const result = await tool.execute(VALID_ARGS)
    const data = parseResultContent(result)

    expect(data['status']).toBe('error')
    expect(data['error']).toBe('Agent creation failed due to an internal error.')
    expect(JSON.stringify(data)).not.toContain('DB timeout')
  })

  it('scopes all registry calls to the correct userId', async () => {
    const otherUserId = 'user-99'
    const tool = createAgentFactoryTool(otherUserId, mockPool)

    await tool.execute(VALID_ARGS)

    expect(mockGetActiveAgents).toHaveBeenCalledWith(mockPool, otherUserId)
    expect(mockCreateAgent).toHaveBeenCalledWith(mockPool, otherUserId, expect.anything())
  })
})
