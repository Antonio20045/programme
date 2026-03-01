import { vi, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbPool } from '../src/types'
import {
  createAgent,
  getAgent,
  getUserAgents,
  getActiveAgents,
  updateAgent,
  updateStatus,
  touchAgent,
  deleteAgent,
  generateAgentId,
  toKebabCase,
  MAX_AGENTS_PER_USER,
} from '../src/agent-registry'
import type { CreateAgentInput } from '../src/agent-registry'
import { assertNoEval } from './helpers'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../src/agent-registry.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool: DbPool = { query: mockQuery }
const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeAgentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-agent-abc123',
    user_id: USER_A,
    name: 'Test Agent',
    description: 'A test agent',
    system_prompt: 'You are helpful',
    tools: ['web-search', 'notes'],
    model: 'haiku',
    risk_profile: 'read-only',
    max_steps: 5,
    max_tokens: 4096,
    timeout_ms: 30000,
    memory_namespace: 'agent-test-agent-abc123',
    cron_schedule: null,
    status: 'active',
    trust_level: 'intern',
    trust_metrics: { totalTasks: 0, successfulTasks: 0, userOverrides: 0, promotedAt: null },
    usage_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const DEFAULT_INPUT: CreateAgentInput = {
  name: 'Test Agent',
  description: 'A test agent',
  systemPrompt: 'You are helpful',
  tools: ['web-search', 'notes'],
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset()
})

// ---------------------------------------------------------------------------
// toKebabCase
// ---------------------------------------------------------------------------

describe('toKebabCase', () => {
  it('converts spaces to hyphens', () => {
    expect(toKebabCase('My Agent')).toBe('my-agent')
  })

  it('lowercases input', () => {
    expect(toKebabCase('MyAgent')).toBe('myagent')
  })

  it('strips special characters', () => {
    expect(toKebabCase('hello!@#world')).toBe('hello-world')
  })

  it('trims leading and trailing hyphens', () => {
    expect(toKebabCase('  --hello--  ')).toBe('hello')
  })

  it('collapses multiple non-alphanum chars to single hyphen', () => {
    expect(toKebabCase('a   b___c')).toBe('a-b-c')
  })
})

// ---------------------------------------------------------------------------
// generateAgentId
// ---------------------------------------------------------------------------

