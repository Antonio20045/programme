// ---------------------------------------------------------------------------
// Cost Optimizer — Shared Types
// ---------------------------------------------------------------------------

/** Complexity classification for incoming messages. */
export type ComplexityTier = "ROUTINE" | "MODERATE" | "COMPLEX";

/** Result of a complexity classification. */
export interface ComplexityResult {
  tier: ComplexityTier;
  confidence: number; // 0.3 – 1.0
  reason: string;
  model: string;
  overrideDetected: boolean;
}

/** Trigger that can cause model escalation. */
export type EscalationTrigger =
  | "tool_error"
  | "incoherent_response"
  | "timeout"
  | "user_override";

/** Configuration for the model router. */
export interface ModelRouterConfig {
  models: {
    routine: string; // e.g. "claude-haiku-4-5-20251001"
    moderate: string; // e.g. "claude-sonnet-4-6-20250514"
    complex: string; // e.g. "claude-opus-4-6-20250610"
  };
  /** Max escalation retries per session (default 1). */
  maxEscalations: number;
  /** LRU cache TTL in ms (default 3_600_000 = 1h). */
  cacheTtlMs: number;
  /** LRU cache max entries (default 1000). */
  cacheMaxEntries: number;
}

// ---------------------------------------------------------------------------
// Budget Guardian
// ---------------------------------------------------------------------------

export interface RateLimits {
  /** Minimum ms between API calls (default 5000). */
  apiCooldownMs: number;
  /** Max concurrent API calls (default 3). */
  maxConcurrent: number;
  /** Minimum ms between web-search calls (default 10000). */
  webSearchCooldownMs: number;
  /** Web-search batch size before forced pause (default 5). */
  webSearchBatchSize: number;
  /** Forced pause after batch in ms (default 120000). */
  webSearchBatchPauseMs: number;
}

export interface BudgetConfig {
  /** Daily budget in USD (default 1.00). */
  dailyLimitUsd: number;
  /** Monthly budget in USD (default 10.00). */
  monthlyLimitUsd: number;
  /** Warning threshold as fraction (default 0.75). */
  warningThreshold: number;
  /** Rate limit settings. */
  rateLimits: RateLimits;
}

/** A pattern that detects runaway behaviour. */
export interface RunawayPattern {
  name: string;
  description: string;
  detect: (history: TokenUsageEntry[]) => boolean;
}

/** Single token usage log entry. */
export interface TokenUsageEntry {
  timestamp: number; // Unix epoch ms
  sessionId: string;
  model: string;
  tier: ComplexityTier;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  toolName?: string;
  error?: boolean;
}

/** Current budget status returned by checkBudget(). */
export interface BudgetStatus {
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  /** True when spend >= warningThreshold * limit. */
  isWarning: boolean;
  /** True when daily limit reached — downgrade to cheapest model. */
  downgraded: boolean;
  /** True when monthly limit reached — block all cloud calls. */
  isBlocked: boolean;
  warningMessage?: string;
}

// ---------------------------------------------------------------------------
// Session Optimizer (Session 2)
// ---------------------------------------------------------------------------

export interface SessionInitConfig {
  /** System prompt to inject at session start. */
  systemPrompt?: string;
  /** Max tokens for first message summary. */
  maxFirstMessageTokens: number;
}

// ---------------------------------------------------------------------------
// Cache Manager (Session 2)
// ---------------------------------------------------------------------------

