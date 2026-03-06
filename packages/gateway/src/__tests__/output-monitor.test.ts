import { describe, expect, it } from "vitest";
import type { ResponseModeContext } from "../persona/output-monitor.js";
import { monitorResponseMode } from "../persona/output-monitor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ResponseModeContext> = {}): ResponseModeContext {
  return {
    responseMode: "action",
    tokenCount: 0,
    firstToolCallSeen: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// monitorResponseMode
// ---------------------------------------------------------------------------

describe("monitorResponseMode", () => {
  // Action mode
  it("returns violation when action mode has excessive text before tool call", () => {
    const ctx = makeCtx({ responseMode: "action", tokenCount: 200 });
    const result = monitorResponseMode("more text", ctx);
    expect(result).toContain("action-mode");
    expect(result).toContain("200");
  });

  it("returns null when action mode has few tokens before tool call", () => {
    const ctx = makeCtx({ responseMode: "action", tokenCount: 50 });
    const result = monitorResponseMode("some text", ctx);
    expect(result).toBeNull();
  });

  it("returns null when action mode has many tokens but tool call was seen", () => {
    const ctx = makeCtx({
      responseMode: "action",
      tokenCount: 200,
      firstToolCallSeen: true,
    });
    const result = monitorResponseMode("text after tool", ctx);
    expect(result).toBeNull();
  });

  // Answer mode
  it("returns violation when answer mode response is too long", () => {
    const ctx = makeCtx({ responseMode: "answer", tokenCount: 300 });
    const result = monitorResponseMode("long answer", ctx);
    expect(result).toContain("answer-mode");
    expect(result).toContain("300");
  });

  it("returns null when answer mode response is within limit", () => {
    const ctx = makeCtx({ responseMode: "answer", tokenCount: 100 });
    const result = monitorResponseMode("short answer", ctx);
    expect(result).toBeNull();
  });

  // Conversation mode
  it("never returns violation for conversation mode", () => {
    const ctx = makeCtx({ responseMode: "conversation", tokenCount: 5000 });
    const result = monitorResponseMode("lots of text", ctx);
    expect(result).toBeNull();
  });
});
