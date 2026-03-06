import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// Mock pg Pool
// ---------------------------------------------------------------------------

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock("../database/index.js", () => ({
  getPool: () => ({ query: mockPoolQuery }) as unknown as Pool,
}));

import { BudgetGuardian } from "../cost-optimizer/budget-guardian.js";

const USER_A = "user-a-uuid";
const USER_B = "user-b-uuid";

describe("BudgetGuardian", () => {
  let guardian: BudgetGuardian;

  beforeEach(() => {
    mockPoolQuery.mockReset();
    // Default: no user-specific limits, zero spend
    mockPoolQuery.mockResolvedValue({ rows: [] });
    guardian = new BudgetGuardian();
  });

  afterEach(() => {
    guardian.close();
  });

  // -----------------------------------------------------------------------
  // Budget checking
  // -----------------------------------------------------------------------

  it("returns no warning when budget is at 0%", async () => {
    // No limits row → default config; no spend rows → 0
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // user_budget_limits
      .mockResolvedValueOnce({ rows: [{ total: "0" }] }) // daily spend
      .mockResolvedValueOnce({ rows: [{ total: "0" }] }); // monthly spend

    const status = await guardian.checkBudget(USER_A);
    expect(status.isWarning).toBe(false);
    expect(status.isBlocked).toBe(false);
    expect(status.downgraded).toBe(false);
    expect(status.dailySpendUsd).toBe(0);
    expect(status.monthlySpendUsd).toBe(0);
  });

  it("warns at 75% daily budget", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // no user limits
      .mockResolvedValueOnce({ rows: [{ total: "0.76" }] }) // daily
      .mockResolvedValueOnce({ rows: [{ total: "0.76" }] }); // monthly

    const status = await guardian.checkBudget(USER_A);
    expect(status.isWarning).toBe(true);
    expect(status.downgraded).toBe(false);
    expect(status.isBlocked).toBe(false);
  });

  it("downgrades at 100% daily budget", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "1.01" }] })
      .mockResolvedValueOnce({ rows: [{ total: "1.01" }] });

    const status = await guardian.checkBudget(USER_A);
    expect(status.isWarning).toBe(true);
    expect(status.downgraded).toBe(true);
    expect(status.isBlocked).toBe(false);
    expect(status.warningMessage).toContain("Daily budget exhausted");
  });

  it("blocks at 100% monthly budget", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "10.01" }] })
      .mockResolvedValueOnce({ rows: [{ total: "10.01" }] });

    const status = await guardian.checkBudget(USER_A);
    expect(status.isWarning).toBe(true);
    expect(status.isBlocked).toBe(true);
    expect(status.warningMessage).toContain("Monthly budget exhausted");
  });

  it("uses user-specific limits from user_budget_limits", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            daily_limit_usd: "5.00",
            monthly_limit_usd: "50.00",
            warning_threshold: "0.80",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "3.50" }] }) // 70% of 5 → no warning
      .mockResolvedValueOnce({ rows: [{ total: "3.50" }] });

    const status = await guardian.checkBudget(USER_A);
    expect(status.dailyLimitUsd).toBe(5.0);
    expect(status.monthlyLimitUsd).toBe(50.0);
    expect(status.isWarning).toBe(false); // 70% < 80% threshold
  });

  // -----------------------------------------------------------------------
  // logUsage
  // -----------------------------------------------------------------------

  it("INSERT query passes correct arguments", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    await guardian.logUsage(USER_A, {
      timestamp: 1000,
      sessionId: "s1",
      model: "claude-haiku-4-5-20251001",
      tier: "ROUTINE",
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      costUsd: 0.001,
      toolName: "shell",
      error: true,
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO token_usage"),
      [USER_A, "s1", "claude-haiku-4-5-20251001", "ROUTINE", 100, 50, 0, 0.001, "shell", true],
    );
  });

  // -----------------------------------------------------------------------
  // getDailySpend / getMonthlySpend
  // -----------------------------------------------------------------------

  it("getDailySpend returns number from string", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ total: "0.42" }] });
    const spend = await guardian.getDailySpend(USER_A);
    expect(spend).toBeCloseTo(0.42, 4);
  });

  it("getMonthlySpend returns number from string", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ total: "3.14" }] });
    const spend = await guardian.getMonthlySpend(USER_A);
    expect(spend).toBeCloseTo(3.14, 4);
  });

  // -----------------------------------------------------------------------
  // Rate Limiting — per-user isolation
  // -----------------------------------------------------------------------

  it("blocks API call within cooldown period", () => {
    guardian.recordApiCall(USER_A);
    const result = guardian.checkRateLimit(USER_A, "api");
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
    expect(result.waitMs).toBeLessThanOrEqual(5000);
  });

  it("allows API call after cooldown", () => {
    const result = guardian.checkRateLimit(USER_A, "api");
    expect(result.allowed).toBe(true);
  });

  it("rate limiting is per-user — User A does not affect User B", () => {
    guardian.recordApiCall(USER_A);
    const resultA = guardian.checkRateLimit(USER_A, "api");
    const resultB = guardian.checkRateLimit(USER_B, "api");
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  it("blocks 6th web-search in batch", () => {
    for (let i = 0; i < 5; i++) {
      guardian.recordWebSearch(USER_A);
      // Override lastWebSearch so cooldown doesn't block
      const state = (guardian as unknown as { rateStates: Map<string, { lastWebSearch: number }> }).rateStates.get(USER_A);
      if (state) state.lastWebSearch = 0;
    }
    const result = guardian.checkRateLimit(USER_A, "web-search");
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  it("blocks concurrent calls beyond limit", () => {
    expect(guardian.acquireConcurrent(USER_A)).toBe(true);
    expect(guardian.acquireConcurrent(USER_A)).toBe(true);
    expect(guardian.acquireConcurrent(USER_A)).toBe(true);
    expect(guardian.acquireConcurrent(USER_A)).toBe(false); // 4th blocked (max 3)
    guardian.releaseConcurrent(USER_A);
    expect(guardian.acquireConcurrent(USER_A)).toBe(true); // slot freed
  });

  // -----------------------------------------------------------------------
  // Idle Cleanup
  // -----------------------------------------------------------------------

  it("cleans up idle rate states after 10 min", () => {
    guardian.recordApiCall(USER_A);
    const states = (guardian as unknown as { rateStates: Map<string, { lastActive: number }> }).rateStates;
    expect(states.has(USER_A)).toBe(true);

    // Simulate 11 min inactivity
    const state = states.get(USER_A)!;
    state.lastActive = Date.now() - 11 * 60 * 1000;

    // Trigger cleanup by accessing another user's state
    guardian.recordApiCall(USER_B);
    expect(states.has(USER_A)).toBe(false);
    expect(states.has(USER_B)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Runaway Detection (from DB)
  // -----------------------------------------------------------------------

  it("detects same-tool-loop from DB history", async () => {
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
        toolName: "shell",
        error: false,
        timestamp: String(now - (4 - i) * 1000),
      })),
    });

    const result = await guardian.detectRunaway(USER_A);
    expect(result.detected).toBe(true);
    expect(result.pattern).toBe("same-tool-loop");
  });

  it("returns no runaway for normal history", async () => {
    const now = Date.now();
    mockPoolQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 3 }, (_, i) => ({
        sessionId: "s1",
        model: "claude-haiku-4-5-20251001",
        tier: "ROUTINE",
        inputTokens: "100",
        outputTokens: "50",
        cachedTokens: "0",
        costUsd: "0.0001",
        toolName: null,
        error: false,
        timestamp: String(now - (2 - i) * 60_000),
      })),
    });

    const result = await guardian.detectRunaway(USER_A);
    expect(result.detected).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Cost Calculation (static, unchanged)
  // -----------------------------------------------------------------------

  it("calculates cost for claude-haiku-4-5", () => {
    const cost = guardian.calculateCost(
      "claude-haiku-4-5-20251001",
      1_000_000,
      0,
      0,
    );
    expect(cost).toBeCloseTo(0.25, 4);
  });

  it("calculates cost with cached tokens", () => {
    const cost = guardian.calculateCost(
      "claude-haiku-4-5-20251001",
      500_000,
      500_000,
      200_000,
    );
    const expected = 0.125 + 0.625 + 0.005;
    expect(cost).toBeCloseTo(expected, 4);
  });

  it("returns 0 for unknown model", () => {
    const cost = guardian.calculateCost("unknown-model-xyz", 1_000_000, 500_000, 0);
    expect(cost).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 429 Handling — per-user isolation
  // -----------------------------------------------------------------------

  it("returns waitMs on first 429, undefined after max retries", () => {
    const first = guardian.on429(USER_A);
    expect(first).toBeDefined();
    expect(first!.waitMs).toBe(300_000);

    const second = guardian.on429(USER_A);
    expect(second).toBeDefined();

    const third = guardian.on429(USER_A);
    expect(third).toBeUndefined(); // max 2 retries exceeded

    guardian.reset429(USER_A);
    const afterReset = guardian.on429(USER_A);
    expect(afterReset).toBeDefined();
  });

  it("429 handling is per-user — User A does not affect User B", () => {
    guardian.on429(USER_A);
    guardian.on429(USER_A);
    guardian.on429(USER_A); // max exceeded for A

    const resultB = guardian.on429(USER_B);
    expect(resultB).toBeDefined(); // B unaffected
    expect(resultB!.waitMs).toBe(300_000);
  });

  // -----------------------------------------------------------------------
  // User Isolation (spend queries)
  // -----------------------------------------------------------------------

  it("logUsage for User A does not affect getDailySpend for User B", async () => {
    // logUsage for User A
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    await guardian.logUsage(USER_A, {
      timestamp: Date.now(),
      sessionId: "s1",
      model: "claude-haiku-4-5-20251001",
      tier: "ROUTINE",
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      costUsd: 0.42,
    });

    // getDailySpend for User B → 0
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ total: "0" }] });
    const spend = await guardian.getDailySpend(USER_B);
    expect(spend).toBe(0);

    // Verify query was called with User B's ID
    const lastCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1]!;
    expect(lastCall[1]).toEqual([USER_B]);
  });

  // -----------------------------------------------------------------------
  // close()
  // -----------------------------------------------------------------------

  it("close() clears in-memory rate states", () => {
    guardian.recordApiCall(USER_A);
    guardian.recordApiCall(USER_B);
    const states = (guardian as unknown as { rateStates: Map<string, unknown> }).rateStates;
    expect(states.size).toBe(2);

    guardian.close();
    expect(states.size).toBe(0);
  });
});
