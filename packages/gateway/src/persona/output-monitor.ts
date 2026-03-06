/**
 * Monitors LLM output stream tokens for technical term leakage
 * and response-mode violations.
 *
 * Read-only — never blocks or modifies the stream.
 * Matches are logged via console.warn for observability.
 */

import { containsTechnicalTerms } from "./blocklist.js";

/**
 * Check text for technical terms. Returns matches (empty = clean).
 * Does NOT modify the input text.
 */
export function monitorOutput(text: string): string[] {
  return containsTechnicalTerms(text);
}

// ---------------------------------------------------------------------------
// Response-Mode Monitor
// ---------------------------------------------------------------------------

export interface ResponseModeContext {
  responseMode: "action" | "answer" | "conversation";
  tokenCount: number;
  firstToolCallSeen: boolean;
  /** Buffered token data while stream-gate is active (action-mode). */
  gateBuffer: string[];
  /** Whether the stream-gate is active (suppressing token emission). */
  gateActive: boolean;
  /** Timestamp when gating started — for safety timeout. */
  gateStartedAt: number;
}

/** Approximate char threshold for ~3 sentences in action mode. */
const ACTION_TOKEN_LIMIT = 150;

/** Approximate char threshold for ~5 sentences in answer mode. */
const ANSWER_TOKEN_LIMIT = 250;

/**
 * Check for response-mode violations. Returns violation string or null.
 * Read-only — never modifies the stream.
 */
export function monitorResponseMode(_text: string, ctx: ResponseModeContext): string | null {
  if (ctx.responseMode === "action") {
    if (ctx.tokenCount > ACTION_TOKEN_LIMIT && !ctx.firstToolCallSeen) {
      return `action-mode: excessive text before tool call (${ctx.tokenCount} tokens)`;
    }
  }

  if (ctx.responseMode === "answer") {
    if (ctx.tokenCount > ANSWER_TOKEN_LIMIT) {
      return `answer-mode: response too long (${ctx.tokenCount} tokens)`;
    }
  }

  // conversation → no checks
  return null;
}
