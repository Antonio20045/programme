/**
 * Gemini-First Model Routing — reusable resolver for in-app.ts and agent executor.
 *
 * Default: Google Gemini 2.5 Flash Lite for all requests.
 * Fallback: Anthropic Claude (tier-matched) on Gemini errors.
 * Opus override: direct Anthropic Claude Opus (no Gemini attempt).
 *
 * Constants mirrored from packages/gateway/config.ts — keep in sync.
 */

// ---------------------------------------------------------------------------
// Mirrored constants (source: packages/gateway/config.ts)
// ---------------------------------------------------------------------------

const GEMINI_PROVIDER = "google" as const
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite" as const

const ANTHROPIC_FALLBACK: Readonly<Record<string, string>> = {
  "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4-5",
  "claude-opus-4-6": "anthropic/claude-opus-4-6",
}

const OPUS_MODEL_ID = "claude-opus-4-6" as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnthropicTier = "claude-haiku-4-5" | "claude-sonnet-4-5" | "claude-opus-4-6"

type AgentModelShortName = "haiku" | "sonnet" | "opus"

interface ResolvedModel {
  readonly provider: "google" | "anthropic"
  readonly model: string
  readonly fallbackModel: string | undefined
}

// ---------------------------------------------------------------------------
// Short-name → full tier mapping
// ---------------------------------------------------------------------------

const AGENT_MODEL_MAP: Readonly<Record<string, AnthropicTier>> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-6",
}

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

/**
 * Resolve an Anthropic tier string to provider/model/fallback.
 *
 * Mirrors the inline logic from in-app.ts (lines 908–912):
 * - Opus → direct Anthropic, no fallback
 * - Haiku/Sonnet → Gemini-first, Anthropic fallback
 * - Unknown tier → Gemini-first, no fallback (graceful degradation)
 */
function resolveModel(anthropicTier: string): ResolvedModel {
  if (anthropicTier === OPUS_MODEL_ID) {
    return {
      provider: "anthropic",
      model: OPUS_MODEL_ID,
      fallbackModel: undefined,
    }
  }

  const fallback = ANTHROPIC_FALLBACK[anthropicTier]

  return {
    provider: GEMINI_PROVIDER,
    model: GEMINI_DEFAULT_MODEL,
    fallbackModel: fallback ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// resolveModelForAgent
// ---------------------------------------------------------------------------

/**
 * Resolve a short agent model name ("haiku" | "sonnet" | "opus") to
 * provider/model/fallback via resolveModel().
 *
 * Unknown short names default to haiku tier.
 */
function resolveModelForAgent(agentModel: string): ResolvedModel {
  const tier = AGENT_MODEL_MAP[agentModel]
  return resolveModel(tier ?? AGENT_MODEL_MAP["haiku"]!)
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { resolveModel, resolveModelForAgent }
export type { ResolvedModel, AnthropicTier, AgentModelShortName }
