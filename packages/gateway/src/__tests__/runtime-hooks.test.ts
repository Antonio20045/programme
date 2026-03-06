import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock fetch for HeartbeatRouter
vi.stubGlobal(
  "fetch",
  vi.fn().mockRejectedValue(new Error("no ollama")),
);

import {
  afterLLMCall,
  beforeLLMCall,
  getCostOptimizer,
  resetCostOptimizer,
} from "../cost-optimizer/runtime-hooks.js";

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
  return path.join(dir, "budget.sqlite");
}

describe("Runtime Hooks", () => {
  let dbPath: string;

  beforeEach(() => {
    resetCostOptimizer();
    dbPath = tmpDbPath();
  });

  afterEach(() => {
    resetCostOptimizer();
    try {
      fs.unlinkSync(dbPath);
      fs.rmdirSync(path.dirname(dbPath));
    } catch {
      // best-effort
    }
  });

  // -----------------------------------------------------------------------
  // getCostOptimizer
  // -----------------------------------------------------------------------

  describe("getCostOptimizer", () => {
    it("creates singleton on first call", () => {
      const opt = getCostOptimizer({
        dbPath,
        budget: {
          dailyLimitUsd: 1,
          monthlyLimitUsd: 10,
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
      expect(opt).toBeDefined();
    });

    it("returns same instance on subsequent calls", () => {
      const first = getCostOptimizer({ dbPath });
      const second = getCostOptimizer();
      expect(first).toBe(second);
    });
  });

  // -----------------------------------------------------------------------
  // resetCostOptimizer
  // -----------------------------------------------------------------------

  describe("resetCostOptimizer", () => {
    it("destroys and resets singleton", () => {
      getCostOptimizer({ dbPath });
      expect(() => resetCostOptimizer()).not.toThrow();
    });

    it("allows re-creation after reset", () => {
      getCostOptimizer({ dbPath });
      resetCostOptimizer();
      // After reset, a new instance should be creatable
      const newDb = tmpDbPath();
      const fresh = getCostOptimizer({ dbPath: newDb });
      expect(fresh).toBeDefined();
      resetCostOptimizer();
      try {
        fs.unlinkSync(newDb);
        fs.rmdirSync(path.dirname(newDb));
      } catch {
        // best-effort
      }
    });
  });

  // -----------------------------------------------------------------------
  // beforeLLMCall
  // -----------------------------------------------------------------------

  describe("beforeLLMCall", () => {
    it("returns null when not initialized", async () => {
      const result = await beforeLLMCall({
        prompt: "hello",
        sessionId: "s1",
        model: "claude-haiku-4-5-20251001",
        provider: "anthropic",
      });
      expect(result).toBeNull();
    });

    it("returns PreRequestResult when initialized", async () => {
      getCostOptimizer({
        dbPath,
        budget: {
          dailyLimitUsd: 100,
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

      const result = await beforeLLMCall({
        prompt: "What time is it?",
        sessionId: "s1",
        model: "claude-haiku-4-5-20251001",
        provider: "anthropic",
      });
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // afterLLMCall
  // -----------------------------------------------------------------------

  describe("afterLLMCall", () => {
    it("does nothing when not initialized", async () => {
      await expect(
        afterLLMCall({
          model: "claude-haiku-4-5-20251001",
          tier: "ROUTINE",
          sessionId: "s1",
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
        }),
      ).resolves.toBeUndefined();
    });

    it("logs usage when initialized", async () => {
      getCostOptimizer({
        dbPath,
        budget: {
          dailyLimitUsd: 100,
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

      await expect(
        afterLLMCall({
          model: "claude-haiku-4-5-20251001",
          tier: "ROUTINE",
          sessionId: "s1",
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
        }),
      ).resolves.toBeUndefined();
    });

    it("is non-blocking on error (does not throw)", async () => {
      getCostOptimizer({
        dbPath,
        budget: {
          dailyLimitUsd: 100,
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

      // Pass invalid tier — should not throw
      await expect(
        afterLLMCall({
          model: "unknown-model",
          tier: "INVALID" as "ROUTINE",
          sessionId: "s1",
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          error: true,
          toolName: "web-search",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
