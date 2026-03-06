// ---------------------------------------------------------------------------
// Session Optimizer — lean init + daily memory + context thresholds
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
} from "../agents/workspace.js";

import type {
  ContextThreshold,
  ContextThresholds,
  DailyMemoryEntry,
  SessionInitConfig,
  SessionInitFile,
  SessionInitResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SESSION_INIT_CONFIG: SessionInitConfig = {
  maxFirstMessageTokens: 2048,
};

/** Hard cap on total init context size. */
const MAX_INIT_SIZE_BYTES = 8192;

/** Files to load at session init (order matters for truncation priority). */
const INIT_ALLOW_LIST: readonly string[] = [
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
];

/** Files/prefixes that are never loaded at init. */
const EXCLUDE_PATTERNS = ["MEMORY.md", "memory.md", "sessions/", "tool_output"];

// ---------------------------------------------------------------------------
// Context Thresholds
// ---------------------------------------------------------------------------

const CONTEXT_THRESHOLDS: ContextThresholds = [
  { fraction: 0.5, label: "50%", action: "flush_memory" },
  { fraction: 0.65, label: "65%", action: "compact_old" },
  { fraction: 0.8, label: "80%", action: "force_compact" },
  { fraction: 0.95, label: "95%", action: "emergency_compact" },
] as const;

// ---------------------------------------------------------------------------
// SessionOptimizer
// ---------------------------------------------------------------------------

export class SessionOptimizer {
  private readonly config: SessionInitConfig;
  private readonly workspaceDir: string;

  constructor(config?: Partial<SessionInitConfig>, workspaceDir?: string) {
    this.config = { ...DEFAULT_SESSION_INIT_CONFIG, ...config };
    this.workspaceDir = workspaceDir ?? ".";
  }

  // -------------------------------------------------------------------------
  // Lean Init
  // -------------------------------------------------------------------------

  /**
   * Load only the essential files for session init context.
   * Allow-list: SOUL.md, USER.md, IDENTITY.md, memory/YYYY-MM-DD.md (today).
   * Enforces 8KB total cap with proportional truncation.
   */
  async getSessionInitContext(): Promise<SessionInitResult> {
    const todayMemory = `memory/${new Date().toISOString().slice(0, 10)}.md`;
    const filesToLoad = [...INIT_ALLOW_LIST, todayMemory];

    const files: SessionInitFile[] = [];
    const warnings: string[] = [];

    for (const name of filesToLoad) {
      if (this.isExcluded(name)) continue;

      const filePath = path.join(this.workspaceDir, name);
      try {
        const content = await fs.readFile(filePath, "utf-8"); // eslint-disable-line security/detect-non-literal-fs-filename
        files.push({
          name,
          content,
          sizeBytes: Buffer.byteLength(content, "utf-8"),
        });
      } catch (err: unknown) {
        // ENOENT is expected — not all files exist in every workspace
        if (isNodeError(err) && err.code === "ENOENT") continue;
        warnings.push(`Failed to read ${name}: ${String(err)}`);
      }
    }

    // Enforce 8KB cap
    let totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    if (totalSize > MAX_INIT_SIZE_BYTES) {
      this.truncateFiles(files, warnings);
      totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    }

    return { files, totalSizeBytes: totalSize, warnings };
  }

  // -------------------------------------------------------------------------
  // Daily Memory
  // -------------------------------------------------------------------------

  /**
   * Append structured daily memory to `memory/YYYY-MM-DD.md`.
   * Creates the memory/ directory if it doesn't exist.
   */
  async writeDailyMemory(entry: DailyMemoryEntry): Promise<void> {
    // Validate date format to prevent path traversal (e.g. "../../etc/cron.d/evil")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      throw new Error(`Invalid date format: expected YYYY-MM-DD, got "${entry.date}"`);
    }

    const memoryDir = path.join(this.workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true }); // eslint-disable-line security/detect-non-literal-fs-filename

    const filePath = path.join(memoryDir, `${entry.date}.md`);

    // Defense-in-depth: ensure resolved path stays within memoryDir
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(memoryDir))) {
      throw new Error("Path traversal detected in daily memory path");
    }

    const markdown = formatDailyMemory(entry);
    await fs.appendFile(filePath, markdown, "utf-8"); // eslint-disable-line security/detect-non-literal-fs-filename
  }

  // -------------------------------------------------------------------------
  // Context Thresholds
  // -------------------------------------------------------------------------

  /** Returns the static context threshold table. */
  getContextThresholds(): ContextThresholds {
    return CONTEXT_THRESHOLDS;
  }

  /** Returns true when context usage reaches the first threshold (50%). */
  shouldFlushMemory(contextUsagePercent: number): boolean {
    return contextUsagePercent >= 50;
  }

  /**
   * Evaluate current context usage against thresholds.
   * Returns the highest active threshold and a recommendation.
   */
  evaluateContextUsage(
    usedTokens: number,
    totalTokens: number,
  ): {
    activeThreshold: ContextThreshold | null;
    usageFraction: number;
    recommendation: string;
  } {
    if (totalTokens <= 0) {
      return {
        activeThreshold: null,
        usageFraction: 0,
        recommendation: "No context limit configured.",
      };
    }

    const usageFraction = usedTokens / totalTokens;
    let activeThreshold: ContextThreshold | null = null;

    // Find highest matching threshold
    for (const threshold of CONTEXT_THRESHOLDS) {
      if (usageFraction >= threshold.fraction) {
        activeThreshold = threshold;
      }
    }

    let recommendation: string;
    if (activeThreshold === null) {
      recommendation = "Context usage is within normal limits.";
    } else {
      switch (activeThreshold.action) {
        case "flush_memory":
          recommendation =
            "Context at 50%: flush non-essential memory snippets.";
          break;
        case "compact_old":
          recommendation =
            "Context at 65%: compact older conversation turns.";
          break;
        case "force_compact":
          recommendation =
            "Context at 80%: force-compact all non-critical content.";
          break;
        case "emergency_compact":
          recommendation =
            "Context at 95%: emergency compaction — keep only last turn and system prompt.";
          break;
      }
    }

    return { activeThreshold, usageFraction, recommendation };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private isExcluded(name: string): boolean {
    for (const pattern of EXCLUDE_PATTERNS) {
      if (name === pattern || name.startsWith(pattern)) return true;
    }
    return false;
  }

  private truncateFiles(
    files: SessionInitFile[],
    warnings: string[],
  ): void {
    const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    if (totalSize <= MAX_INIT_SIZE_BYTES) return;

    const ratio = MAX_INIT_SIZE_BYTES / totalSize;
    const truncationMarker = "\n[...truncated]";
    const markerBytes = Buffer.byteLength(truncationMarker, "utf-8");

    for (const file of files) {
      const targetBytes = Math.floor(file.sizeBytes * ratio);
      if (targetBytes < file.sizeBytes) {
        // Leave room for the truncation marker
        const cutAt = Math.max(0, targetBytes - markerBytes);
        file.content = file.content.slice(0, cutAt) + truncationMarker;
        file.sizeBytes = Buffer.byteLength(file.content, "utf-8");
        warnings.push(`${file.name} truncated to fit 8KB init cap.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDailyMemory(entry: DailyMemoryEntry): string {
  const lines: string[] = [];
  lines.push(`\n## Session ${entry.sessionId} (${entry.date})\n`);

  if (entry.topics.length > 0) {
    lines.push("### Topics");
    for (const t of entry.topics) lines.push(`- ${t}`);
    lines.push("");
  }
  if (entry.decisions.length > 0) {
    lines.push("### Decisions");
    for (const d of entry.decisions) lines.push(`- ${d}`);
    lines.push("");
  }
  if (entry.blockers.length > 0) {
    lines.push("### Blockers");
    for (const b of entry.blockers) lines.push(`- ${b}`);
    lines.push("");
  }
  if (entry.nextSteps.length > 0) {
    lines.push("### Next Steps");
    for (const n of entry.nextSteps) lines.push(`- ${n}`);
    lines.push("");
  }

  lines.push(`*Token count: ${entry.tokenCount}*\n`);
  return lines.join("\n");
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
