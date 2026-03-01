/**
 * Agent Factory — Tool for creating new sub-agents.
 *
 * Factory pattern: createAgentFactoryTool(userId, pool) → ExtendedAgentTool
 * Single-action tool (no action parameter).
 *
 * Validates all inputs, generates system prompt, derives risk profile,
 * then delegates to agent-registry.createAgent().
 */

import { createAgent, getActiveAgents } from './agent-registry'
import type { CreateAgentInput, RiskProfile } from './agent-registry'
import { getToolRiskTier } from './agent-executor'
import { getTool } from './index'
import type { AgentToolResult, DbPool, ExtendedAgentTool, JSONSchema, RiskTier } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 50
const MAX_PURPOSE_LENGTH = 2_000
const MAX_TOOLS_COUNT = 10
const MIN_CRON_INTERVAL_MINUTES = 15
const VALID_MODELS = ['haiku', 'sonnet'] as const
type ValidModel = (typeof VALID_MODELS)[number]

/** Allowed characters in agent names: letters, digits, spaces, hyphens, underscores, German umlauts. */
const NAME_CHARS = /^[\w \-äöüÄÖÜß]+$/

// ---------------------------------------------------------------------------
// Cron validation
// ---------------------------------------------------------------------------

/** 5-field standard cron: minute hour day-of-month month day-of-week */
const CRON_REGEX =
  /^(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-/]+)$/

/** Validate range of a single cron field's numeric values. */
function fieldInRange(field: string, min: number, max: number): boolean {
  // Extract all numeric values from the field (ignoring *, /, -)
  const nums = field.match(/\d+/g)
  if (!nums) return true // pure * is valid
  return nums.every((n) => {
    const v = Number(n)
    return v >= min && v <= max
  })
}

function isValidCron(expr: string): boolean {
  if (!CRON_REGEX.test(expr.trim())) return false

  // Semantic range validation per field
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return (
    fieldInRange(parts[0]!, 0, 59) &&  // minute
    fieldInRange(parts[1]!, 0, 23) &&  // hour
    fieldInRange(parts[2]!, 1, 31) &&  // day-of-month
    fieldInRange(parts[3]!, 1, 12) &&  // month
    fieldInRange(parts[4]!, 0, 7)      // day-of-week (0 and 7 = Sunday)
  )
}

function isCronTooFrequent(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return true

  const minuteField = parts[0]!
  const hourField = parts[1]!
  const domField = parts[2]!

  const hourIsWild = hourField === '*'
  const domIsWild = domField === '*'

  // Every minute: * * * * *
  if (minuteField === '*' && hourIsWild) return true

  // Step pattern: */N with wildcard hour+dom
  const stepMatch = minuteField.match(/^\*\/(\d+)$/)
  if (stepMatch && hourIsWild && domIsWild) {
    const step = Number(stepMatch[1])
    if (step < MIN_CRON_INTERVAL_MINUTES) return true
  }

  // Comma-separated minutes with wildcard hour+dom
  if (hourIsWild && domIsWild && /^[0-9,]+$/.test(minuteField)) {
    const minutes = minuteField.split(',').map(Number).sort((a, b) => a - b)
    if (minutes.length >= 2) {
      for (let i = 1; i < minutes.length; i++) {
        if (minutes[i]! - minutes[i - 1]! < MIN_CRON_INTERVAL_MINUTES) return true
      }
      // Wrap-around: 60 - last + first
      const wrapGap = 60 - minutes[minutes.length - 1]! + minutes[0]!
      if (wrapGap < MIN_CRON_INTERVAL_MINUTES) return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface AgentFactoryArgs {
  readonly name: string
  readonly purpose: string
  readonly tools: readonly string[]
  readonly schedule: string | null
  readonly model: ValidModel
}

function parseArgs(args: unknown): AgentFactoryArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be a non-null object')
  }

  const obj = args as Record<string, unknown>

  // name
  if (typeof obj['name'] !== 'string' || obj['name'].trim() === '') {
    throw new Error('name must be a non-empty string')
  }
  const name = obj['name'].trim()
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error('name must be at most ' + String(MAX_NAME_LENGTH) + ' characters')
  }
  if (!NAME_CHARS.test(name)) {
    throw new Error('name contains invalid characters')
  }

  // purpose
  if (typeof obj['purpose'] !== 'string' || obj['purpose'].trim() === '') {
    throw new Error('purpose must be a non-empty string')
  }
  const purpose = obj['purpose'].trim()
  if (purpose.length > MAX_PURPOSE_LENGTH) {
    throw new Error('purpose must be at most ' + String(MAX_PURPOSE_LENGTH) + ' characters')
  }

  // tools
  if (!Array.isArray(obj['tools']) || obj['tools'].length === 0) {
    throw new Error('tools must be a non-empty array of strings')
  }
  if (obj['tools'].length > MAX_TOOLS_COUNT) {
    throw new Error('tools must have at most ' + String(MAX_TOOLS_COUNT) + ' entries')
  }
  const tools: string[] = []
  for (const item of obj['tools'] as unknown[]) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('Each tool must be a non-empty string')
    }
    tools.push(item.trim())
  }
  const uniqueTools = [...new Set(tools)]

  // schedule
  let schedule: string | null = null
  if (obj['schedule'] !== undefined && obj['schedule'] !== null) {
    if (typeof obj['schedule'] !== 'string') {
      throw new Error('schedule must be a string or null')
    }
    const trimmed = obj['schedule'].trim()
    if (trimmed.length > 0) {
      schedule = trimmed
    }
  }

  // model
  if (typeof obj['model'] !== 'string') {
    throw new Error('model must be a string')
  }
  if (!(VALID_MODELS as readonly string[]).includes(obj['model'])) {
    throw new Error('model must be one of: ' + VALID_MODELS.join(', '))
  }
  const model = obj['model'] as ValidModel

  return { name, purpose, tools: uniqueTools, schedule, model }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(data: Record<string, unknown>): AgentToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

