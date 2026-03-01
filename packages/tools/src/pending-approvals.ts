/**
 * Pending-Approval Store — holds ActionProposals from sub-agents
 * between creation and user decision (approve/reject).
 *
 * In-memory Map (ephemeral). On server restart, sub-agent context
 * is lost anyway, so persistence is unnecessary.
 */

import { getTool } from './index'
import type { AgentToolResult } from './types'
import type { ActionProposal } from './agent-executor'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 10 * 60 * 1000 // 10 minutes
const MAX_TTL_MS = 60 * 60 * 1000     // 1 hour hard cap
const MAX_STORE_SIZE = 1000
const MAX_ID_LENGTH = 200
const MAX_AGENT_ID_LENGTH = 200

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoredProposal {
  readonly proposal: ActionProposal
  readonly agentId: string
  readonly createdAt: number
  readonly expiresAt: number
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = new Map<string, StoredProposal>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function storeProposal(
  proposal: ActionProposal,
  agentId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  if (!proposal.id || proposal.id.trim() === '') {
    throw new Error('Proposal id must be non-empty')
  }
  if (proposal.id.length > MAX_ID_LENGTH) {
    throw new Error('Proposal id exceeds maximum length')
  }
  if (!proposal.toolName || proposal.toolName.trim() === '') {
    throw new Error('Proposal toolName must be non-empty')
  }
  if (!agentId || agentId.trim() === '') {
    throw new Error('agentId must be non-empty')
  }
  if (agentId.length > MAX_AGENT_ID_LENGTH) {
    throw new Error('agentId exceeds maximum length')
  }

  // Clamp TTL to valid range
  const safeTtl = Math.max(0, Math.min(ttlMs, MAX_TTL_MS))

  // Evict expired entries if store is at capacity
  if (store.size >= MAX_STORE_SIZE) {
    cleanupExpired()
  }
  if (store.size >= MAX_STORE_SIZE) {
    throw new Error('Pending-approval store is full')
  }

  const now = Date.now()
  store.set(proposal.id, {
    proposal,
    agentId,
    createdAt: now,
    expiresAt: now + safeTtl,
  })
}

function getProposal(proposalId: string): StoredProposal | null {
  const entry = store.get(proposalId)
  if (!entry) return null

  if (Date.now() >= entry.expiresAt) {
    store.delete(proposalId)
    return null
  }

  return entry
}

function removeProposal(proposalId: string): void {
  store.delete(proposalId)
}

async function executeApproval(
  proposalId: string,
  modifiedParams?: Record<string, unknown>,
): Promise<AgentToolResult> {
  const entry = getProposal(proposalId)
  if (!entry) {
    throw new Error('Proposal not found or expired')
  }

  // Delete immediately to prevent double-execution (defense-in-depth)
  store.delete(proposalId)

  const tool = getTool(entry.proposal.toolName)
  if (!tool) {
    throw new Error('Tool not found for proposal')
  }

  const params = modifiedParams ?? entry.proposal.params
  return tool.execute(params)
}

function rejectApproval(proposalId: string): StoredProposal | null {
  const entry = getProposal(proposalId)
  if (!entry) return null

  store.delete(proposalId)
  return entry
}

function cleanupExpired(): number {
  const now = Date.now()
  let removed = 0

  for (const [id, entry] of store) {
    if (now >= entry.expiresAt) {
      store.delete(id)
      removed++
    }
  }

  return removed
}

/** Test-only: clears the entire store. */
function _clearAll(): void {
  store.clear()
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  storeProposal,
  getProposal,
  removeProposal,
  executeApproval,
  rejectApproval,
  cleanupExpired,
  _clearAll,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MAX_STORE_SIZE,
}
export type { StoredProposal }
