/**
 * Delegate tool — enables the main agent to delegate tasks to registered sub-agents.
 *
 * Factory pattern: createDelegateTool(userId, pool, llmClient) → ExtendedAgentTool
 * LlmClient is injected via DI (same pattern as CronBridge in scheduler.ts).
 *
 * No eval. No unauthorized network access.
 */

import { getAgent } from './agent-registry'
import { executeAgent } from './agent-executor'
import type { LlmClient, AgentTask } from './agent-executor'
import type { AgentToolResult, DbPool, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TASK_LENGTH = 10_000
const MAX_CONTEXT_LENGTH = 5_000
const MAX_AGENT_ID_LENGTH = 100

/**
 * Agent IDs are kebab-case name + hyphen + 6 hex chars (see agent-registry.ts).
 * Allow letters, digits, hyphens — no dots, slashes, or special chars.
 */
const AGENT_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface DelegateArgs {
  readonly agentId: string
  readonly task: string
  readonly context?: string
}

function parseArgs(args: unknown): DelegateArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>

  // agentId — validate type, length, and format
  if (typeof obj['agentId'] !== 'string' || obj['agentId'].trim() === '') {
    throw new Error('agentId must be a non-empty string')
  }
  const agentId = obj['agentId'].trim()
  if (agentId.length > MAX_AGENT_ID_LENGTH) {
    throw new Error('agentId must be at most ' + String(MAX_AGENT_ID_LENGTH) + ' characters')
  }
  if (!AGENT_ID_REGEX.test(agentId)) {
    throw new Error('agentId must contain only lowercase letters, digits, and hyphens')
  }

  // task
  if (typeof obj['task'] !== 'string' || obj['task'].trim() === '') {
    throw new Error('task must be a non-empty string')
  }
  const task = obj['task'].trim()
  if (task.length > MAX_TASK_LENGTH) {
    throw new Error('task must be at most ' + String(MAX_TASK_LENGTH) + ' characters')
  }

  // context (optional)
  let context: string | undefined
  if (obj['context'] !== undefined && obj['context'] !== null) {
    if (typeof obj['context'] !== 'string') {
      throw new Error('context must be a string')
    }
    const trimmed = obj['context'].trim()
    if (trimmed.length > MAX_CONTEXT_LENGTH) {
      throw new Error('context must be at most ' + String(MAX_CONTEXT_LENGTH) + ' characters')
    }
    if (trimmed.length > 0) {
      context = trimmed
    }
  }

  return { agentId, task, context }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function textResult(data: Record<string, unknown>): AgentToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    agentId: {
      type: 'string',
      description: 'The ID of the sub-agent to delegate the task to.',
    },
    task: {
      type: 'string',
      description: 'The task description for the sub-agent (max 10,000 characters).',
    },
    context: {
      type: 'string',
      description: 'Optional additional context for the sub-agent (max 5,000 characters).',
    },
  },
  required: ['agentId', 'task'],
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createDelegateTool(
  userId: string,
  pool: DbPool,
  llmClient: LlmClient,
): ExtendedAgentTool {
  return {
    name: 'delegate',
    description:
      'Delegate a task to a registered sub-agent. The sub-agent runs in isolation with its own tools, model, and memory. Returns the sub-agent result including summary, tool call count, and token usage.',
    parameters: PARAMETERS,
    permissions: [],
    requiresConfirmation: false,
    runsOn: 'server',
    defaultRiskTier: 2,

    async execute(args: unknown): Promise<AgentToolResult> {
      // 1. Parse & validate arguments
      let parsed: DelegateArgs
      try {
        parsed = parseArgs(args)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return textResult({ status: 'failure', error: msg })
      }

      try {
        // 2. Look up agent
        const agentDef = await getAgent(pool, userId, parsed.agentId)
        if (!agentDef) {
          return textResult({
            status: 'failure',
            agentId: parsed.agentId,
            error: 'Agent "' + parsed.agentId + '" not found.',
            reason: 'agent-not-found',
          })
        }

        // 3. Check status
        if (agentDef.status !== 'active') {
          return textResult({
            status: 'failure',
            agentId: parsed.agentId,
            error: 'Agent "' + parsed.agentId + '" is not available.',
            reason: 'agent-inactive',
          })
        }

        // 4. Build AgentTask
        const agentTask: AgentTask = {
          userId,
          agentId: parsed.agentId,
          task: parsed.task,
          context: parsed.context,
          timeout: agentDef.timeoutMs,
        }

        // 5. Execute
        const result = await executeAgent(agentTask, pool, llmClient)

        // 6. Map result
        switch (result.status) {
          case 'success':
            return textResult({
              status: 'success',
              agentId: parsed.agentId,
              summary: result.output,
              toolCalls: result.toolCalls,
              usage: result.usage,
            })

          case 'partial':
            return textResult({
              status: 'partial',
              agentId: parsed.agentId,
              summary: result.output,
              reason: result.reason,
              toolCalls: result.toolCalls,
              usage: result.usage,
            })

          case 'failure':
            return textResult({
              status: 'failure',
              agentId: parsed.agentId,
              error: result.output,
              reason: result.reason,
            })

          case 'needs-approval':
            return textResult({
              status: 'needs-approval',
              agentId: parsed.agentId,
              summary: result.output,
              pendingActions: result.pendingActions,
              reason: result.reason,
            })
        }
      } catch {
        // Catch-all for unexpected errors (DB failures, network issues, etc.)
        // Sanitized — no stack traces or internal details exposed
        return textResult({
          status: 'failure',
          agentId: parsed.agentId,
          error: 'Delegation failed due to an internal error.',
          reason: 'internal-error',
        })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createDelegateTool, parseArgs }
