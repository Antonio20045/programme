// ---------------------------------------------------------------------------
// Cost Optimizer Middleware — orchestrates all 5 modules into a pipeline
// ---------------------------------------------------------------------------

import { BudgetGuardian } from "./budget-guardian.js";
import { CacheManager } from "./cache-manager.js";
import { HeartbeatRouter } from "./heartbeat-router.js";
import {
  logBlocked,
  logHeartbeatRouted,
  logPostRequest,
  logPreRequest,
} from "./logger.js";
import { ModelRouter } from "./model-router.js";
import { SessionOptimizer } from "./session-optimizer.js";
import type {
  ComplexityTier,
  CostOptimizerMiddlewareConfig,
  PostRequestResult,
  PreRequestResult,
  SessionInitResult,
  TokenUsageEntry,
} from "./types.js";

const DEFAULT_CONFIG: CostOptimizerMiddlewareConfig = { enabled: true };

export class CostOptimizerMiddleware {
  private readonly guardian: BudgetGuardian;
  private readonly router: ModelRouter;
  private readonly optimizer: SessionOptimizer;
  private readonly cache: CacheManager;
  private readonly heartbeat: HeartbeatRouter;
  private readonly enabled: boolean;

  constructor(config?: Partial<CostOptimizerMiddlewareConfig>) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.enabled = cfg.enabled;
    this.guardian = new BudgetGuardian(cfg.budget);
    this.router = new ModelRouter(cfg.router);
    this.optimizer = new SessionOptimizer(cfg.session, cfg.workspaceDir);
    this.cache = new CacheManager(cfg.cache);
    this.heartbeat = new HeartbeatRouter(cfg.heartbeat);
  }

  // -------------------------------------------------------------------------
  // Pre-request pipeline
  // -------------------------------------------------------------------------

  /**
   * Run the full pre-request pipeline:
   * 1. Budget check → 2. Rate-limit → 3. Heartbeat detect →
   * 4. Classify complexity → 5. Session context (advisory) →
   * 6. Cache headers (advisory) → 7. Model selection
   */
  async preRequest(
    userId: string,
    message: string,
    tools?: string[],
  ): Promise<PreRequestResult> {
    if (!this.enabled) {
      return {
        allowed: true,
        model: "default",
        tier: "MODERATE",
        isHeartbeat: false,
      };
    }

    // 1. Budget check (async, PostgreSQL)
    const budget = await this.guardian.checkBudget(userId);
    if (budget.isBlocked) {
      const reason =
        budget.warningMessage ?? "Monthly budget exceeded";
      logBlocked(reason);
      return {
        allowed: false,
        blockedReason: reason,
        model: "",
        tier: "ROUTINE",
        isHeartbeat: false,
      };
    }

    // 2. Rate-limit check (< 1ms, in-memory)
    const rateLimit = this.guardian.checkRateLimit(userId, "api");
    if (!rateLimit.allowed) {
      const reason = `Rate limit: wait ${String(rateLimit.waitMs ?? 0)}ms`;
      logBlocked(reason);
      return {
        allowed: false,
        blockedReason: reason,
        model: "",
        tier: "ROUTINE",
        isHeartbeat: false,
      };
    }

    // 3. Heartbeat detection (< 1ms pattern match)
    if (this.heartbeat.isHeartbeatRequest(message)) {
      const hbResult = await this.heartbeat.routeHeartbeat(message);
      logHeartbeatRouted(hbResult.provider, hbResult.model);
      return {
        allowed: true,
        model: hbResult.model,
        tier: "ROUTINE",
        isHeartbeat: true,
      };
    }

    // 4. Classify complexity (< 5ms, regex patterns + LRU cache)
    const classification = this.router.classifyComplexity(message, tools);
    let { tier } = classification;

    // Budget downgrade: force ROUTINE unless security/architecture
    if (budget.downgraded && !this.router.shouldPreventDowngrade(message)) {
      tier = "ROUTINE";
    }

    const model = this.router.getModelForTier(tier);

    // 5. Session context summary (advisory, 10-50ms filesystem)
    let contextSummary: PreRequestResult["contextSummary"];
    try {
      const ctx = await this.optimizer.getSessionInitContext();
      contextSummary = {
        files: ctx.files.length,
        totalSizeBytes: ctx.totalSizeBytes,
      };
    } catch {
      // Non-blocking — context summary is advisory
    }

    // 6. Cache header count (advisory, < 1ms)
    const cacheHeaderCount = this.cache.buildCacheHeaders([
      { name: "SOUL.md", text: "" },
      { name: "USER.md", text: "" },
      { name: "IDENTITY.md", text: "" },
      { name: "system_prompt", text: "" },
      { name: "tool_definitions", text: "" },
    ]).filter((b) => b.cache_control !== undefined).length;

    // Log and return
    logPreRequest({
      tier,
      model,
      isHeartbeat: false,
      budget,
      contextFiles: contextSummary?.files,
      contextSizeBytes: contextSummary?.totalSizeBytes,
      cacheHeaders: cacheHeaderCount,
    });

    return {
      allowed: true,
      model,
      tier,
      isHeartbeat: false,
      contextSummary,
      cacheHeaderCount,
    };
  }

  // -------------------------------------------------------------------------
  // Post-request pipeline
  // -------------------------------------------------------------------------

  /**
   * Run after an LLM call completes:
   * 1. Calculate cost → 2. Log usage → 3. Record cache hit/miss →
   * 4. Check escalation (on error)
   */
  async postRequest(
    userId: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    model: string,
    tier: ComplexityTier,
    sessionId: string,
    error?: boolean,
    toolName?: string,
  ): Promise<PostRequestResult> {
    // 1. Calculate cost
    const costUsd = this.guardian.calculateCost(
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
    );

    // 2. Build and log usage entry
    const usage: TokenUsageEntry = {
      timestamp: Date.now(),
      sessionId,
      model,
      tier,
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
      toolName,
      error,
    };
    await this.guardian.logUsage(userId, usage);
    this.guardian.recordApiCall(userId);

    // 3. Cache metrics
    if (cachedTokens > 0) {
      this.cache.recordHit(cachedTokens, model);
    } else {
      this.cache.recordMiss();
    }

    // 4. Escalation check (only on error)
    let shouldEscalate = false;
    let escalatedModel: string | undefined;
    if (error) {
      const esc = this.router.shouldEscalate("tool_error", tier, sessionId);
      shouldEscalate = esc.escalate;
      escalatedModel = esc.newModel;
    }

    logPostRequest({
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
      shouldEscalate,
      escalatedModel,
    });

    return { shouldEscalate, escalatedModel, usage };
  }

  // -------------------------------------------------------------------------
  // Session context (pass-through)
  // -------------------------------------------------------------------------

  async getSessionContext(): Promise<SessionInitResult> {
    return this.optimizer.getSessionInitContext();
  }

  // -------------------------------------------------------------------------
  // Accessors (for tests and advanced usage)
  // -------------------------------------------------------------------------

  getGuardian(): BudgetGuardian {
    return this.guardian;
  }

  getRouter(): ModelRouter {
    return this.router;
  }

  getCacheManager(): CacheManager {
    return this.cache;
  }

  getHeartbeatRouter(): HeartbeatRouter {
    return this.heartbeat;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  destroy(): void {
    this.guardian.close();
  }
}
