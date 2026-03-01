/**
 * Tier resolution for tool actions.
 *
 * Resolution order:
 * 1. User override (~/.openclaw/overrides.json)
 * 2. Tool-defined riskTiers[action]
 * 3. Tool-defined defaultRiskTier
 * 4. Global default (2 = preview + approve)
 *
 * No external dependencies. No eval.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { ExtendedAgentTool, RiskTier } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_DEFAULT_TIER: RiskTier = 2
const OVERRIDES_PATH = path.join(os.homedir(), '.openclaw', 'tier-overrides.json')

// ---------------------------------------------------------------------------
// User overrides
// ---------------------------------------------------------------------------

interface UserOverrides {
  readonly tools?: Readonly<Record<string, {
    readonly default?: RiskTier
    readonly actions?: Readonly<Record<string, RiskTier>>
  } | RiskTier>>
}

let cachedOverrides: UserOverrides | null = null
let overridesLoadedAt = 0
const CACHE_TTL_MS = 60_000 // Re-read file at most once per minute

function loadUserOverrides(): UserOverrides {
  const now = Date.now()
  if (cachedOverrides !== null && now - overridesLoadedAt < CACHE_TTL_MS) {
    return cachedOverrides
  }

  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as UserOverrides
    cachedOverrides = parsed
    overridesLoadedAt = now
    return parsed
  } catch {
    cachedOverrides = {}
    overridesLoadedAt = now
    return {}
  }
}

// ---------------------------------------------------------------------------
// Tier validation
// ---------------------------------------------------------------------------

function isValidTier(value: unknown): value is RiskTier {
  return typeof value === 'number' && [0, 1, 2, 3, 4].includes(value)
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the risk tier for a specific tool action.
 *
 * @param tool - The tool definition (with optional riskTiers/defaultRiskTier)
 * @param action - The action name being executed (e.g. 'readInbox', 'sendEmail')
 * @returns The resolved risk tier (0-4)
 */
export function resolveRiskTier(tool: ExtendedAgentTool, action: string): RiskTier {
  // 1. Check user overrides
  const overrides = loadUserOverrides()
  if (overrides.tools) {
    const toolOverride = overrides.tools[tool.name]
    if (toolOverride !== undefined) {
      if (isValidTier(toolOverride)) {
        return toolOverride
      }
      if (typeof toolOverride === 'object') {
        const actionTier = toolOverride.actions?.[action]
        if (isValidTier(actionTier)) {
          return actionTier
        }
        if (isValidTier(toolOverride.default)) {
          return toolOverride.default
        }
      }
    }
  }

  // 2. Check tool-defined riskTiers
  if (tool.riskTiers) {
    const tier = tool.riskTiers[action]
    if (isValidTier(tier)) {
      return tier
    }
  }

  // 3. Check tool-defined defaultRiskTier
  if (isValidTier(tool.defaultRiskTier)) {
    return tool.defaultRiskTier
  }

  // 4. Global default
  return GLOBAL_DEFAULT_TIER
}

/**
 * Check if a tool action requires user confirmation based on its risk tier.
 * Tiers 0-1 auto-execute; tiers 2-4 require confirmation.
 */
export function requiresConfirmationForTier(tier: RiskTier): boolean {
  return tier >= 2
}

/** Reset cached overrides (for testing). */
export function _resetOverridesCache(): void {
  cachedOverrides = null
  overridesLoadedAt = 0
}

export { GLOBAL_DEFAULT_TIER }
