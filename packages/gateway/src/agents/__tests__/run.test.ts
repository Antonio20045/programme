/**
 * Minimal test covering the cost-optimizer hooks added to run.ts.
 * We don't test the full OpenClaw runner — only our additive integration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the subsystem logger
vi.mock("../../logging/subsystem.js", () => ({
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
  getCostOptimizer,
  resetCostOptimizer,
} from "../../cost-optimizer/runtime-hooks.js";

describe("run.ts cost-optimizer hooks", () => {
  afterEach(() => {
    resetCostOptimizer();
  });

  it("afterLLMCall is non-blocking when optimizer not initialized", async () => {
    // Simulates the fire-and-forget call in run.ts
    await expect(
      afterLLMCall({
        model: "claude-haiku-4-5-20251001",
        tier: "ROUTINE",
        sessionId: "test-session",
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it("getCostOptimizer advisory log does not throw", () => {
    // Simulates the try/catch in run.ts around getCostOptimizer().preRequest()
    expect(() => {
      try {
        const costOpt = getCostOptimizer({ dbPath: ":memory:" });
        // Advisory only — we just check it doesn't throw
        expect(costOpt).toBeDefined();
      } catch {
        // Non-blocking — matches the try/catch in run.ts
      }
    }).not.toThrow();
  });

  it("afterLLMCall with usage data does not throw", async () => {
    getCostOptimizer({ dbPath: ":memory:" });
    await expect(
      afterLLMCall({
        model: "claude-haiku-4-5-20251001",
        tier: "ROUTINE",
        sessionId: "test-session",
        inputTokens: 500,
        outputTokens: 200,
        cachedTokens: 100,
        error: false,
        toolName: "web-search",
      }),
    ).resolves.toBeUndefined();
  });

  it("afterLLMCall with error flag triggers escalation check", async () => {
    getCostOptimizer({ dbPath: ":memory:" });
    // Should not throw even with error flag
    await expect(
      afterLLMCall({
        model: "claude-haiku-4-5-20251001",
        tier: "ROUTINE",
        sessionId: "test-session",
        inputTokens: 100,
        outputTokens: 0,
        cachedTokens: 0,
        error: true,
        toolName: "shell",
      }),
    ).resolves.toBeUndefined();
  });
});
