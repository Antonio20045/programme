import { describe, expect, it } from "vitest";
import { CacheManager } from "../cost-optimizer/cache-manager.js";

describe("CacheManager", () => {
  // -------------------------------------------------------------------------
  // isStaticBlock
  // -------------------------------------------------------------------------

  describe("isStaticBlock", () => {
    const cm = new CacheManager();

    it("returns true for SOUL.md", () => {
      expect(cm.isStaticBlock("SOUL.md")).toBe(true);
    });

    it("returns true for USER.md", () => {
      expect(cm.isStaticBlock("USER.md")).toBe(true);
    });

    it("returns true for IDENTITY.md", () => {
      expect(cm.isStaticBlock("IDENTITY.md")).toBe(true);
    });

    it("returns true for system_prompt", () => {
      expect(cm.isStaticBlock("system_prompt")).toBe(true);
    });

    it("returns true for tool_definitions", () => {
      expect(cm.isStaticBlock("tool_definitions")).toBe(true);
    });

    it("returns false for user_message", () => {
      expect(cm.isStaticBlock("user_message")).toBe(false);
    });

    it("returns false for memory/ prefixed blocks", () => {
      expect(cm.isStaticBlock("memory/2026-02-18.md")).toBe(false);
    });

    it("returns false for tool_output", () => {
      expect(cm.isStaticBlock("tool_output")).toBe(false);
    });

    it("returns false for tool_result", () => {
      expect(cm.isStaticBlock("tool_result")).toBe(false);
    });

    it("returns false for unknown block names", () => {
      expect(cm.isStaticBlock("random_block")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // buildCacheHeaders
  // -------------------------------------------------------------------------

  describe("buildCacheHeaders", () => {
    it("adds cache_control to static blocks only", () => {
      const cm = new CacheManager();
      const blocks = [
        { name: "SOUL.md", text: "You are a helpful assistant." },
        { name: "user_message", text: "Hello" },
        { name: "tool_definitions", text: "tools: [...]" },
      ];

      const result = cm.buildCacheHeaders(blocks);

      expect(result).toHaveLength(3);
      expect(result[0]!.cache_control).toEqual({ type: "ephemeral" });
      expect(result[1]!.cache_control).toBeUndefined();
      expect(result[2]!.cache_control).toEqual({ type: "ephemeral" });
    });

    it("preserves text content in all blocks", () => {
      const cm = new CacheManager();
      const blocks = [
        { name: "SOUL.md", text: "soul content" },
        { name: "user_message", text: "user content" },
      ];

      const result = cm.buildCacheHeaders(blocks);

      expect(result[0]!.text).toBe("soul content");
      expect(result[1]!.text).toBe("user content");
    });

    it("sets type to 'text' on all blocks", () => {
      const cm = new CacheManager();
      const blocks = [{ name: "SOUL.md", text: "test" }];
      const result = cm.buildCacheHeaders(blocks);
      expect(result[0]!.type).toBe("text");
    });

    it("does not add cache_control when enabled=false", () => {
      const cm = new CacheManager({ enabled: false });
      const blocks = [
        { name: "SOUL.md", text: "You are a helpful assistant." },
        { name: "system_prompt", text: "System instructions" },
      ];

      const result = cm.buildCacheHeaders(blocks);

      expect(result[0]!.cache_control).toBeUndefined();
      expect(result[1]!.cache_control).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // optimizeBlockOrder
  // -------------------------------------------------------------------------

  describe("optimizeBlockOrder", () => {
    it("puts static blocks before dynamic blocks", () => {
      const cm = new CacheManager();
      const blocks = [
        { name: "user_message", text: "Hello" },
        { name: "SOUL.md", text: "Soul" },
        { name: "tool_output", text: "Result" },
        { name: "tool_definitions", text: "Tools" },
      ];

      const result = cm.optimizeBlockOrder(blocks);

      expect(result[0]!.name).toBe("SOUL.md");
      expect(result[1]!.name).toBe("tool_definitions");
      expect(result[2]!.name).toBe("user_message");
      expect(result[3]!.name).toBe("tool_output");
    });

    it("preserves relative order within static group", () => {
      const cm = new CacheManager();
      const blocks = [
        { name: "tool_definitions", text: "t" },
        { name: "SOUL.md", text: "s" },
        { name: "IDENTITY.md", text: "i" },
      ];

      const result = cm.optimizeBlockOrder(blocks);

      expect(result[0]!.name).toBe("tool_definitions");
      expect(result[1]!.name).toBe("SOUL.md");
      expect(result[2]!.name).toBe("IDENTITY.md");
    });

    it("preserves relative order within dynamic group", () => {
      const cm = new CacheManager();
      const blocks = [
        { name: "tool_output", text: "a" },
        { name: "user_message", text: "b" },
        { name: "memory/2026-02-18.md", text: "c" },
      ];

      const result = cm.optimizeBlockOrder(blocks);

      expect(result[0]!.name).toBe("tool_output");
      expect(result[1]!.name).toBe("user_message");
      expect(result[2]!.name).toBe("memory/2026-02-18.md");
    });

    it("handles empty input", () => {
      const cm = new CacheManager();
      expect(cm.optimizeBlockOrder([])).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  describe("getMetrics", () => {
    it("starts with all zeroes", () => {
      const cm = new CacheManager();
      const m = cm.getMetrics();
      expect(m.hits).toBe(0);
      expect(m.misses).toBe(0);
      expect(m.evictions).toBe(0);
      expect(m.invalidations).toBe(0);
      expect(m.savedTokens).toBe(0);
      expect(m.savedCostUsd).toBe(0);
      expect(m.hitRate).toBe(0);
    });

    it("computes hitRate correctly", () => {
      const cm = new CacheManager();
      cm.recordHit(100, "claude-haiku-4-5-20251001");
      cm.recordHit(100, "claude-haiku-4-5-20251001");
      cm.recordMiss();

      const m = cm.getMetrics();
      expect(m.hits).toBe(2);
      expect(m.misses).toBe(1);
      expect(m.hitRate).toBeCloseTo(2 / 3);
    });

    it("calculates savedCostUsd for known models", () => {
      const cm = new CacheManager();
      // Haiku: input=0.25/1M, cached=0.025/1M → saving = 0.225/1M per token
      cm.recordHit(1_000_000, "claude-haiku-4-5-20251001");

      const m = cm.getMetrics();
      expect(m.savedTokens).toBe(1_000_000);
      // fullCost = 1M * 0.25/1M = 0.25, cachedCost = 1M * 0.025/1M = 0.025
      expect(m.savedCostUsd).toBeCloseTo(0.225);
    });

    it("handles unknown models gracefully (no cost savings)", () => {
      const cm = new CacheManager();
      cm.recordHit(500, "unknown-model-xyz");

      const m = cm.getMetrics();
      expect(m.savedTokens).toBe(500);
      expect(m.savedCostUsd).toBe(0);
    });
  });

  describe("resetMetrics", () => {
    it("resets all metrics to zero", () => {
      const cm = new CacheManager();
      cm.recordHit(1000, "claude-haiku-4-5-20251001");
      cm.recordMiss();

      cm.resetMetrics();

      const m = cm.getMetrics();
      expect(m.hits).toBe(0);
      expect(m.misses).toBe(0);
      expect(m.savedTokens).toBe(0);
      expect(m.savedCostUsd).toBe(0);
      expect(m.hitRate).toBe(0);
    });
  });
});
