import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch, assertNoInnerHTML } from './helpers'
import type { ActionProposal } from '../src/agent-executor'
import type { ExtendedAgentTool } from '../src/types'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/pending-approvals.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mocks — tool registry (getTool)
// ---------------------------------------------------------------------------

const mockGetTool = vi.fn<(name: string) => ExtendedAgentTool | undefined>()

vi.mock('../src/index', () => ({
  getTool: (...args: unknown[]) => mockGetTool(args[0] as string),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  storeProposal,
  getProposal,
  removeProposal,
  executeApproval,
  rejectApproval,
  cleanupExpired,
  _clearAll,
  DEFAULT_TTL_MS,
} from '../src/pending-approvals'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: 'prop-001',
    toolName: 'gmail',
    params: { action: 'sendEmail', to: 'user@example.com', body: 'Hello' },
    riskTier: 3,
    description: 'gmail({"action":"sendEmail","to":"user@example.com"})',
    ...overrides,
  }
}

function createMockTool(name: string, result = 'ok'): ExtendedAgentTool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object' as const, properties: {}, required: [] as string[] },
    permissions: [] as string[],
    requiresConfirmation: false,
    runsOn: 'server' as const,
    defaultRiskTier: 2,
    execute: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: result }],
    })),
  }
}

const AGENT_ID = 'mailer-bot-abc123'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearAll()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Behavior tests
// ---------------------------------------------------------------------------

