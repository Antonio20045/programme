import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionOptimizer } from "../cost-optimizer/session-optimizer.js";
import type { DailyMemoryEntry } from "../cost-optimizer/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpWorkspaceDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-opt-test-"));
}

async function writeFile(dir: string, name: string, content: string) {
  const filePath = path.join(dir, name);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf-8");
}

function makeDailyEntry(overrides?: Partial<DailyMemoryEntry>): DailyMemoryEntry {
  return {
    date: "2026-02-18",
    sessionId: "test-session-1",
    topics: ["Testing session optimizer"],
    decisions: ["Use 8KB cap"],
    blockers: [],
    nextSteps: ["Implement cache manager"],
    tokenCount: 1500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionOptimizer", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = tmpWorkspaceDir();
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getSessionInitContext
  // -------------------------------------------------------------------------

  describe("getSessionInitContext", () => {
    it("loads SOUL.md, USER.md, and IDENTITY.md", async () => {
      await writeFile(workDir, "SOUL.md", "Soul content");
      await writeFile(workDir, "USER.md", "User content");
      await writeFile(workDir, "IDENTITY.md", "Identity content");

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      const names = result.files.map((f) => f.name);
      expect(names).toContain("SOUL.md");
      expect(names).toContain("USER.md");
      expect(names).toContain("IDENTITY.md");
    });

    it("loads today's memory file", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await writeFile(workDir, `memory/${today}.md`, "Today's memory");

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      const names = result.files.map((f) => f.name);
      expect(names).toContain(`memory/${today}.md`);
    });

    it("excludes MEMORY.md", async () => {
      await writeFile(workDir, "MEMORY.md", "Should be excluded");
      await writeFile(workDir, "SOUL.md", "Soul");

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      const names = result.files.map((f) => f.name);
      expect(names).not.toContain("MEMORY.md");
    });

    it("excludes sessions/*.jsonl", async () => {
      // sessions/ prefix is in exclude list
      await writeFile(workDir, "sessions/abc.jsonl", "log data");
      await writeFile(workDir, "SOUL.md", "Soul");

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      const names = result.files.map((f) => f.name);
      expect(names).not.toContain("sessions/abc.jsonl");
    });

    it("gracefully skips missing files", async () => {
      // Only create SOUL.md — USER.md and IDENTITY.md are missing
      await writeFile(workDir, "SOUL.md", "Soul only");

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.name).toBe("SOUL.md");
      expect(result.warnings).toHaveLength(0);
    });

    it("returns empty result for empty workspace", async () => {
      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      expect(result.files).toHaveLength(0);
      expect(result.totalSizeBytes).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("enforces 8KB cap with truncation", async () => {
      // Create files that together exceed 8KB
      const bigContent = "x".repeat(5000);
      await writeFile(workDir, "SOUL.md", bigContent);
      await writeFile(workDir, "USER.md", bigContent);

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      expect(result.totalSizeBytes).toBeLessThanOrEqual(8192);
      expect(result.warnings.length).toBeGreaterThan(0);
      // Check truncation marker is present
      const truncated = result.files.find((f) =>
        f.content.includes("[...truncated]"),
      );
      expect(truncated).toBeDefined();
    });

    it("calculates correct totalSizeBytes", async () => {
      const content = "Hello World";
      await writeFile(workDir, "SOUL.md", content);

      const opt = new SessionOptimizer({}, workDir);
      const result = await opt.getSessionInitContext();

      expect(result.totalSizeBytes).toBe(
        Buffer.byteLength(content, "utf-8"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // writeDailyMemory
  // -------------------------------------------------------------------------

  describe("writeDailyMemory", () => {
    it("creates memory/ directory and writes file", async () => {
      const opt = new SessionOptimizer({}, workDir);
      const entry = makeDailyEntry();

      await opt.writeDailyMemory(entry);

      const filePath = path.join(workDir, "memory", "2026-02-18.md");
      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toContain("## Session test-session-1");
      expect(content).toContain("### Topics");
      expect(content).toContain("- Testing session optimizer");
      expect(content).toContain("### Decisions");
      expect(content).toContain("### Next Steps");
      expect(content).toContain("*Token count: 1500*");
    });

    it("appends to existing file", async () => {
      const opt = new SessionOptimizer({}, workDir);

      await opt.writeDailyMemory(
        makeDailyEntry({ sessionId: "session-1" }),
      );
      await opt.writeDailyMemory(
        makeDailyEntry({ sessionId: "session-2" }),
      );

      const filePath = path.join(workDir, "memory", "2026-02-18.md");
      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toContain("## Session session-1");
      expect(content).toContain("## Session session-2");
    });

    it("writes structured markdown format", async () => {
      const opt = new SessionOptimizer({}, workDir);
      const entry = makeDailyEntry({
        blockers: ["Build failing"],
      });

      await opt.writeDailyMemory(entry);

      const filePath = path.join(workDir, "memory", "2026-02-18.md");
      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).toContain("### Blockers");
      expect(content).toContain("- Build failing");
    });

    it("omits empty sections", async () => {
      const opt = new SessionOptimizer({}, workDir);
      const entry = makeDailyEntry({
        topics: [],
        decisions: [],
        blockers: [],
        nextSteps: [],
      });

      await opt.writeDailyMemory(entry);

      const filePath = path.join(workDir, "memory", "2026-02-18.md");
      const content = await fsp.readFile(filePath, "utf-8");
      expect(content).not.toContain("### Topics");
      expect(content).not.toContain("### Decisions");
      expect(content).not.toContain("### Blockers");
      expect(content).not.toContain("### Next Steps");
    });
  });

  // -------------------------------------------------------------------------
  // Security: path traversal prevention
  // -------------------------------------------------------------------------

  describe("writeDailyMemory — path traversal prevention", () => {
    it("rejects path traversal in date field", async () => {
      const opt = new SessionOptimizer(undefined, workDir);
      const malicious = makeDailyEntry({ date: "../../etc/cron.d/evil" });
      await expect(opt.writeDailyMemory(malicious)).rejects.toThrow(
        "Invalid date format",
      );
    });

    it("rejects non-date strings", async () => {
      const opt = new SessionOptimizer(undefined, workDir);
      const bad = makeDailyEntry({ date: "not-a-date" });
      await expect(opt.writeDailyMemory(bad)).rejects.toThrow(
        "Invalid date format",
      );
    });

    it("allows valid YYYY-MM-DD dates", async () => {
      const opt = new SessionOptimizer(undefined, workDir);
      await expect(
        opt.writeDailyMemory(makeDailyEntry({ date: "2026-01-15" })),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // shouldFlushMemory
  // -------------------------------------------------------------------------

  describe("shouldFlushMemory", () => {
    const opt = new SessionOptimizer();

    it("returns false below 50%", () => {
      expect(opt.shouldFlushMemory(0)).toBe(false);
      expect(opt.shouldFlushMemory(30)).toBe(false);
      expect(opt.shouldFlushMemory(49)).toBe(false);
      expect(opt.shouldFlushMemory(49.9)).toBe(false);
    });

    it("returns true at 50% and above", () => {
      expect(opt.shouldFlushMemory(50)).toBe(true);
      expect(opt.shouldFlushMemory(75)).toBe(true);
      expect(opt.shouldFlushMemory(100)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getContextThresholds
  // -------------------------------------------------------------------------

  describe("getContextThresholds", () => {
    it("returns 4 thresholds in ascending order", () => {
      const opt = new SessionOptimizer();
      const thresholds = opt.getContextThresholds();

      expect(thresholds).toHaveLength(4);
      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]!.fraction).toBeGreaterThan(
          thresholds[i - 1]!.fraction,
        );
      }
    });

    it("has correct actions", () => {
      const opt = new SessionOptimizer();
      const thresholds = opt.getContextThresholds();

      expect(thresholds[0]!.action).toBe("flush_memory");
      expect(thresholds[1]!.action).toBe("compact_old");
      expect(thresholds[2]!.action).toBe("force_compact");
      expect(thresholds[3]!.action).toBe("emergency_compact");
    });
  });

  // -------------------------------------------------------------------------
  // evaluateContextUsage
  // -------------------------------------------------------------------------

  describe("evaluateContextUsage", () => {
    const opt = new SessionOptimizer();

    it("returns null threshold below 50%", () => {
      const result = opt.evaluateContextUsage(4000, 10000);
      expect(result.activeThreshold).toBeNull();
      expect(result.usageFraction).toBeCloseTo(0.4);
      expect(result.recommendation).toContain("within normal limits");
    });

    it("returns flush_memory at 50%", () => {
      const result = opt.evaluateContextUsage(5000, 10000);
      expect(result.activeThreshold).not.toBeNull();
      expect(result.activeThreshold!.action).toBe("flush_memory");
    });

    it("returns compact_old at 65%", () => {
      const result = opt.evaluateContextUsage(6500, 10000);
      expect(result.activeThreshold!.action).toBe("compact_old");
    });

    it("returns force_compact at 80%", () => {
      const result = opt.evaluateContextUsage(8000, 10000);
      expect(result.activeThreshold!.action).toBe("force_compact");
    });

    it("returns emergency_compact at 95%", () => {
      const result = opt.evaluateContextUsage(9500, 10000);
      expect(result.activeThreshold!.action).toBe("emergency_compact");
    });

    it("returns highest matching threshold (not first)", () => {
      // 85% should match 50%, 65%, 80% — return the 80% threshold
      const result = opt.evaluateContextUsage(8500, 10000);
      expect(result.activeThreshold!.action).toBe("force_compact");
    });

    it("handles totalTokens=0 gracefully", () => {
      const result = opt.evaluateContextUsage(0, 0);
      expect(result.activeThreshold).toBeNull();
      expect(result.usageFraction).toBe(0);
    });

    it("includes correct usageFraction", () => {
      const result = opt.evaluateContextUsage(7500, 10000);
      expect(result.usageFraction).toBeCloseTo(0.75);
    });
  });
});
