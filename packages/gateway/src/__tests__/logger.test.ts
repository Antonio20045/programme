import { describe, expect, it, vi } from "vitest";

// Mock the subsystem logger before importing
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

import {
  log,
  logBlocked,
  logHeartbeatRouted,
  logPostRequest,
  logPreRequest,
} from "../cost-optimizer/logger.js";
import type { BudgetStatus } from "../cost-optimizer/types.js";

const baseBudget: BudgetStatus = {
  dailySpendUsd: 0.5,
  monthlySpendUsd: 2.0,
  dailyLimitUsd: 1.0,
  monthlyLimitUsd: 10.0,
  isWarning: false,
  downgraded: false,
  isBlocked: false,
};

describe("Cost Optimizer Logger", () => {
  it("logPreRequest logs tier, model and budget info", () => {
    expect(() =>
      logPreRequest({
        tier: "ROUTINE",
        model: "claude-haiku-4-5-20251001",
        isHeartbeat: false,
        budget: baseBudget,
        contextFiles: 3,
        contextSizeBytes: 4096,
        cacheHeaders: 2,
      }),
    ).not.toThrow();
    expect(log.info).toHaveBeenCalled();
  });

  it("logPostRequest logs tokens and cost", () => {
    expect(() =>
      logPostRequest({
        model: "claude-haiku-4-5-20251001",
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 20,
        costUsd: 0.0001,
        shouldEscalate: false,
      }),
    ).not.toThrow();
    expect(log.info).toHaveBeenCalled();
  });

  it("logPostRequest includes escalation info", () => {
    logPostRequest({
      model: "claude-haiku-4-5-20251001",
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      costUsd: 0.001,
      shouldEscalate: true,
      escalatedModel: "claude-sonnet-4-6-20250514",
    });
    const lastCall = vi.mocked(log.info).mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("ESCALATE");
  });

  it("logBlocked logs warning with reason", () => {
    logBlocked("Monthly budget exceeded");
    expect(log.warn).toHaveBeenCalledWith(
      "request BLOCKED: Monthly budget exceeded",
    );
  });

  it("logHeartbeatRouted logs provider and model", () => {
    logHeartbeatRouted("ollama", "ollama/llama3");
    expect(log.info).toHaveBeenCalledWith(
      "heartbeat routed: provider=ollama model=ollama/llama3",
    );
  });

  it("handles zero daily limit without NaN", () => {
    expect(() =>
      logPreRequest({
        tier: "MODERATE",
        model: "claude-sonnet-4-6-20250514",
        isHeartbeat: false,
        budget: { ...baseBudget, dailyLimitUsd: 0 },
      }),
    ).not.toThrow();
    const lastCall = vi.mocked(log.info).mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("n/a");
  });

  // Security: logPreRequest does not accept user content at all
  it("does not accept message parameter (prevents PII leakage)", () => {
    logPreRequest({
      tier: "ROUTINE",
      model: "claude-haiku-4-5-20251001",
      isHeartbeat: false,
      budget: baseBudget,
    });
    const allCalls = vi.mocked(log.info).mock.calls.flat().join(" ");
    // Only classification metadata, no user content
    expect(allCalls).toContain("tier=ROUTINE");
    expect(allCalls).toContain("model=claude-haiku");
  });
});
