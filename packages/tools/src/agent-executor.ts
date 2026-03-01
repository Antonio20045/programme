/**
 * Agent Executor — runs sub-agents as isolated LLM calls.
 *
 * Each sub-agent gets its own system prompt, tools, model, and memory.
 * It does NOT see the parent chat history. The orchestrator delegates
 * tasks via AgentTask and receives an AgentResult.
 *
 * LLM access is injected via LlmClient (same DI pattern as CronBridge
 * in scheduler.ts) — no direct dependency on any LLM SDK.
 */

import { createHash, randomUUID } from 'node:crypto'

import { getAgent, touchAgent } from './agent-registry'
import type { TrustLevel } from './agent-registry'
import { formatForSystemPrompt } from './agent-memory'
import { resolveModelForAgent } from './model-resolver'
import { getTool } from './index'
import type { DbPool, ExtendedAgentTool, RiskTier, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// LLM abstraction (injected)
// ---------------------------------------------------------------------------

interface LlmTextBlock {
  readonly type: 'text'
  readonly text: string
}

interface LlmToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

interface LlmToolResultBlock {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: string
}

type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock

interface LlmMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string | readonly LlmContentBlock[]
}

interface LlmToolDef {
  readonly name: string
  readonly description: string
  readonly input_schema: JSONSchema
}

interface LlmResponse {
  readonly stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
  readonly content: readonly LlmContentBlock[]
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number }
}

interface LlmClient {
  chat(params: {
    provider: string
    model: string
    system: string
    messages: readonly LlmMessage[]
    tools: readonly LlmToolDef[]
    max_tokens: number
  }): Promise<LlmResponse>
}

// ---------------------------------------------------------------------------
// Agent task & result types
// ---------------------------------------------------------------------------

interface AgentTask {
  readonly userId: string
  readonly agentId: string
  readonly task: string
  readonly context?: string
  readonly timeout: number // ms
}

type AgentResultStatus = 'success' | 'partial' | 'failure' | 'needs-approval'

interface AgentResult {
  readonly status: AgentResultStatus
  readonly output: string
  readonly toolCalls: number
  readonly pendingActions: readonly ActionProposal[]
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly reason?: string
}

interface ActionProposal {
  readonly id: string
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly riskTier: RiskTier
  readonly description: string
}

// ---------------------------------------------------------------------------
// Tier resolution for agent-internal tool calls
// ---------------------------------------------------------------------------

const READ_ACTIONS = /^(read|get|list|search|check|status|info|query|fetch|find|count|view|show)/i
const WRITE_ACTIONS = /^(write|create|update|set|add|edit|save|put|modify|rename|move|copy)/i
const SEND_ACTIONS = /^(send|publish|post|share|forward|reply|broadcast|notify|invite)/i
const DELETE_ACTIONS = /^(delete|remove|drop|purge|revoke|cancel|destroy|clear|reset|wipe)/i

function isValidTier(value: unknown): value is RiskTier {
  return typeof value === 'number' && [0, 1, 2, 3, 4].includes(value)
}

function getToolRiskTier(
  toolName: string,
  params: Record<string, unknown>,
  toolDef?: ExtendedAgentTool,
): RiskTier {
  const action = typeof params['action'] === 'string' ? params['action'] : ''

  // 1. Consult tool-defined per-action tiers (authoritative source)
  if (toolDef?.riskTiers && action) {
    const tier = toolDef.riskTiers[action]
    if (isValidTier(tier)) return tier
  }

  // 2. Consult tool-defined default tier
  if (toolDef && isValidTier(toolDef.defaultRiskTier)) {
    return toolDef.defaultRiskTier
  }

  // 3. Heuristic fallback: check action name prefix
  if (action) {
    if (DELETE_ACTIONS.test(action)) return 4
    if (SEND_ACTIONS.test(action)) return 3
    if (WRITE_ACTIONS.test(action)) return 2
    if (READ_ACTIONS.test(action)) return 1
  }

  // 4. Heuristic fallback: check tool name
  if (DELETE_ACTIONS.test(toolName)) return 4
  if (SEND_ACTIONS.test(toolName)) return 3
  if (WRITE_ACTIONS.test(toolName)) return 2
  if (READ_ACTIONS.test(toolName)) return 1

  // 5. Default: local write level (conservative)
  return 2
}

// ---------------------------------------------------------------------------
// Approval threshold per trust level
// ---------------------------------------------------------------------------