describe('generateAgentId', () => {
  it('contains kebab-cased name as prefix', () => {
    const id = generateAgentId('My Cool Agent')
    expect(id).toMatch(/^my-cool-agent-/)
  })

  it('ends with 6 hex characters', () => {
    const id = generateAgentId('Test')
    expect(id).toMatch(/-[0-9a-f]{6}$/)
  })

  it('produces unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateAgentId('Same Name')))
    expect(ids.size).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

describe('createAgent', () => {
  it('creates agent and returns full AgentDefinition', async () => {
    // First call: count check
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    // Second call: INSERT
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    const result = await createAgent(mockPool, USER_A, DEFAULT_INPUT)

    expect(result.name).toBe('Test Agent')
    expect(result.description).toBe('A test agent')
    expect(result.tools).toEqual(['web-search', 'notes'])
    expect(result.model).toBe('haiku')
    expect(result.riskProfile).toBe('read-only')
    expect(result.status).toBe('active')
    expect(result.trustLevel).toBe('intern')
  })

  it('passes userId as first parameter to count query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await createAgent(mockPool, USER_A, DEFAULT_INPUT)

    const countParams = mockQuery.mock.calls[0]![1] as unknown[]
    expect(countParams[0]).toBe(USER_A)
  })

  it('passes userId as second parameter to INSERT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await createAgent(mockPool, USER_A, DEFAULT_INPUT)

    const insertParams = mockQuery.mock.calls[1]![1] as unknown[]
    expect(insertParams[1]).toBe(USER_A)
  })

  it('sets memoryNamespace to agent-{id}', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await createAgent(mockPool, USER_A, DEFAULT_INPUT)

    const insertParams = mockQuery.mock.calls[1]![1] as unknown[]
    const id = insertParams[0] as string
    const memoryNamespace = insertParams[11] as string
    expect(memoryNamespace).toBe(`agent-${id}`)
  })

  it('generates an ID with kebab-case prefix', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await createAgent(mockPool, USER_A, DEFAULT_INPUT)

    const insertParams = mockQuery.mock.calls[1]![1] as unknown[]
    const id = insertParams[0] as string
    expect(id).toMatch(/^test-agent-[0-9a-f]{6}$/)
  })

  it('rejects empty name', async () => {
    await expect(
      createAgent(mockPool, USER_A, { name: '' }),
    ).rejects.toThrow('non-empty string')
  })

  it('rejects whitespace-only name', async () => {
    await expect(
      createAgent(mockPool, USER_A, { name: '   ' }),
    ).rejects.toThrow('non-empty string')
  })

  it('rejects name exceeding 100 characters', async () => {
    await expect(
      createAgent(mockPool, USER_A, { name: 'a'.repeat(101) }),
    ).rejects.toThrow('at most 100 characters')
  })

  it('enforces max agents per user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: MAX_AGENTS_PER_USER }] })

    await expect(
      createAgent(mockPool, USER_A, DEFAULT_INPUT),
    ).rejects.toThrow(`Maximum of ${String(MAX_AGENTS_PER_USER)} agents`)
  })

  it('uses default values when optional fields omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await createAgent(mockPool, USER_A, { name: 'Minimal' })

    const insertParams = mockQuery.mock.calls[1]![1] as unknown[]
    expect(insertParams[3]).toBe('')       // description
    expect(insertParams[4]).toBe('')       // systemPrompt
    expect(insertParams[5]).toBe('[]')     // tools (JSON)
    expect(insertParams[6]).toBe('haiku')  // model
    expect(insertParams[7]).toBe('read-only')
    expect(insertParams[8]).toBe(5)        // maxSteps
    expect(insertParams[9]).toBe(4096)     // maxTokens
    expect(insertParams[10]).toBe(30000)   // timeoutMs
    expect(insertParams[12]).toBeNull()    // cronSchedule
  })

  it('throws when DB returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      createAgent(mockPool, USER_A, DEFAULT_INPUT),
    ).rejects.toThrow('Failed to create agent')
  })

  it('validates riskProfile when provided', async () => {
    await expect(
      createAgent(mockPool, USER_A, { name: 'Bad', riskProfile: 'invalid' as 'read-only' }),
    ).rejects.toThrow('risk_profile must be one of')
  })

  it('validates maxSteps when provided', async () => {
    await expect(
      createAgent(mockPool, USER_A, { name: 'Bad', maxSteps: 0 }),
    ).rejects.toThrow('maxSteps must be a positive integer')
  })
})

// ---------------------------------------------------------------------------
// getAgent
// ---------------------------------------------------------------------------

