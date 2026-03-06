// ---------------------------------------------------------------------------
// Model Router — pattern-based complexity classification (no LLM call)
// ---------------------------------------------------------------------------

import type {
  ComplexityResult,
  ComplexityTier,
  EscalationTrigger,
  ModelRouterConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Pattern sets (module-level constants — no dynamic RegExp construction)
// ---------------------------------------------------------------------------

const COMPLEX_PATTERNS: readonly RegExp[] = [
  /\b(?:architect|security|vulnerabilit|pentest|exploit)/i,
  /security.review|security.audit|complex.debug|multi.file.refactor/i,
  /production.deploy|system.design|performance.bottleneck/i,
  /penetration.test|threat.model|code.review/i,
  /refactor.*entire|redesign|migrate.*database|schema.migration/i,
];

const ROUTINE_PATTERNS: readonly RegExp[] = [
  /\b(read|cat|ls|list|show|get|status|check)\b/i,
  /\b(format|what.time|reminder|calendar.today|weather|greet)\b/i,
  /\b(hello|hi|hey|danke|thanks|guten.morgen)\b/i,
  /\b(set.reminder|add.note|show.notes|check.calendar)\b/i,
];

const COMPLEX_TOOL_PATTERNS: readonly RegExp[] = [
  /\b(sudo|rm\s+-rf|chmod|chown)\b/i,
  /\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i,
];

const COMPLEX_TOOLS = new Set(["shell", "code-runner"]);
const ROUTINE_TOOLS = new Set([
  "calendar",
  "reminders",
  "notes",
  "weather",
  "datetime",
  "calculator",
]);

const USER_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\buse\s+(claude\s+)?opus\b/i,
  /\bnutze\s+opus\b/i,
  /\bswitch\s+to\s+opus\b/i,
  /\bopus\s+mode\b/i,
];

// Security/architecture keywords that should never be downgraded
const NEVER_DOWNGRADE_PATTERNS: readonly RegExp[] = [
  /security|vulnerability|exploit|pentest|architect/i,
];

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  tier: ComplexityTier;
  timestamp: number;
}

class LRUCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      // Evict oldest (first entry)
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    this.map.set(key, entry);
  }
}

// ---------------------------------------------------------------------------
// ModelRouter class
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ModelRouterConfig = {
  models: {
    routine: "claude-haiku-4-5-20251001",
    moderate: "claude-sonnet-4-6-20250514",
    complex: "claude-opus-4-6-20250610",
  },
  maxEscalations: 1,
  cacheTtlMs: 3_600_000,
  cacheMaxEntries: 1000,
};

export class ModelRouter {
  private readonly config: ModelRouterConfig;
  private readonly cache: LRUCache;
  private readonly escalationCount = new Map<string, number>();

