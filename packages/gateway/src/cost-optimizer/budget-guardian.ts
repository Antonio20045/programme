// ---------------------------------------------------------------------------
// Budget Guardian — last line of defence against uncontrolled costs
// ---------------------------------------------------------------------------

import type { Pool } from "pg";

import { getPool } from "../database/index.js";
import type {
  BudgetConfig,
  BudgetStatus,
  RunawayPattern,
  TokenUsageEntry,
} from "./types.js";
import { MODEL_PRICING } from "./types.js";

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  dailyLimitUsd: 1.0,
  monthlyLimitUsd: 10.0,
  warningThreshold: 0.75,
  rateLimits: {
    apiCooldownMs: 5_000,
    maxConcurrent: 3,
    webSearchCooldownMs: 10_000,
    webSearchBatchSize: 5,
    webSearchBatchPauseMs: 120_000,
  },
};

// ---------------------------------------------------------------------------
// Per-user in-memory rate state
// ---------------------------------------------------------------------------

interface UserRateState {
  lastApiCall: number;
  lastWebSearch: number;
  webSearchBatch: { count: number; windowStart: number };
  concurrentCalls: number;
  retries429: number;
  lastActive: number;
}

// ---------------------------------------------------------------------------
// Runaway detection patterns
// ---------------------------------------------------------------------------

const RUNAWAY_PATTERNS: readonly RunawayPattern[] = [
  {
    name: "same-tool-loop",
    description: "Same tool called 5+ times in 60s",
    detect(history: TokenUsageEntry[]): boolean {
      const now = Date.now();
      const recent = history.filter(
        (e) => e.toolName && now - e.timestamp < 60_000,
      );
      const counts = new Map<string, number>();
      for (const e of recent) {
        const key = e.toolName!;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const count of counts.values()) {
        if (count >= 5) return true;
      }
      return false;
    },
  },
  {
    name: "repeated-error",
    description: "Same tool errored 3+ times",
    detect(history: TokenUsageEntry[]): boolean {
      const errors = history.filter((e) => e.error && e.toolName);
      const counts = new Map<string, number>();
      for (const e of errors) {
        const key = e.toolName!;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const count of counts.values()) {
        if (count >= 3) return true;
      }
      return false;
    },
  },
  {
    name: "escalation-pingpong",
    description: "Tier changed 4+ times in last 10 entries",
    detect(history: TokenUsageEntry[]): boolean {
      const last10 = history.slice(-10);
      if (last10.length < 4) return false;
      let changes = 0;
      for (let i = 1; i < last10.length; i++) {
        if (last10[i]!.tier !== last10[i - 1]!.tier) changes++;
      }
      return changes >= 4;
    },
  },
  {
    name: "token-spike",
    description: "Last entry > 10x average of previous 10",
    detect(history: TokenUsageEntry[]): boolean {
      if (history.length < 2) return false;
      const last = history[history.length - 1]!;
      const previous = history.slice(-11, -1);
      if (previous.length === 0) return false;
      const avgTokens =
        previous.reduce(
          (sum, e) => sum + e.inputTokens + e.outputTokens,
          0,
        ) / previous.length;
      if (avgTokens === 0) return false;
      const lastTokens = last.inputTokens + last.outputTokens;
      return lastTokens > avgTokens * 10;
    },
  },
] as const;

// ---------------------------------------------------------------------------
// BudgetGuardian class
// ---------------------------------------------------------------------------

export class BudgetGuardian {
  private readonly pool: Pool;
  private readonly config: BudgetConfig;

  // Per-user rate limiting (in-memory)
  private readonly rateStates = new Map<string, UserRateState>();
  private static readonly IDLE_CLEANUP_MS = 10 * 60 * 1000; // 10 min

