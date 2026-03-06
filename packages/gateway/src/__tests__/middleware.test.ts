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

// Mock fetch for HeartbeatRouter (Ollama detection)
vi.stubGlobal(
  "fetch",
  vi.fn().mockRejectedValue(new Error("no ollama")),
);

const USER_ID = "test-user-uuid";

function createMiddleware(
  overrides?: Partial<CostOptimizerMiddlewareConfig>,
): CostOptimizerMiddleware {
  return new CostOptimizerMiddleware({
    budget: {
      dailyLimitUsd: 1.0,
      monthlyLimitUsd: 10.0,
      warningThreshold: 0.75,
      rateLimits: {
        apiCooldownMs: 0, // disable cooldown for tests
        maxConcurrent: 100,
        webSearchCooldownMs: 0,
        webSearchBatchSize: 100,
        webSearchBatchPauseMs: 0,
      },
    },
    ...overrides,
  });
}

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

describe("CostOptimizerMiddleware", () => {
  let mw: CostOptimizerMiddleware;

  beforeEach(() => {
    mockPoolQuery.mockReset();
    setupDefaultMocks();
    mw = createMiddleware();
  });

  afterEach(() => {
    mw.destroy();
  });

  // -----------------------------------------------------------------------
  // preRequest — normal flow
  // -----------------------------------------------------------------------

  describe("preRequest — normal flow", () => {
    it("allows a routine message with ROUTINE tier", async () => {
      const result = await mw.preRequest(USER_ID, "What time is it?");
      expect(result.allowed).toBe(true);
      expect(result.isHeartbeat).toBe(false);
      expect(result.tier).toBe("ROUTINE");
      expect(result.model).toBe("claude-haiku-4-5-20251001");
    });

    it("classifies complex message as COMPLEX tier", async () => {
      const result = await mw.preRequest(
        USER_ID,
        "Review the security architecture of the auth system and identify potential XSS vulnerabilities",
      );
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("COMPLEX");
      expect(result.model).toBe("claude-opus-4-6-20250610");
    });

    it("classifies moderate message as MODERATE tier", async () => {
      const result = await mw.preRequest(
        USER_ID,
        "Write a function that sorts an array of objects by date",
      );
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("MODERATE");
      expect(result.model).toBe("claude-sonnet-4-6-20250514");
    });

    it("includes context summary", async () => {
      const result = await mw.preRequest(USER_ID, "hello");
      expect(result.allowed).toBe(true);
      if (result.contextSummary) {
        expect(typeof result.contextSummary.files).toBe("number");
        expect(typeof result.contextSummary.totalSizeBytes).toBe("number");
      }
    });

    it("includes cache header count", async () => {
      const result = await mw.preRequest(USER_ID, "hello");
      expect(result.allowed).toBe(true);
      expect(result.cacheHeaderCount).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // preRequest — budget blocked
  // -----------------------------------------------------------------------

  describe("preRequest — budget blocked", () => {
    it("blocks when monthly budget is exhausted", async () => {
      const limitedMw = createMiddleware({
        budget: {
          dailyLimitUsd: 100,
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

      // Mock: logUsage + then checkBudget sees high spend
      mockPoolQuery.mockReset();
      mockPoolQuery.mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("user_budget_limits")) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === "string" && sql.includes("SUM(cost_usd)")) {
          return Promise.resolve({ rows: [{ total: "0.01" }] }); // > 0.001 limit
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await limitedMw.preRequest(USER_ID, "hello");
      expect(result.allowed).toBe(false);
      expect(result.blockedReason).toBeDefined();

      limitedMw.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // preRequest — rate limit
  // -----------------------------------------------------------------------

  describe("preRequest — rate limit", () => {
    it("blocks when API cooldown is active", async () => {
      const rlMw = createMiddleware({
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
  });

  // -----------------------------------------------------------------------
  // preRequest — heartbeat
  // -----------------------------------------------------------------------

  describe("preRequest — heartbeat", () => {
    it("detects HEARTBEAT message", async () => {
      const result = await mw.preRequest(USER_ID, "HEARTBEAT");
      expect(result.allowed).toBe(true);
      expect(result.isHeartbeat).toBe(true);
      expect(result.tier).toBe("ROUTINE");
    });

    it("detects ping message", async () => {
      const result = await mw.preRequest(USER_ID, "ping");
      expect(result.allowed).toBe(true);
      expect(result.isHeartbeat).toBe(true);
    });

    it("does not classify normal messages as heartbeat", async () => {
      const result = await mw.preRequest(USER_ID, "What is a heartbeat?");
      expect(result.isHeartbeat).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // preRequest — budget downgrade
  // -----------------------------------------------------------------------

  describe("preRequest — budget downgrade", () => {
    it("forces ROUTINE when daily limit is exhausted (non-security)", async () => {
      const dgMw = createMiddleware({
        budget: {
          dailyLimitUsd: 0.001,
          monthlyLimitUsd: 100,
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

      mockPoolQuery.mockReset();
      mockPoolQuery.mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("user_budget_limits")) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === "string" && sql.includes("SUM(cost_usd)") && sql.includes("CURRENT_DATE")) {
          return Promise.resolve({ rows: [{ total: "0.01" }] }); // daily exhausted
        }
        if (typeof sql === "string" && sql.includes("SUM(cost_usd)")) {
          return Promise.resolve({ rows: [{ total: "0.01" }] }); // monthly ok (< 100)
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await dgMw.preRequest(
        USER_ID,
        "Write a function that sorts an array",
      );
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("ROUTINE");
      expect(result.model).toBe("claude-haiku-4-5-20251001");

      dgMw.destroy();
    });

    it("does NOT downgrade security-related messages", async () => {
      const dgMw = createMiddleware({
        budget: {
          dailyLimitUsd: 0.001,
          monthlyLimitUsd: 100,
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

      mockPoolQuery.mockReset();
      mockPoolQuery.mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("user_budget_limits")) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === "string" && sql.includes("SUM(cost_usd)")) {
          return Promise.resolve({ rows: [{ total: "0.01" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await dgMw.preRequest(
        USER_ID,
        "Review the security architecture and find vulnerabilities",
      );
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("COMPLEX");

      dgMw.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // preRequest — disabled
  // -----------------------------------------------------------------------

  describe("preRequest — disabled", () => {
    it("returns default when disabled", async () => {
      const offMw = createMiddleware({ enabled: false });

      const result = await offMw.preRequest(USER_ID, "anything");
      expect(result.allowed).toBe(true);
      expect(result.model).toBe("default");
      expect(result.tier).toBe("MODERATE");
      expect(result.isHeartbeat).toBe(false);

      offMw.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // postRequest
  // -----------------------------------------------------------------------

  describe("postRequest", () => {
    it("logs usage and returns cost", async () => {
      const result = await mw.postRequest(
        USER_ID,
        100,
        50,
        0,
        "claude-haiku-4-5-20251001",
        "ROUTINE",
        "session-1",
      );
      expect(result.usage.costUsd).toBeGreaterThanOrEqual(0);
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.shouldEscalate).toBe(false);
    });

    it("records cache hit when cached tokens > 0", async () => {
      await mw.postRequest(
        USER_ID,
        100,
        50,
        80,
        "claude-haiku-4-5-20251001",
        "ROUTINE",
        "session-1",
      );
      const metrics = mw.getCacheManager().getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.savedTokens).toBe(80);
    });

    it("records cache miss when no cached tokens", async () => {
      await mw.postRequest(
        USER_ID,
        100,
        50,
        0,
        "claude-haiku-4-5-20251001",
        "ROUTINE",
        "session-1",
      );
      const metrics = mw.getCacheManager().getMetrics();
      expect(metrics.misses).toBe(1);
    });

    it("triggers escalation on error for non-COMPLEX tier", async () => {
      const result = await mw.postRequest(
        USER_ID,
        100,
        50,
        0,
        "claude-haiku-4-5-20251001",
        "ROUTINE",
        "session-esc",
        true,
      );
      expect(result.shouldEscalate).toBe(true);
      expect(result.escalatedModel).toBe("claude-sonnet-4-6-20250514");
    });

    it("does not escalate COMPLEX tier on error", async () => {
      const result = await mw.postRequest(
        USER_ID,
        100,
        50,
        0,
        "claude-opus-4-6-20250610",
        "COMPLEX",
        "session-no-esc",
        true,
      );
      expect(result.shouldEscalate).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------

  describe("destroy", () => {
    it("closes without error", () => {
      const dMw = createMiddleware();
      expect(() => dMw.destroy()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Pipeline latency
  // -----------------------------------------------------------------------

  describe("pipeline latency", () => {
    it("100 preRequest calls complete in < 5000ms total", async () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        await mw.preRequest(USER_ID, `test message ${String(i)}`);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // -----------------------------------------------------------------------
  // getSessionContext
  // -----------------------------------------------------------------------

  describe("getSessionContext", () => {
    it("returns session init result", async () => {
      const result = await mw.getSessionContext();
      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("totalSizeBytes");
      expect(result).toHaveProperty("warnings");
      expect(Array.isArray(result.files)).toBe(true);
    });
  });
});
