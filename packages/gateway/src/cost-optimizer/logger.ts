// ---------------------------------------------------------------------------
// Cost Optimizer — structured logging (no secrets, no user content)
// ---------------------------------------------------------------------------

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { BudgetStatus, ComplexityTier } from "./types.js";

const log = createSubsystemLogger("cost-optimizer");

export function logPreRequest(params: {
  tier: ComplexityTier;
  model: string;
  isHeartbeat: boolean;
  budget: BudgetStatus;
  contextFiles?: number;
  contextSizeBytes?: number;
  cacheHeaders?: number;
}): void {
  const budgetPct =
    params.budget.dailyLimitUsd > 0
      ? (
          (params.budget.dailySpendUsd / params.budget.dailyLimitUsd) *
          100
        ).toFixed(1)
      : "n/a";

  log.info(
    `pre-request: tier=${params.tier} model=${params.model} ` +
      `budget=$${params.budget.dailySpendUsd.toFixed(2)}/$${params.budget.dailyLimitUsd.toFixed(2)} (${budgetPct}%) ` +
      `heartbeat=${String(params.isHeartbeat)} context=${String(params.contextFiles ?? 0)} files/${String(params.contextSizeBytes ?? 0)}B ` +
      `cache=${String(params.cacheHeaders ?? 0)} headers`,
  );
}

export function logPostRequest(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  shouldEscalate: boolean;
  escalatedModel?: string;
}): void {
  const escalateInfo = params.shouldEscalate
    ? ` ESCALATE→${params.escalatedModel}`
    : "";
  log.info(
    `post-request: model=${params.model} ` +
      `tokens=${String(params.inputTokens)}in/${String(params.outputTokens)}out/${String(params.cachedTokens)}cached ` +
      `cost=$${params.costUsd.toFixed(4)}${escalateInfo}`,
  );
}

export function logBlocked(reason: string): void {
  log.warn(`request BLOCKED: ${reason}`);
}

export function logHeartbeatRouted(
  provider: "ollama" | "cloud",
  model: string,
): void {
  log.info(`heartbeat routed: provider=${provider} model=${model}`);
}

export { log };
