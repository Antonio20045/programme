/**
 * Integration tests for the Cost Optimizer pipeline.
 * These verify the full flow from message → pipeline → result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { CostOptimizerMiddleware } from "../cost-optimizer/middleware.js";
import type { CostOptimizerMiddlewareConfig } from "../cost-optimizer/types.js";

// Mock the subsystem logger
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    raw: vi.fn(),
    child: vi.fn(),
    subsystem: "cost-optimizer",
    isEnabled: () => true,
  }),
}));

// Mock pg Pool
const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock("../database/index.js", () => ({
  getPool: () => ({ query: mockPoolQuery }) as unknown as Pool,
}));

// Mock fetch for HeartbeatRouter — default: no Ollama
const mockFetch = vi.fn().mockRejectedValue(new Error("no ollama"));
vi.stubGlobal("fetch", mockFetch);

const USER_ID = "integration-user-uuid";

/** Default mock: no user limits, zero spend */
function setupDefaultMocks(): void {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("user_budget_limits")) {
      return Promise.resolve({ rows: [] });
    }
    if (typeof sql === "string" && sql.includes("SUM(cost_usd)")) {
      return Promise.resolve({ rows: [{ total: "0" }] });
    }
    if (typeof sql === "string" && sql.includes("INSERT INTO")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function createMw(
  overrides?: Partial<CostOptimizerMiddlewareConfig>,
): CostOptimizerMiddleware {
  return new CostOptimizerMiddleware({
    budget: {
      dailyLimitUsd: 10.0,
      monthlyLimitUsd: 100.0,
      warningThreshold: 0.75,
      rateLimits: {
        apiCooldownMs: 0,
        maxConcurrent: 100,
        webSearchCooldownMs: 0,
        webSearchBatchSize: 100,
        webSearchBatchPauseMs: 0,
      },
    },
    ...overrides,
  });
}

describe("Cost Optimizer Integration", () => {
  let mw: CostOptimizerMiddleware;

  beforeEach(() => {
    mockFetch.mockRejectedValue(new Error("no ollama"));
    mockPoolQuery.mockReset();
    setupDefaultMocks();
    mw = createMw();
  });

  afterEach(() => {
    mw.destroy();
  });

  // -----------------------------------------------------------------------
  // 1. Full flow — routine message
  // -----------------------------------------------------------------------

  it("routine message: ROUTINE tier, budget logged, allowed", async () => {
    const pre = await mw.preRequest(USER_ID, "Was ist der Status meines Kalenders?");
    expect(pre.allowed).toBe(true);
    expect(pre.tier).toBe("ROUTINE");
    expect(pre.isHeartbeat).toBe(false);
    expect(pre.model).toBe("claude-haiku-4-5-20251001");

    const post = await mw.postRequest(
      USER_ID,
      200,
      100,
      0,
      "claude-haiku-4-5-20251001",
      "ROUTINE",
      "session-routine",
    );
    expect(post.usage.costUsd).toBeGreaterThanOrEqual(0);
    expect(post.shouldEscalate).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 2. Full flow — complex message
  // -----------------------------------------------------------------------

  it("complex message: COMPLEX tier, Opus recommended", async () => {
    const pre = await mw.preRequest(
      USER_ID,
      "Review the security architecture of the auth system and identify potential XSS vulnerabilities",
    );
    expect(pre.allowed).toBe(true);
    expect(pre.tier).toBe("COMPLEX");
    expect(pre.model).toBe("claude-opus-4-6-20250610");
  });

  // -----------------------------------------------------------------------
  // 3. Budget block
  // -----------------------------------------------------------------------

  it("blocks when daily budget is exhausted and monthly is also exceeded", async () => {
    const limitedMw = createMw({
      budget: {
        dailyLimitUsd: 0.001,
        monthlyLimitUsd: 0.001,
        warningThreshold: 0.75,
        rateLimits: {
          apiCooldownMs: 0,
          maxConcurrent: 100,
          webSearchCooldownMs: 0,
          webSearchBatchSize: 100,
          webSearchBatchPauseMs: 0,
        },
      },
    });

    // Mock high spend
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("user_budget_limits")) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === "string" && sql.includes("SUM(cost_usd)")) {
        return Promise.resolve({ rows: [{ total: "0.02" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const pre = await limitedMw.preRequest(USER_ID, "Hello");
    expect(pre.allowed).toBe(false);
    expect(pre.blockedReason).toBeDefined();
    expect(pre.blockedReason!.toLowerCase()).toMatch(/budget/i);

    limitedMw.destroy();
  });

  // -----------------------------------------------------------------------
  // 4. Heartbeat routing (Ollama available)
  // -----------------------------------------------------------------------

  it("heartbeat routes to Ollama when available", async () => {
    const ollamaMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3:8b", size: 4_000_000_000 }],
      }),
    });
    vi.stubGlobal("fetch", ollamaMock);

    const hbMw = createMw();

    const pre = await hbMw.preRequest(USER_ID, "HEARTBEAT");
    expect(pre.allowed).toBe(true);
    expect(pre.isHeartbeat).toBe(true);
    expect(pre.tier).toBe("ROUTINE");
    expect(pre.model).toContain("ollama/");

    hbMw.destroy();
    vi.stubGlobal("fetch", mockFetch);
  });

  // -----------------------------------------------------------------------
  // 5. Heartbeat fallback (no Ollama)
  // -----------------------------------------------------------------------

  it("heartbeat falls back to cloud when Ollama unavailable", async () => {
    const pre = await mw.preRequest(USER_ID, "ping");
    expect(pre.allowed).toBe(true);
    expect(pre.isHeartbeat).toBe(true);
    expect(pre.model).toBe("claude-haiku-4-5-20251001");
  });

  // -----------------------------------------------------------------------
  // 6. Rate limit
  // -----------------------------------------------------------------------

  it("blocks second request within API cooldown", async () => {
    const rlMw = createMw({
      budget: {
        dailyLimitUsd: 100,
        monthlyLimitUsd: 100,
        warningThreshold: 0.75,
        rateLimits: {
          apiCooldownMs: 60_000,
          maxConcurrent: 100,
          webSearchCooldownMs: 0,
          webSearchBatchSize: 100,
          webSearchBatchPauseMs: 0,
        },
      },
    });

    const first = await rlMw.preRequest(USER_ID, "hello");
    expect(first.allowed).toBe(true);

    rlMw.getGuardian().recordApiCall(USER_ID);

    const second = await rlMw.preRequest(USER_ID, "hello again");
    expect(second.allowed).toBe(false);
    expect(second.blockedReason).toContain("Rate limit");

    rlMw.destroy();
  });

  // -----------------------------------------------------------------------
  // 7. Runaway detection
  // -----------------------------------------------------------------------

  it("detects same-tool-loop runaway pattern", async () => {
    const now = Date.now();
    mockPoolQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 5 }, (_, i) => ({
        sessionId: "s1",
        model: "claude-haiku-4-5-20251001",
        tier: "ROUTINE",
        inputTokens: "100",
        outputTokens: "50",
        cachedTokens: "0",
        costUsd: "0.0001",
        toolName: "web-search",
        error: false,
        timestamp: String(now - (4 - i) * 1000),
      })),
    });

    const result = await mw.getGuardian().detectRunaway(USER_ID);
    expect(result.detected).toBe(true);
    expect(result.pattern).toBe("same-tool-loop");
  });

  // -----------------------------------------------------------------------
  // 8. Context thresholds
  // -----------------------------------------------------------------------

  describe("context thresholds", () => {
    it("50% → flush_memory", async () => {
      const ctx = await mw.getSessionContext();
      expect(ctx).toBeDefined();

      const thresholds = [
        { used: 50_000, total: 100_000, expectedAction: "flush_memory" },
        { used: 65_000, total: 100_000, expectedAction: "compact_old" },
        { used: 80_000, total: 100_000, expectedAction: "force_compact" },
        { used: 95_000, total: 100_000, expectedAction: "emergency_compact" },
      ] as const;

      for (const { used, total, expectedAction } of thresholds) {
        const optimizer = new (
          await import("../cost-optimizer/session-optimizer.js")
        ).SessionOptimizer();
        const result = optimizer.evaluateContextUsage(used, total);
        expect(result.activeThreshold).not.toBeNull();
        expect(result.activeThreshold!.action).toBe(expectedAction);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 9. Cache metrics
  // -----------------------------------------------------------------------

  it("tracks cache hit rate and saved cost", async () => {
    await mw.postRequest(
      USER_ID, 200, 100, 150,
      "claude-haiku-4-5-20251001", "ROUTINE", "s1",
    );
    await mw.postRequest(
      USER_ID, 300, 200, 0,
      "claude-haiku-4-5-20251001", "ROUTINE", "s1",
    );
    await mw.postRequest(
      USER_ID, 100, 50, 80,
      "claude-haiku-4-5-20251001", "ROUTINE", "s1",
    );

    const metrics = mw.getCacheManager().getMetrics();
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(1);
    expect(metrics.hitRate).toBeCloseTo(2 / 3, 2);
    expect(metrics.savedTokens).toBe(230);
    expect(metrics.savedCostUsd).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 10. Pipeline latency benchmark
  // -----------------------------------------------------------------------

  it("100 preRequest calls complete in < 5000ms", async () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await mw.preRequest(USER_ID, `benchmark message ${String(i)}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  // -----------------------------------------------------------------------
  // Full round-trip: pre → post with escalation
  // -----------------------------------------------------------------------

  it("full round-trip with error triggers escalation", async () => {
    const pre = await mw.preRequest(USER_ID, "show me the weather");
    expect(pre.allowed).toBe(true);
    expect(pre.tier).toBe("ROUTINE");

    const post = await mw.postRequest(
      USER_ID,
      100, 50, 0,
      "claude-haiku-4-5-20251001",
      "ROUTINE",
      "session-escalate",
      true,
    );
    expect(post.shouldEscalate).toBe(true);
    expect(post.escalatedModel).toBe("claude-sonnet-4-6-20250514");
  });

  // -----------------------------------------------------------------------
  // Disabled optimizer passes through
  // -----------------------------------------------------------------------

  it("disabled optimizer returns default allow", async () => {
    const offMw = createMw({ enabled: false });

    const pre = await offMw.preRequest(USER_ID, "anything at all");
    expect(pre.allowed).toBe(true);
    expect(pre.model).toBe("default");
    expect(pre.isHeartbeat).toBe(false);

    offMw.destroy();
  });
});