  constructor(config?: Partial<ModelRouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.models) {
      this.config.models = { ...DEFAULT_CONFIG.models, ...config.models };
    }
    this.cache = new LRUCache(
      this.config.cacheMaxEntries,
      this.config.cacheTtlMs,
    );
  }

  // -----------------------------------------------------------------------
  // Complexity classification
  // -----------------------------------------------------------------------

  classifyComplexity(message: string, tools?: string[]): ComplexityResult {
    // 1. Check user override
    for (const pattern of USER_OVERRIDE_PATTERNS) {
      if (pattern.test(message)) {
        return {
          tier: "COMPLEX",
          confidence: 1.0,
          reason: "User requested Opus override",
          model: this.config.models.complex,
          overrideDetected: true,
        };
      }
    }

    // 2. Score patterns
    let complexScore = 0;
    let routineScore = 0;
    const reasons: string[] = [];

    for (const pattern of COMPLEX_PATTERNS) {
      if (pattern.test(message)) {
        complexScore += 2;
        reasons.push(`complex-pattern: ${pattern.source.slice(0, 30)}`);
      }
    }

    for (const pattern of ROUTINE_PATTERNS) {
      if (pattern.test(message)) {
        routineScore += 2;
        reasons.push(`routine-pattern: ${pattern.source.slice(0, 30)}`);
      }
    }

    // 3. Tool-based adjustment
    if (tools) {
      for (const tool of tools) {
        if (COMPLEX_TOOLS.has(tool)) {
          // Check message for dangerous patterns
          for (const tp of COMPLEX_TOOL_PATTERNS) {
            if (tp.test(message)) {
              complexScore += 2;
              reasons.push(`complex-tool: ${tool} with dangerous command`);
            }
          }
          complexScore += 1;
        }
        if (ROUTINE_TOOLS.has(tool)) {
          routineScore += 2;
          reasons.push(`routine-tool: ${tool}`);
        }
      }
    }

    // 4. Message length heuristic (only when there's already a pattern signal)
    const hasSignal = complexScore > 0 || routineScore > 0;
    if (hasSignal) {
      if (message.length > 500) {
        complexScore += 1;
        reasons.push("long-message");
      } else if (message.length < 50) {
        routineScore += 1;
        reasons.push("short-message");
      }
    }

    // 5. Determine tier
    let tier: ComplexityTier;
    if (complexScore > routineScore) {
      tier = "COMPLEX";
    } else if (routineScore > complexScore) {
      tier = "ROUTINE";
    } else {
      tier = "MODERATE";
    }

    // 6. Empty message defaults to MODERATE
    if (message.trim().length === 0) {
      tier = "MODERATE";
    }

    // 7. Confidence
    const winner = Math.max(complexScore, routineScore);
    const loser = Math.min(complexScore, routineScore);
    const rawConfidence = (winner - loser) / (winner + loser + 1);
    const confidence = Math.max(0.3, Math.min(1.0, rawConfidence));

    const reason =
      reasons.length > 0 ? reasons.join(", ") : `default: ${tier}`;

    return {
      tier,
      confidence,
      reason,
      model: this.getModelForTier(tier),
      overrideDetected: false,
    };
  }

  // -----------------------------------------------------------------------
  // Model resolution
  // -----------------------------------------------------------------------

  getModelForTier(tier: ComplexityTier): string {
    switch (tier) {
      case "ROUTINE":
        return this.config.models.routine;
      case "MODERATE":
        return this.config.models.moderate;
      case "COMPLEX":
        return this.config.models.complex;
    }
  }

  // -----------------------------------------------------------------------
  // Escalation
  // -----------------------------------------------------------------------

  shouldEscalate(
    trigger: EscalationTrigger,
    currentTier: ComplexityTier,
    sessionId: string,
  ): { escalate: boolean; newTier?: ComplexityTier; newModel?: string } {
    // user_override always escalates to COMPLEX
    if (trigger === "user_override") {
      return {
        escalate: true,
        newTier: "COMPLEX",
        newModel: this.config.models.complex,
      };
    }

    // COMPLEX has no further escalation
    if (currentTier === "COMPLEX") {
      return { escalate: false };
    }

    // Check escalation count
    const key = `${sessionId}:${currentTier}`;
    const count = this.escalationCount.get(key) ?? 0;
    if (count >= this.config.maxEscalations) {
      return { escalate: false };
    }

    // Check cached escalation
    const cached = this.cache.get(key);
    if (cached && cached.tier === currentTier) {
      return { escalate: false };
    }

    // Determine new tier
    const newTier: ComplexityTier =
      currentTier === "ROUTINE" ? "MODERATE" : "COMPLEX";

    // Record escalation
    this.escalationCount.set(key, count + 1);
    this.cache.set(key, { tier: newTier, timestamp: Date.now() });

    return {
      escalate: true,
      newTier,
      newModel: this.getModelForTier(newTier),
    };
  }

  /**
   * Check if a tier should be prevented from downgrading.
   * Security and architecture tasks are never downgraded.
   */
  shouldPreventDowngrade(message: string): boolean {
    return NEVER_DOWNGRADE_PATTERNS.some((p) => p.test(message));
  }
}