function getApprovalThreshold(trustLevel: TrustLevel): RiskTier {
  switch (trustLevel) {
    case 'intern': return 2
    case 'junior': return 3
    case 'senior': return 4
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(content: readonly LlmContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

function hashToolCall(name: string, input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(name + JSON.stringify(input))
    .digest('hex')
}

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), ms)
  })
}

// ---------------------------------------------------------------------------
// Safety limits
// ---------------------------------------------------------------------------

/** Hard upper bound on tool calls per execution, regardless of agent config. */
const MAX_STEPS_LIMIT = 50

/** Hard upper bound on execution timeout (5 minutes). */
const MAX_TIMEOUT_MS = 300_000

/** Maximum size of a single tool result text before truncation (50 KB). */
const MAX_TOOL_RESULT_LENGTH = 50_000

function truncateToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_LENGTH) return text
  const half = Math.floor(MAX_TOOL_RESULT_LENGTH / 2)
  return text.slice(0, half) + '\n\n[... truncated ...]\n\n' + text.slice(-half)
}

// ---------------------------------------------------------------------------
// executeAgent
// ---------------------------------------------------------------------------

const LLM_RETRY_DELAY_MS = 2_000
const FALLBACK_PROVIDER_PREFIX = 'anthropic/'

async function executeAgent(
  task: AgentTask,
  pool: DbPool,
  llmClient: LlmClient,
): Promise<AgentResult> {
  // 1. Load agent definition
  const agentDef = await getAgent(pool, task.userId, task.agentId)
  if (!agentDef) {
    return {
      status: 'failure',
      output: `Agent "${task.agentId}" nicht gefunden.`,
      toolCalls: 0,
      pendingActions: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      reason: 'agent-not-found',
    }
  }

  // 2. Clamp safety limits
  const maxSteps = Math.min(agentDef.maxSteps, MAX_STEPS_LIMIT)
  const timeout = Math.min(task.timeout, MAX_TIMEOUT_MS)

  // 3. Load memory
  const memoryText = await formatForSystemPrompt(pool, task.agentId, task.userId)

  // 4. Build system prompt
  let system = agentDef.systemPrompt
  if (memoryText) {
    system += '\n\n## Erinnerungen\n' + memoryText
  }
  system += `\n\n## Budget\nDu hast maximal ${String(maxSteps)} Tool-Aufrufe.`

  // 5. Resolve tools — build allowlist AND LLM tool definitions
  const allowedToolNames = new Set(agentDef.tools)
  const tools: LlmToolDef[] = []
  for (const toolName of agentDef.tools) {
    const tool = getTool(toolName)
    if (tool) {
      tools.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })
    }
  }

  // 6. Resolve model
  const resolved = resolveModelForAgent(agentDef.model)
  let provider = resolved.provider
  let model = resolved.model

  // 7. Build initial messages
  const userContent = task.context
    ? task.task + '\n\n' + task.context
    : task.task
  const messages: LlmMessage[] = [{ role: 'user', content: userContent }]

  // 8. Run tool loop with timeout
  const toolLoop = async (): Promise<AgentResult> => {
    let toolCallCount = 0
    const seenHashes = new Set<string>()
    const pendingActions: ActionProposal[] = []
    let totalInput = 0
    let totalOutput = 0
    let hasFallenBack = false

    // eslint-disable-next-line no-constant-condition -- agentic loop exits via return
    while (true) {
      // --- LLM call with retry + fallback ---
      let response: LlmResponse
      try {
        response = await llmClient.chat({
          provider,
          model,
          system,
          messages,
          tools,
          max_tokens: agentDef.maxTokens,
        })
      } catch (firstError: unknown) {
        // Retry once after delay
        await new Promise(r => setTimeout(r, LLM_RETRY_DELAY_MS))
        try {
          response = await llmClient.chat({
            provider,
            model,
            system,
            messages,
            tools,
            max_tokens: agentDef.maxTokens,
          })
        } catch (retryError: unknown) {
          // Gemini fallback: only if google provider, fallback exists, and no tokens consumed yet
          if (
            provider === 'google' &&
            resolved.fallbackModel &&
            totalInput === 0 &&
            !hasFallenBack
          ) {
            hasFallenBack = true
            if (resolved.fallbackModel.startsWith(FALLBACK_PROVIDER_PREFIX)) {
              provider = 'anthropic'
              model = resolved.fallbackModel.slice(FALLBACK_PROVIDER_PREFIX.length)
            } else {
              provider = 'anthropic'
              model = resolved.fallbackModel
            }
            // Try once with the fallback
            try {
              response = await llmClient.chat({
                provider,
                model,
                system,
                messages,
                tools,
                max_tokens: agentDef.maxTokens,
              })
            } catch {
              return {
                status: 'failure',
                output: `LLM-Fehler nach Fallback: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
                toolCalls: toolCallCount,
                pendingActions: [],
                usage: { inputTokens: totalInput, outputTokens: totalOutput },
                reason: 'llm-error',
              }
            }
          } else {
            return {
              status: 'failure',
              output: `LLM-Fehler: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
              toolCalls: toolCallCount,
              pendingActions: [],
              usage: { inputTokens: totalInput, outputTokens: totalOutput },
              reason: 'llm-error',
            }
          }
        }
      }

      totalInput += response.usage.input_tokens
      totalOutput += response.usage.output_tokens

      // --- End turn or max tokens → extract text and return ---
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        const text = extractText(response.content)
        return {
          status: 'success',
          output: text,
          toolCalls: toolCallCount,
          pendingActions: [],
          usage: { inputTokens: totalInput, outputTokens: totalOutput },
        }
      }

      // --- Tool use handling ---
      const toolUseBlocks = response.content.filter(
        (b): b is LlmToolUseBlock => b.type === 'tool_use',
      )
      const toolResults: LlmContentBlock[] = []

      for (const block of toolUseBlocks) {
        toolCallCount++

        // Budget check
        if (toolCallCount > maxSteps) {
          return {
            status: 'partial',
            output: extractText(response.content),
            toolCalls: toolCallCount - 1,
            pendingActions: [],
            usage: { inputTokens: totalInput, outputTokens: totalOutput },
            reason: 'Budget erschöpft',
          }
        }

        // Loop detection
        const hash = hashToolCall(block.name, block.input)
        if (seenHashes.has(hash)) {
          return {
            status: 'partial',
            output: extractText(response.content),
            toolCalls: toolCallCount,
            pendingActions: [],
            usage: { inputTokens: totalInput, outputTokens: totalOutput },
            reason: 'Loop erkannt',
          }
        }
        seenHashes.add(hash)

        // Allowlist check — reject tools not in the agent definition
        if (!allowedToolNames.has(block.name)) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: Tool "${block.name}" ist nicht erlaubt.`,
          })
          continue
        }

        // Resolve tool definition
        const tool = getTool(block.name)
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: Tool "${block.name}" nicht gefunden.`,
          })
          continue
        }

        // Risk check — consult tool-defined tiers first, then heuristic
        const riskTier = getToolRiskTier(block.name, block.input, tool)
        const threshold = getApprovalThreshold(agentDef.trustLevel)
        if (riskTier >= threshold) {
          pendingActions.push({
            id: randomUUID(),
            toolName: block.name,
            params: block.input,
            riskTier,
            description: `${block.name}(${JSON.stringify(block.input)})`,
          })
          return {
            status: 'needs-approval',
            output: extractText(response.content),
            toolCalls: toolCallCount,
            pendingActions,
            usage: { inputTokens: totalInput, outputTokens: totalOutput },
            reason: `Tier ${riskTier} erfordert Genehmigung (Schwelle: ${threshold})`,
          }
        }

        try {
          const result = await tool.execute(block.input)
          const rawText = result.content
            .map(c => ('text' in c ? c.text : '[non-text content]'))
            .join('\n')
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: truncateToolResult(rawText),
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${msg}`,
          })
        }
      }

      // Append assistant turn + tool results for next iteration
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
    }
  }

  // 9. Race loop against timeout
  let result: AgentResult
  try {
    result = await Promise.race([toolLoop(), sleep(timeout)])
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'timeout') {
      result = {
        status: 'partial',
        output: '',
        toolCalls: 0,
        pendingActions: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        reason: 'Timeout',
      }
    } else {
      throw err
    }
  }

  // 10. Update usage counter
  try {
    await touchAgent(pool, task.userId, task.agentId)
  } catch {
    // Non-critical — don't fail the result
  }

  return result
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { executeAgent, getToolRiskTier, getApprovalThreshold, MAX_STEPS_LIMIT, MAX_TIMEOUT_MS, MAX_TOOL_RESULT_LENGTH }
export type {
  AgentTask,
  AgentResult,
  AgentResultStatus,
  ActionProposal,
  LlmClient,
  LlmMessage,
  LlmContentBlock,
  LlmTextBlock,
  LlmToolUseBlock,
  LlmToolResultBlock,
  LlmToolDef,
  LlmResponse,
}
