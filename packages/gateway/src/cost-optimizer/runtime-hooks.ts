// ---------------------------------------------------------------------------
// Cost Optimizer — Runtime Hooks (lazy singleton, non-blocking, fault-tolerant)
// ---------------------------------------------------------------------------

import { log } from "./logger.js";
import { CostOptimizerMiddleware } from "./middleware.js";
import type {
  ComplexityTier,
  CostOptimizerMiddlewareConfig,
  PreRequestResult,
} from "./types.js";

let instance: CostOptimizerMiddleware | null = null;

/** Lazy singleton — created on first call. */
export function getCostOptimizer(
  config?: Partial<CostOptimizerMiddlewareConfig>,
): CostOptimizerMiddleware {
  if (!instance) {
    instance = new CostOptimizerMiddleware(config);
    log.info("cost optimizer initialized");
  }
  return instance;
}

/** For tests: reset singleton. */
export function resetCostOptimizer(): void {
  instance?.destroy();
  instance = null;
}

/**
 * Hook BEFORE LLM call.
 * Called from run.ts before model resolution.
 * Returns null if cost optimizer is disabled or not initialized.
 */
export async function beforeLLMCall(params: {
  userId?: string;
  prompt: string;
  sessionId: string;
  model: string;
  provider: string;
}): Promise<PreRequestResult | null> {
  if (!instance) return null;
  try {
    return await instance.preRequest(params.userId ?? "local", params.prompt);
  } catch (err) {
    log.warn(`beforeLLMCall failed (non-blocking): ${String(err)}`);
    return null;
  }
}

/**
 * Hook AFTER LLM call.
 * Called from run.ts after usage normalization.
 * Non-blocking — errors are logged but don't affect the response.
 */
export async function afterLLMCall(params: {
  userId?: string;
  model: string;
  tier: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  error?: boolean;
  toolName?: string;
}): Promise<void> {
  if (!instance) return;
  try {
    await instance.postRequest(
      params.userId ?? "local",
      params.inputTokens,
      params.outputTokens,
      params.cachedTokens,
      params.model,
      params.tier as ComplexityTier,
      params.sessionId,
      params.error,
      params.toolName,
    );
  } catch (err) {
    log.warn(`afterLLMCall failed (non-blocking): ${String(err)}`);
  }
}