function buildSystemPrompt(
  name: string,
  purpose: string,
  toolNames: readonly string[],
): string {
  const toolList = toolNames.join(', ')
  return [
    'Du bist ' + name + ', ein spezialisierter Sub-Agent.',
    '',
    '## Aufgabe',
    purpose,
    '',
    '## Tools',
    toolList,
    '',
    '## Regeln',
    '- Nutze NUR die oben genannten Tools.',
    '- Antworte strukturiert und auf den Punkt.',
    '- Bei Unsicherheit: sage was du nicht weisst, statt zu raten.',
  ].join('\n')
}

function deriveRiskProfile(toolNames: readonly string[]): RiskProfile {
  let maxTier: RiskTier = 0

  for (const toolName of toolNames) {
    const toolDef = getTool(toolName)
    const tier = getToolRiskTier(toolName, {}, toolDef)
    if (tier > maxTier) {
      maxTier = tier as RiskTier
    }
  }

  return maxTier <= 1 ? 'read-only' : 'write-with-approval'
}

// ---------------------------------------------------------------------------
// JSONSchema
// ---------------------------------------------------------------------------

const PARAMETERS: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name for the new agent (1-50 characters).',
    },
    purpose: {
      type: 'string',
      description: 'What the agent should do — this becomes the core of its system prompt.',
    },
    tools: {
      type: 'array',
      description: 'List of tool names the agent may use.',
      items: { type: 'string' },
    },
    schedule: {
      type: 'string',
      description:
        'Optional 5-field cron expression (min hour dom month dow). Minimum interval: 15 minutes. Omit or null for no schedule.',
    },
    model: {
      type: 'string',
      description: 'LLM model tier: "haiku" (fast, cheap) or "sonnet" (smarter, slower).',
      enum: ['haiku', 'sonnet'],
    },
  },
  required: ['name', 'purpose', 'tools', 'model'],
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createAgentFactoryTool(userId: string, pool: DbPool): ExtendedAgentTool {
  return {
    name: 'create-agent',
    description:
      'Create a new sub-agent with specific tools, model, and optional schedule. ' +
      'The agent can later be invoked via the delegate tool.',
    parameters: PARAMETERS,
    permissions: [],
    requiresConfirmation: true,
    runsOn: 'server',
    defaultRiskTier: 2,

    async execute(args: unknown): Promise<AgentToolResult> {
      // 1. Parse & validate arguments
      let parsed: AgentFactoryArgs
      try {
        parsed = parseArgs(args)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return textResult({ status: 'error', error: msg })
      }

      try {
        // 2. Duplicate name check among active agents
        const active = await getActiveAgents(pool, userId)
        const lowerName = parsed.name.toLowerCase()
        const duplicate = active.some(
          (agent) => agent.name.toLowerCase() === lowerName,
        )
        if (duplicate) {
          return textResult({
            status: 'error',
            error: 'An active agent with name "' + parsed.name + '" already exists.',
          })
        }

        // 3. Validate each tool exists in the registry
        for (const toolName of parsed.tools) {
          if (!getTool(toolName)) {
            return textResult({
              status: 'error',
              error: 'Unknown tool: "' + toolName + '".',
            })
          }
        }

        // 4. Validate cron schedule
        if (parsed.schedule !== null) {
          if (!isValidCron(parsed.schedule)) {
            return textResult({
              status: 'error',
              error: 'Invalid cron expression. Must be 5 fields: minute hour day-of-month month day-of-week.',
            })
          }
          if (isCronTooFrequent(parsed.schedule)) {
            return textResult({
              status: 'error',
              error:
                'Schedule too frequent. Minimum interval is ' +
                String(MIN_CRON_INTERVAL_MINUTES) +
                ' minutes.',
            })
          }
        }

        // 5. Derive risk profile from assigned tools
        const riskProfile = deriveRiskProfile(parsed.tools)

        // 6. Build system prompt
        const systemPrompt = buildSystemPrompt(parsed.name, parsed.purpose, parsed.tools)

        // 7. Build CreateAgentInput
        const input: CreateAgentInput = {
          name: parsed.name,
          description: parsed.purpose,
          systemPrompt,
          tools: parsed.tools,
          model: parsed.model,
          riskProfile,
          maxSteps: parsed.model === 'sonnet' ? 10 : 5,
          maxTokens: 4096,
          timeoutMs: 30_000,
          cronSchedule: parsed.schedule,
        }

        // 8. Create agent via registry
        const agent = await createAgent(pool, userId, input)

        // 9. Return confirmation
        return textResult({
          status: 'success',
          agent: {
            id: agent.id,
            name: agent.name,
            model: agent.model,
            tools: agent.tools,
            riskProfile: agent.riskProfile,
            maxSteps: agent.maxSteps,
            schedule: agent.cronSchedule,
            trustLevel: agent.trustLevel,
          },
        })
      } catch {
        // Sanitized error — no internal details leaked
        return textResult({
          status: 'error',
          error: 'Agent creation failed due to an internal error.',
        })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createAgentFactoryTool, parseArgs, isValidCron, isCronTooFrequent }