describe('pending-approvals', () => {
  it('storeProposal + getProposal roundtrip', () => {
    const proposal = makeProposal()
    storeProposal(proposal, AGENT_ID)

    const stored = getProposal('prop-001')
    expect(stored).not.toBeNull()
    expect(stored!.proposal).toEqual(proposal)
    expect(stored!.agentId).toBe(AGENT_ID)
    expect(stored!.expiresAt).toBe(stored!.createdAt + DEFAULT_TTL_MS)
  })

  it('removeProposal makes getProposal return null', () => {
    storeProposal(makeProposal(), AGENT_ID)
    removeProposal('prop-001')

    expect(getProposal('prop-001')).toBeNull()
  })

  it('executeApproval runs tool with stored params', async () => {
    const proposal = makeProposal()
    storeProposal(proposal, AGENT_ID)

    const gmailTool = createMockTool('gmail', 'Email sent')
    mockGetTool.mockImplementation((name: string) =>
      name === 'gmail' ? gmailTool : undefined,
    )

    const result = await executeApproval('prop-001')

    expect(gmailTool.execute).toHaveBeenCalledWith(proposal.params)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Email sent' })
    // Proposal removed after execution
    expect(getProposal('prop-001')).toBeNull()
  })

  it('executeApproval uses modifiedParams when provided', async () => {
    storeProposal(makeProposal(), AGENT_ID)

    const gmailTool = createMockTool('gmail')
    mockGetTool.mockReturnValue(gmailTool)

    const modified = { action: 'sendEmail', to: 'other@example.com', body: 'Changed' }
    await executeApproval('prop-001', modified)

    expect(gmailTool.execute).toHaveBeenCalledWith(modified)
  })

  it('rejectApproval removes and returns proposal', () => {
    const proposal = makeProposal()
    storeProposal(proposal, AGENT_ID)

    const returned = rejectApproval('prop-001')

    expect(returned).not.toBeNull()
    expect(returned!.proposal).toEqual(proposal)
    expect(returned!.agentId).toBe(AGENT_ID)
    expect(getProposal('prop-001')).toBeNull()
  })

  it('rejectApproval returns null for unknown ID', () => {
    expect(rejectApproval('unknown-id')).toBeNull()
  })

  it('cleanupExpired removes only expired entries', () => {
    // Store two proposals: one fresh, one already expired
    storeProposal(makeProposal({ id: 'fresh' }), AGENT_ID)
    storeProposal(makeProposal({ id: 'expired' }), AGENT_ID, 0)

    const removed = cleanupExpired()

    expect(removed).toBe(1)
    expect(getProposal('fresh')).not.toBeNull()
    expect(getProposal('expired')).toBeNull()
  })

  it('getProposal returns null for non-existent ID', () => {
    expect(getProposal('does-not-exist')).toBeNull()
  })

  it('getProposal returns null for expired proposal (lazy cleanup)', () => {
    storeProposal(makeProposal(), AGENT_ID, 0)

    expect(getProposal('prop-001')).toBeNull()
  })

  it('executeApproval throws for unknown ID', async () => {
    await expect(executeApproval('unknown')).rejects.toThrow(
      'Proposal not found or expired',
    )
  })

  it('executeApproval throws for unknown tool and removes proposal', async () => {
    storeProposal(makeProposal({ toolName: 'nonexistent' }), AGENT_ID)
    mockGetTool.mockReturnValue(undefined)

    await expect(executeApproval('prop-001')).rejects.toThrow(
      'Tool not found for proposal',
    )
    // Proposal should be removed even on tool-not-found
    expect(getProposal('prop-001')).toBeNull()
  })

  it('storeProposal throws on empty id', () => {
    expect(() => storeProposal(makeProposal({ id: '' }), AGENT_ID)).toThrow(
      'Proposal id must be non-empty',
    )
  })

  it('storeProposal throws on empty toolName', () => {
    expect(() => storeProposal(makeProposal({ toolName: '' }), AGENT_ID)).toThrow(
      'Proposal toolName must be non-empty',
    )
  })

  it('storeProposal throws on empty agentId', () => {
    expect(() => storeProposal(makeProposal(), '')).toThrow(
      'agentId must be non-empty',
    )
    expect(() => storeProposal(makeProposal(), '   ')).toThrow(
      'agentId must be non-empty',
    )
  })

  it('storeProposal throws on oversized id', () => {
    const longId = 'x'.repeat(201)
    expect(() => storeProposal(makeProposal({ id: longId }), AGENT_ID)).toThrow(
      'Proposal id exceeds maximum length',
    )
  })

  it('storeProposal throws on oversized agentId', () => {
    const longAgent = 'a'.repeat(201)
    expect(() => storeProposal(makeProposal(), longAgent)).toThrow(
      'agentId exceeds maximum length',
    )
  })

  it('storeProposal clamps TTL to safe range (no Infinity)', () => {
    storeProposal(makeProposal(), AGENT_ID, Infinity)
    const stored = getProposal('prop-001')
    expect(stored).not.toBeNull()
    // TTL should be clamped to MAX_TTL_MS (1 hour), not Infinity
    const ttl = stored!.expiresAt - stored!.createdAt
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000)
    expect(ttl).toBeGreaterThanOrEqual(0)
  })

  it('storeProposal clamps negative TTL to zero', () => {
    storeProposal(makeProposal(), AGENT_ID, -5000)
    // Negative TTL is clamped to 0, entry expires immediately
    expect(getProposal('prop-001')).toBeNull()
  })

  it('storeProposal rejects when store is full', () => {
    // Fill store to capacity (1000 entries)
    for (let i = 0; i < 1000; i++) {
      storeProposal(makeProposal({ id: `p-${String(i)}` }), AGENT_ID)
    }

    expect(() =>
      storeProposal(makeProposal({ id: 'overflow' }), AGENT_ID),
    ).toThrow('Pending-approval store is full')
  })

  it('storeProposal evicts expired entries before rejecting', () => {
    // Fill store with expired entries
    for (let i = 0; i < 1000; i++) {
      storeProposal(makeProposal({ id: `exp-${String(i)}` }), AGENT_ID, 0)
    }

    // Should succeed because cleanup evicts all expired entries
    expect(() =>
      storeProposal(makeProposal({ id: 'new-after-evict' }), AGENT_ID),
    ).not.toThrow()
    expect(getProposal('new-after-evict')).not.toBeNull()
  })

  it('error messages do not leak user-supplied values', async () => {
    // Verify error messages are generic (no reflection of input)
    try {
      await executeApproval('malicious<script>alert(1)</script>')
    } catch (err: unknown) {
      const msg = (err as Error).message
      expect(msg).not.toContain('malicious')
      expect(msg).not.toContain('<script>')
      expect(msg).toBe('Proposal not found or expired')
    }
  })

  it('handles proposal id __proto__ correctly via Map', () => {
    // Map is immune to prototype pollution, but verify explicitly
    storeProposal(makeProposal({ id: '__proto__' }), AGENT_ID)
    const stored = getProposal('__proto__')
    expect(stored).not.toBeNull()
    expect(stored!.proposal.id).toBe('__proto__')

    // Object.prototype should not be affected
    expect(Object.prototype.hasOwnProperty('proposal')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe('pending-approvals security', () => {
  it('contains no eval/new Function patterns', () => {
    assertNoEval(sourceCode)
  })

  it('contains no unauthorized fetch calls', () => {
    assertNoUnauthorizedFetch(sourceCode, [])
  })

  it('contains no inner' + 'HTML patterns', () => {
    assertNoInnerHTML(sourceCode)
  })
})