export interface CacheConfig {
  /** Enable response caching (default true). */
  enabled: boolean;
  /** Max cache entries (default 500). */
  maxEntries: number;
  /** Cache TTL in ms (default 3_600_000 = 1h). */
  ttlMs: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  savedTokens: number;
  savedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Heartbeat Router (Session 2)
// ---------------------------------------------------------------------------

export interface HeartbeatConfig {
  /** Interval in ms to check Ollama availability (default 30_000). */
  intervalMs: number;
  /** Ollama endpoint (default "http://127.0.0.1:11434"). */
  ollamaUrl: string;
  /** Models to check for local availability. */
  preferredLocalModels: string[];
}

export interface OllamaDetectionResult {
  available: boolean;
  models: string[];
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Top-Level Config
// ---------------------------------------------------------------------------

/** Combined configuration for the entire cost optimizer. */
export interface CostOptimizerConfig {
  budget: BudgetConfig;
  router: ModelRouterConfig;
  session: SessionInitConfig;
  cache: CacheConfig;
  heartbeat: HeartbeatConfig;
}

// ---------------------------------------------------------------------------
// Model Pricing
// ---------------------------------------------------------------------------

/** Per-model pricing in USD per 1M tokens. */
export interface ModelPricing {
  inputPer1MTokens: number;
  outputPer1MTokens: number;
  cachedPer1MTokens: number;
}

/**
 * Pricing data for supported models.
 * Shape is intentionally different from `ModelCostConfig` in usage-format.ts
 * (our naming is more explicit). Conversion happens at integration (Session 3).
 */
/**
 * Supported providers — security-vetted:
 * - Anthropic (US): Haiku, Sonnet, Opus — alle Tiers
 * - Ollama (lokal): Heartbeats only, zero cost
 *
 * Bewusst NICHT unterstützt:
 * - DeepSeek (China) — Datenabfluss-Risiko
 * - OpenRouter — unnötiger Middleman, direkt zu Anthropic ist sicherer
 * - OpenAI — nicht benötigt, Anthropic deckt alle Tiers ab
 * - Google (Gemini) — nicht benötigt
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Anthropic
  "claude-opus-4-6-20250610": {
    inputPer1MTokens: 15.0,
    outputPer1MTokens: 75.0,
    cachedPer1MTokens: 1.5,
  },
  "claude-sonnet-4-6-20250514": {
    inputPer1MTokens: 3.0,
    outputPer1MTokens: 15.0,
    cachedPer1MTokens: 0.3,
  },
  "claude-haiku-4-5-20251001": {
    inputPer1MTokens: 0.25,
    outputPer1MTokens: 1.25,
    cachedPer1MTokens: 0.025,
  },
  // Local (free)
  "ollama/any": {
    inputPer1MTokens: 0,
    outputPer1MTokens: 0,
    cachedPer1MTokens: 0,
  },
} as const;

// ---------------------------------------------------------------------------
// Context Thresholds (Session Optimizer)
// ---------------------------------------------------------------------------

export interface ContextThreshold {
  fraction: number; // 0.0–1.0
  label: string;
  action:
    | "flush_memory"
    | "compact_old"
    | "force_compact"
    | "emergency_compact";
}

export type ContextThresholds = readonly ContextThreshold[];

// ---------------------------------------------------------------------------
// Session Data
// ---------------------------------------------------------------------------

export interface SessionInitFile {
  name: string;
  content: string;
  sizeBytes: number;
}

export interface SessionInitResult {
  files: SessionInitFile[];
  totalSizeBytes: number;
  warnings: string[];
}

export interface MemorySnippet {
  source: string;
  content: string;
  sizeBytes: number;
}

export interface DailyMemoryEntry {
  date: string; // YYYY-MM-DD
  sessionId: string;
  topics: string[];
  decisions: string[];
  blockers: string[];
  nextSteps: string[];
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Content Block (Cache Manager — Anthropic Messages API Format)
// ---------------------------------------------------------------------------

export interface ContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

// ---------------------------------------------------------------------------
// Heartbeat Result
// ---------------------------------------------------------------------------

export interface HeartbeatRouteResult {
  routed: boolean;
  model: string;
  provider: "ollama" | "cloud";
  latencyMs: number;
  fallback: boolean;
}

// ---------------------------------------------------------------------------
// Middleware Pipeline (Session 3)
// ---------------------------------------------------------------------------

export interface PreRequestResult {
  allowed: boolean;
  blockedReason?: string;
  model: string;
  tier: ComplexityTier;
  isHeartbeat: boolean;
  /** Advisory: Context files from SessionOptimizer (names + sizes). */
  contextSummary?: { files: number; totalSizeBytes: number };
  /** Advisory: Cache header count. */
  cacheHeaderCount?: number;
}

export interface PostRequestResult {
  shouldEscalate: boolean;
  escalatedModel?: string;
  usage: TokenUsageEntry;
}

export interface CostOptimizerMiddlewareConfig {
  /** Enable the entire cost optimizer (default true). */
  enabled: boolean;
  /** Budget config overrides. */
  budget?: Partial<BudgetConfig>;
  /** Model router config overrides. */
  router?: Partial<ModelRouterConfig>;
  /** Heartbeat config overrides. */
  heartbeat?: Partial<HeartbeatConfig>;
  /** Cache config overrides. */
  cache?: Partial<CacheConfig>;
  /** Session optimizer config overrides. */
  session?: Partial<SessionInitConfig>;
  /** Workspace directory for SessionOptimizer. */
  workspaceDir?: string;
}