describe('getAgent', () => {
  it('returns AgentDefinition for existing agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    const result = await getAgent(mockPool, USER_A, 'test-agent-abc123')

    expect(result).not.toBeNull()
    expect(result!.id).toBe('test-agent-abc123')
    expect(result!.name).toBe('Test Agent')
  })

  it('returns null for non-existent agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getAgent(mockPool, USER_A, 'nonexistent')
    expect(result).toBeNull()
  })

  it('scopes query by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getAgent(mockPool, USER_A, 'some-id')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// getUserAgents
// ---------------------------------------------------------------------------

describe('getUserAgents', () => {
  it('returns all agents for user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ id: 'a-1' }), fakeAgentRow({ id: 'a-2' })],
    })

    const result = await getUserAgents(mockPool, USER_A)
    expect(result).toHaveLength(2)
  })

  it('returns empty array when none exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getUserAgents(mockPool, USER_A)
    expect(result).toEqual([])
  })

  it('passes userId as parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getUserAgents(mockPool, USER_A)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// getActiveAgents
// ---------------------------------------------------------------------------

describe('getActiveAgents', () => {
  it('filters by status=active in SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await getActiveAgents(mockPool, USER_A)

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain("status = 'active'")
  })

  it('returns empty array when none active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getActiveAgents(mockPool, USER_A)
    expect(result).toEqual([])
  })

  it('scopes by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getActiveAgents(mockPool, USER_A)

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// updateAgent
// ---------------------------------------------------------------------------

describe('updateAgent', () => {
  it('updates a single field', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ description: 'Updated' })],
    })

    const result = await updateAgent(mockPool, USER_A, 'test-agent-abc123', {
      description: 'Updated',
    })

    expect(result.description).toBe('Updated')
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('description = $3')
  })

  it('updates multiple fields', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeAgentRow({ name: 'New Name', model: 'sonnet' })],
    })

    await updateAgent(mockPool, USER_A, 'test-agent-abc123', {
      name: 'New Name',
      model: 'sonnet',
    })

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('name = $3')
    expect(sql).toContain('model = $4')
  })

  it('throws for non-existent agent (empty rows)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      updateAgent(mockPool, USER_A, 'nonexistent', { description: 'x' }),
    ).rejects.toThrow('not found')
  })

  it('throws when no fields provided', async () => {
    await expect(
      updateAgent(mockPool, USER_A, 'test-agent-abc123', {}),
    ).rejects.toThrow('No fields to update')
  })

  it('validates riskProfile enum', async () => {
    await expect(
      updateAgent(mockPool, USER_A, 'test-agent-abc123', {
        riskProfile: 'godmode' as 'read-only',
      }),
    ).rejects.toThrow('risk_profile must be one of')
  })

  it('validates positive integer fields', async () => {
    await expect(
      updateAgent(mockPool, USER_A, 'test-agent-abc123', { maxSteps: -1 }),
    ).rejects.toThrow('maxSteps must be a positive integer')

    await expect(
      updateAgent(mockPool, USER_A, 'test-agent-abc123', { maxTokens: 0 }),
    ).rejects.toThrow('maxTokens must be a positive integer')
  })

  it('scopes query by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await updateAgent(mockPool, USER_A, 'test-agent-abc123', { description: 'x' })

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('user_id = $1')
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('updateStatus', () => {
  it('updates status successfully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'test-agent-abc123' }] })

    await expect(
      updateStatus(mockPool, USER_A, 'test-agent-abc123', 'dormant'),
    ).resolves.toBeUndefined()
  })

  it('throws for non-existent agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      updateStatus(mockPool, USER_A, 'nonexistent', 'dormant'),
    ).rejects.toThrow('not found')
  })

  it('rejects invalid status value', async () => {
    await expect(
      updateStatus(mockPool, USER_A, 'test', 'deleted' as 'active'),
    ).rejects.toThrow('status must be one of')
  })

  it('scopes by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] })

    await updateStatus(mockPool, USER_A, 'x', 'active')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// touchAgent
// ---------------------------------------------------------------------------

describe('touchAgent', () => {
  it('SQL contains usage_count + 1 and NOW()', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] })

    await touchAgent(mockPool, USER_A, 'x')

    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('usage_count = usage_count + 1')
    expect(sql).toContain('NOW()')
  })

  it('throws for non-existent agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      touchAgent(mockPool, USER_A, 'nonexistent'),
    ).rejects.toThrow('not found')
  })

  it('scopes by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] })

    await touchAgent(mockPool, USER_A, 'x')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// deleteAgent
// ---------------------------------------------------------------------------

describe('deleteAgent', () => {
  it('deletes successfully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'test-agent-abc123' }] })

    await expect(
      deleteAgent(mockPool, USER_A, 'test-agent-abc123'),
    ).resolves.toBeUndefined()
  })

  it('throws for non-existent agent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      deleteAgent(mockPool, USER_A, 'nonexistent'),
    ).rejects.toThrow('not found')
  })

  it('scopes by userId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] })

    await deleteAgent(mockPool, USER_A, 'x')

    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_A)
  })
})