  // 429 handling
  private static readonly MAX_429_RETRIES = 2;
  private static readonly WAIT_429_MS = 300_000; // 5 min

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    if (config?.rateLimits) {
      this.config.rateLimits = {
        ...DEFAULT_BUDGET_CONFIG.rateLimits,
        ...config.rateLimits,
      };
    }
    this.pool = getPool();
  }

  // -------------------------------------------------------------------------
  // Per-user rate state management
  // -------------------------------------------------------------------------

  private getRateState(userId: string): UserRateState {
    let state = this.rateStates.get(userId);
    if (!state) {
      state = {
        lastApiCall: 0,
        lastWebSearch: 0,
        webSearchBatch: { count: 0, windowStart: 0 },
        concurrentCalls: 0,
        retries429: 0,
        lastActive: Date.now(),
      };
      this.rateStates.set(userId, state);
    }
    state.lastActive = Date.now();
    this.cleanupIdleStates();
    return state;
  }

  private cleanupIdleStates(): void {
    const now = Date.now();
    for (const [key, s] of this.rateStates) {
      if (now - s.lastActive > BudgetGuardian.IDLE_CLEANUP_MS) {
        this.rateStates.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Budget checking
  // -------------------------------------------------------------------------

  async checkBudget(userId: string): Promise<BudgetStatus> {
    // Load user-specific limits (if any)
    let dailyLimitUsd = this.config.dailyLimitUsd;
    let monthlyLimitUsd = this.config.monthlyLimitUsd;
    let warningThreshold = this.config.warningThreshold;

    const limitsResult = await this.pool.query<{
      daily_limit_usd: string;
      monthly_limit_usd: string;
      warning_threshold: string;
    }>(
      "SELECT daily_limit_usd, monthly_limit_usd, warning_threshold FROM user_budget_limits WHERE user_id = $1",
      [userId],
    );
    if (limitsResult.rows[0]) {
      dailyLimitUsd = Number(limitsResult.rows[0].daily_limit_usd);
      monthlyLimitUsd = Number(limitsResult.rows[0].monthly_limit_usd);
      warningThreshold = Number(limitsResult.rows[0].warning_threshold);
    }

    const daily = await this.getDailySpend(userId);
    const monthly = await this.getMonthlySpend(userId);

    const dailyRatio = daily / dailyLimitUsd;
    const monthlyRatio = monthly / monthlyLimitUsd;

    const isMonthlyBlocked = monthlyRatio >= 1;
    const isDailyExhausted = dailyRatio >= 1;
    const isDailyWarning = dailyRatio >= warningThreshold;
    const isMonthlyWarning = monthlyRatio >= warningThreshold;

    let warningMessage: string | undefined;
    if (isMonthlyBlocked) {
      warningMessage =
        "Monthly budget exhausted. Only local Ollama models available.";
    } else if (isDailyExhausted) {
      warningMessage =
        "Daily budget exhausted. Downgraded to cheapest model.";
    } else if (isDailyWarning || isMonthlyWarning) {
      warningMessage = `Budget warning: Daily ${(dailyRatio * 100).toFixed(0)}% / Monthly ${(monthlyRatio * 100).toFixed(0)}%`;
    }

    return {
      dailySpendUsd: daily,
      monthlySpendUsd: monthly,
      dailyLimitUsd,
      monthlyLimitUsd,
      isWarning: isDailyWarning || isMonthlyWarning,
      downgraded: isDailyExhausted && !isMonthlyBlocked,
      isBlocked: isMonthlyBlocked,
      warningMessage,
    };
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  async logUsage(userId: string, entry: TokenUsageEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO token_usage (user_id, session_id, model, tier, input_tokens, output_tokens, cached_tokens, cost_usd, tool_name, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        entry.sessionId,
        entry.model,
        entry.tier,
        entry.inputTokens,
        entry.outputTokens,
        entry.cachedTokens,
        entry.costUsd,
        entry.toolName ?? null,
        entry.error ?? false,
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Spend queries
  // -------------------------------------------------------------------------

  async getDailySpend(userId: string): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE user_id = $1 AND created_at >= CURRENT_DATE",
      [userId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async getMonthlySpend(userId: string): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE user_id = $1
       AND date_trunc('month', created_at) = date_trunc('month', NOW())`,
      [userId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  // -------------------------------------------------------------------------
  // Cost calculation
  // -------------------------------------------------------------------------

  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
  ): number {
    const pricing = MODEL_PRICING[model]; // eslint-disable-line security/detect-object-injection
    if (!pricing) return 0;
    return (
      (inputTokens * pricing.inputPer1MTokens +
        outputTokens * pricing.outputPer1MTokens +
        cachedTokens * pricing.cachedPer1MTokens) /
      1_000_000
    );
  }

  // -------------------------------------------------------------------------
  // Rate limiting (in-memory, per-user)
  // -------------------------------------------------------------------------

  checkRateLimit(
    userId: string,
    type: "api" | "web-search",
  ): {
    allowed: boolean;
    waitMs?: number;
  } {
    const now = Date.now();
    const { rateLimits } = this.config;
    const state = this.getRateState(userId);

    if (type === "api") {
      const elapsed = now - state.lastApiCall;
      if (elapsed < rateLimits.apiCooldownMs) {
        return {
          allowed: false,
          waitMs: rateLimits.apiCooldownMs - elapsed,
        };
      }
      if (state.concurrentCalls >= rateLimits.maxConcurrent) {
        return { allowed: false, waitMs: rateLimits.apiCooldownMs };
      }
      return { allowed: true };
    }

    // web-search
    const elapsed = now - state.lastWebSearch;
    if (elapsed < rateLimits.webSearchCooldownMs) {
      return {
        allowed: false,
        waitMs: rateLimits.webSearchCooldownMs - elapsed,
      };
    }

    // Batch tracking
    const batchWindowExpired =
      now - state.webSearchBatch.windowStart > rateLimits.webSearchBatchPauseMs;
    if (batchWindowExpired) {
      state.webSearchBatch = { count: 0, windowStart: now };
    }
    if (state.webSearchBatch.count >= rateLimits.webSearchBatchSize) {
      const waitMs =
        rateLimits.webSearchBatchPauseMs -
        (now - state.webSearchBatch.windowStart);
      return { allowed: false, waitMs: Math.max(0, waitMs) };
    }

    return { allowed: true };
  }

  /** Call after a successful API request to update rate-limit state. */
  recordApiCall(userId: string): void {
    const state = this.getRateState(userId);
    state.lastApiCall = Date.now();
  }

  /** Call after a successful web-search to update rate-limit state. */
  recordWebSearch(userId: string): void {
    const now = Date.now();
    const state = this.getRateState(userId);
    state.lastWebSearch = now;
    if (state.webSearchBatch.windowStart === 0) {
      state.webSearchBatch.windowStart = now;
    }
    state.webSearchBatch.count++;
  }

  /** Increment concurrent call counter. Call release when done. */
  acquireConcurrent(userId: string): boolean {
    const state = this.getRateState(userId);
    if (state.concurrentCalls >= this.config.rateLimits.maxConcurrent)
      return false;
    state.concurrentCalls++;
    return true;
  }

  /** Decrement concurrent call counter. */
  releaseConcurrent(userId: string): void {
    const state = this.getRateState(userId);
    state.concurrentCalls = Math.max(0, state.concurrentCalls - 1);
  }

  /** Handle a 429 response. Returns waitMs or undefined if max retries reached. */
  on429(userId: string): { waitMs: number } | undefined {
    const state = this.getRateState(userId);
    state.retries429++;
    if (state.retries429 > BudgetGuardian.MAX_429_RETRIES) return undefined;
    return { waitMs: BudgetGuardian.WAIT_429_MS };
  }

  /** Reset 429 counter (call after a successful request). */
  reset429(userId: string): void {
    const state = this.getRateState(userId);
    state.retries429 = 0;
  }

  // -------------------------------------------------------------------------
  // Runaway detection
  // -------------------------------------------------------------------------

  async detectRunaway(userId: string): Promise<{
    detected: boolean;
    pattern?: string;
    description?: string;
  }> {
    const result = await this.pool.query<{
      sessionId: string;
      model: string;
      tier: string;
      inputTokens: string;
      outputTokens: string;
      cachedTokens: string;
      costUsd: string;
      toolName: string | null;
      error: boolean;
      timestamp: string;
    }>(
      `SELECT session_id as "sessionId", model, tier,
              input_tokens as "inputTokens", output_tokens as "outputTokens",
              cached_tokens as "cachedTokens", cost_usd as "costUsd",
              tool_name as "toolName", error,
              EXTRACT(EPOCH FROM created_at) * 1000 as timestamp
       FROM token_usage WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId],
    );

    const history: TokenUsageEntry[] = result.rows.map((row) => ({
      sessionId: row.sessionId,
      model: row.model,
      tier: row.tier as TokenUsageEntry["tier"],
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      cachedTokens: Number(row.cachedTokens),
      costUsd: Number(row.costUsd),
      toolName: row.toolName ?? undefined,
      error: row.error,
      timestamp: Number(row.timestamp),
    }));

    for (const p of RUNAWAY_PATTERNS) {
      if (p.detect(history)) {
        return { detected: true, pattern: p.name, description: p.description };
      }
    }
    return { detected: false };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    this.rateStates.clear();
    // Pool is NOT closed — shared singleton
  }
}
