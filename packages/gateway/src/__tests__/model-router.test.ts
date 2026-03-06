import { describe, expect, it } from "vitest";
import { ModelRouter } from "../cost-optimizer/model-router.js";

describe("ModelRouter", () => {
  const router = new ModelRouter();

  // -----------------------------------------------------------------------
  // ROUTINE classification
  // -----------------------------------------------------------------------

  describe("ROUTINE classification", () => {
    it("classifies 'read file X' as ROUTINE", () => {
      const result = router.classifyComplexity("read file config.json");
      expect(result.tier).toBe("ROUTINE");
    });

    it("classifies 'what time is it' as ROUTINE", () => {
      const result = router.classifyComplexity("what time is it");
      expect(result.tier).toBe("ROUTINE");
    });

    it("classifies 'set a reminder for 3pm' as ROUTINE", () => {
      const result = router.classifyComplexity("set a reminder for 3pm");
      expect(result.tier).toBe("ROUTINE");
    });

    it("classifies 'show my calendar' as ROUTINE", () => {
      const result = router.classifyComplexity("check calendar today");
      expect(result.tier).toBe("ROUTINE");
    });
  });

  // -----------------------------------------------------------------------
  // MODERATE classification
  // -----------------------------------------------------------------------

  describe("MODERATE classification", () => {
    it("classifies 'write a function that sorts an array' as MODERATE", () => {
      const result = router.classifyComplexity(
        "write a function that sorts an array",
      );
      expect(result.tier).toBe("MODERATE");
    });

    it("classifies 'translate this text to German' as MODERATE", () => {
      const result = router.classifyComplexity(
        "translate this text to German",
      );
      expect(result.tier).toBe("MODERATE");
    });
  });

  // -----------------------------------------------------------------------
  // COMPLEX classification
  // -----------------------------------------------------------------------

  describe("COMPLEX classification", () => {
    it("classifies 'review the security of this codebase' as COMPLEX", () => {
      const result = router.classifyComplexity(
        "review the security of this codebase",
      );
      expect(result.tier).toBe("COMPLEX");
    });

    it("classifies 'architect a microservice system' as COMPLEX", () => {
      const result = router.classifyComplexity(
        "architect a microservice system for our backend",
      );
      expect(result.tier).toBe("COMPLEX");
    });

    it("classifies 'find vulnerabilities in the auth flow' as COMPLEX", () => {
      const result = router.classifyComplexity(
        "find vulnerabilities in the authentication flow",
      );
      expect(result.tier).toBe("COMPLEX");
    });

    it("classifies 'refactor entire module structure' as COMPLEX", () => {
      const result = router.classifyComplexity(
        "refactor entire module structure of the backend",
      );
      expect(result.tier).toBe("COMPLEX");
    });
  });

  // -----------------------------------------------------------------------
  // User Override
  // -----------------------------------------------------------------------

  describe("User Override", () => {
    it("detects 'use opus' override", () => {
      const result = router.classifyComplexity("use opus for this task");
      expect(result.tier).toBe("COMPLEX");
      expect(result.overrideDetected).toBe(true);
      expect(result.model).toBe("claude-opus-4-6-20250610");
    });

    it("detects 'nutze opus' (German) override", () => {
      const result = router.classifyComplexity("nutze opus bitte");
      expect(result.tier).toBe("COMPLEX");
      expect(result.overrideDetected).toBe(true);
    });

    it("detects 'use claude opus' override", () => {
      const result = router.classifyComplexity("use claude opus");
      expect(result.tier).toBe("COMPLEX");
      expect(result.overrideDetected).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Tool-based classification
  // -----------------------------------------------------------------------

  describe("Tool-based classification", () => {
    it("escalates shell + sudo to COMPLEX", () => {
      const result = router.classifyComplexity("run sudo apt update", [
        "shell",
      ]);
      expect(result.tier).toBe("COMPLEX");
    });

    it("classifies calendar tool as ROUTINE", () => {
      const result = router.classifyComplexity("what do I have today", [
        "calendar",
      ]);
      expect(result.tier).toBe("ROUTINE");
    });

    it("classifies weather tool as ROUTINE", () => {
      const result = router.classifyComplexity("weather forecast", [
        "weather",
      ]);
      expect(result.tier).toBe("ROUTINE");
    });
  });

  // -----------------------------------------------------------------------
  // Escalation
  // -----------------------------------------------------------------------

  describe("Escalation", () => {
    it("escalates ROUTINE → MODERATE on tool_error", () => {
      const r = new ModelRouter();
      const result = r.shouldEscalate("tool_error", "ROUTINE", "sess-1");
      expect(result.escalate).toBe(true);
      expect(result.newTier).toBe("MODERATE");
    });

    it("escalates MODERATE → COMPLEX on timeout", () => {
      const r = new ModelRouter();
      const result = r.shouldEscalate("timeout", "MODERATE", "sess-2");
      expect(result.escalate).toBe(true);
      expect(result.newTier).toBe("COMPLEX");
      expect(result.newModel).toBe("claude-opus-4-6-20250610");
    });

    it("does not escalate COMPLEX further", () => {
      const r = new ModelRouter();
      const result = r.shouldEscalate("tool_error", "COMPLEX", "sess-3");
      expect(result.escalate).toBe(false);
    });

    it("blocks escalation after max retries", () => {
      const r = new ModelRouter({ maxEscalations: 1 });
      const first = r.shouldEscalate("tool_error", "ROUTINE", "sess-4");
      expect(first.escalate).toBe(true);

      const second = r.shouldEscalate("tool_error", "ROUTINE", "sess-4");
      expect(second.escalate).toBe(false);
    });

    it("user_override always escalates to COMPLEX", () => {
      const r = new ModelRouter();
      const result = r.shouldEscalate("user_override", "ROUTINE", "sess-5");
      expect(result.escalate).toBe(true);
      expect(result.newTier).toBe("COMPLEX");
    });
  });

  // -----------------------------------------------------------------------
  // Confidence
  // -----------------------------------------------------------------------

  describe("Confidence", () => {
    it("has high confidence for clearly routine messages", () => {
      const result = router.classifyComplexity("read file README.md");
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it("has high confidence for clearly complex messages", () => {
      const result = router.classifyComplexity(
        "architect a new security review system design",
      );
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it("clamps confidence to [0.3, 1.0]", () => {
      const result = router.classifyComplexity("ambiguous task");
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // Edge Cases
  // -----------------------------------------------------------------------

  describe("Edge Cases", () => {
    it("classifies empty message as MODERATE", () => {
      const result = router.classifyComplexity("");
      expect(result.tier).toBe("MODERATE");
    });

    it("classifies whitespace-only message as MODERATE", () => {
      const result = router.classifyComplexity("   ");
      expect(result.tier).toBe("MODERATE");
    });

    it("classifies very long message with complex signal", () => {
      const longMessage = "Please " + "analyze ".repeat(100) + "the system design and architect a solution";
      const result = router.classifyComplexity(longMessage);
      expect(result.tier).toBe("COMPLEX");
    });

    it("getModelForTier returns correct models", () => {
      expect(router.getModelForTier("ROUTINE")).toBe(
        "claude-haiku-4-5-20251001",
      );
      expect(router.getModelForTier("MODERATE")).toBe(
        "claude-sonnet-4-6-20250514",
      );
      expect(router.getModelForTier("COMPLEX")).toBe(
        "claude-opus-4-6-20250610",
      );
    });

    it("shouldPreventDowngrade detects security tasks", () => {
      expect(router.shouldPreventDowngrade("security audit")).toBe(true);
      expect(router.shouldPreventDowngrade("architect the system")).toBe(true);
      expect(router.shouldPreventDowngrade("read a file")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Custom config
  // -----------------------------------------------------------------------

  describe("Custom config", () => {
    it("uses custom model mappings", () => {
      const custom = new ModelRouter({
        models: { routine: "claude-haiku-4-5-20251001", moderate: "claude-sonnet-4-6-20250514", complex: "claude-opus-4-6-20250610" },
      });
      const result = custom.classifyComplexity("read file X");
      expect(result.model).toBe("claude-haiku-4-5-20251001");
    });
  });
});