// ---------------------------------------------------------------------------
// User isolation
// ---------------------------------------------------------------------------

describe('user isolation', () => {
  it('every query includes userId as first parameter', async () => {
    // getAgent
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await getAgent(mockPool, USER_B, 'some-id')
    expect((mockQuery.mock.calls[0]![1] as unknown[])[0]).toBe(USER_B)

    // getUserAgents
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await getUserAgents(mockPool, USER_B)
    expect((mockQuery.mock.calls[1]![1] as unknown[])[0]).toBe(USER_B)

    // getActiveAgents
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await getActiveAgents(mockPool, USER_B)
    expect((mockQuery.mock.calls[2]![1] as unknown[])[0]).toBe(USER_B)

    // updateStatus
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await updateStatus(mockPool, USER_B, 'x', 'dormant').catch(() => {})
    expect((mockQuery.mock.calls[3]![1] as unknown[])[0]).toBe(USER_B)

    // touchAgent
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await touchAgent(mockPool, USER_B, 'x').catch(() => {})
    expect((mockQuery.mock.calls[4]![1] as unknown[])[0]).toBe(USER_B)

    // deleteAgent
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await deleteAgent(mockPool, USER_B, 'x').catch(() => {})
    expect((mockQuery.mock.calls[5]![1] as unknown[])[0]).toBe(USER_B)
  })

  it('User B cannot get User A agent (DB returns empty)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getAgent(mockPool, USER_B, 'test-agent-abc123')
    expect(result).toBeNull()
  })

  it('User B cannot update User A agent (DB returns empty)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      updateAgent(mockPool, USER_B, 'test-agent-abc123', { description: 'hacked' }),
    ).rejects.toThrow('not found')
  })

  it('User B cannot delete User A agent (DB returns empty)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(
      deleteAgent(mockPool, USER_B, 'test-agent-abc123'),
    ).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// SQL injection — verify parameterized queries
// ---------------------------------------------------------------------------

describe('SQL injection', () => {
  it('SQL injection in name is passed as parameter, not interpolated', async () => {
    const maliciousName = "'; DROP TABLE agent_registry; --"
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] })
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow({ name: maliciousName })] })

    await createAgent(mockPool, USER_A, { name: maliciousName })

    const sql = mockQuery.mock.calls[1]![0] as string
    const params = mockQuery.mock.calls[1]![1] as unknown[]
    expect(sql).toContain('$1')
    expect(sql).toContain('$2')
    expect(sql).not.toContain(maliciousName)
    expect(params).toContain(maliciousName)
  })

  it('SQL injection in description is passed as parameter', async () => {
    const maliciousDesc = "'); DELETE FROM users; --"
    mockQuery.mockResolvedValueOnce({ rows: [fakeAgentRow()] })

    await updateAgent(mockPool, USER_A, 'test-agent-abc123', { description: maliciousDesc })

    const sql = mockQuery.mock.calls[0]![0] as string
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(sql).not.toContain(maliciousDesc)
    expect(params).toContain(maliciousDesc)
  })
})

// ---------------------------------------------------------------------------
// Security: source code audit
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no ev' + 'al or dynamic code execution patterns', () => {
    assertNoEval(SOURCE_CODE)
  })

  it('uses $-placeholders in all SQL queries (no string interpolation)', () => {
    const sqlConcat = /(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\s[^'"`]*\$\{/
    expect(SOURCE_CODE).not.toMatch(sqlConcat)

    const sqlPlus = /(?:SELECT|INSERT|UPDATE|DELETE)\s.*['"]\s*\+/
    expect(SOURCE_CODE).not.toMatch(sqlPlus)
  })

  it('uses pool.query with parameter arrays for all data operations', () => {
    const queryCount = (SOURCE_CODE.match(/pool\.query\(/g) ?? []).length
    // create (count + insert), get, getUserAgents, getActiveAgents, update, updateStatus, touch, delete = 9
    expect(queryCount).toBeGreaterThanOrEqual(9)
  })
})
