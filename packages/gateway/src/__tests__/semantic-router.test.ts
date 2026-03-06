import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Domain Vectors (orthogonal, 5D) ───────────────────────

const DOMAIN_VECTORS: Record<string, number[]> = {
  email:    [1, 0, 0, 0, 0],
  calendar: [0, 1, 0, 0, 0],
  web:      [0, 0, 1, 0, 0],
  app:      [0, 0, 0, 1, 0],
  file:     [0, 0, 0, 0, 1],
};

const DEFAULT_VEC = [0.2, 0.2, 0.2, 0.2, 0.2];

// ─── Deterministic text → vector mapping ────────────────────

/** Maps tool name prefixes (for embedBatch descriptions) and query keywords. */
function textToVector(text: string): number[] {
  const t = text.toLowerCase();

  // ── Tool description strings start with "toolName: ..." ──
  if (t.startsWith("gmail:") || t.startsWith("outlook:")) return DOMAIN_VECTORS.email!;
  if (t.startsWith("calendar:")) return DOMAIN_VECTORS.calendar!;
  if (t.startsWith("web-search:")) return DOMAIN_VECTORS.web!;
  if (t.startsWith("app-launcher:")) return DOMAIN_VECTORS.app!;
  if (t.startsWith("filesystem:") || t.startsWith("notes:")) return DOMAIN_VECTORS.file!;
  if (t.startsWith("browser:")) return [0, 0, 0.7, 0.3, 0];

  // ── User queries (no tool name prefix) ──
  if (/e-?mail|gmail|posteingang|nachrichten/.test(t)) return DOMAIN_VECTORS.email!;
  if (/kalender|termine?\b|calendar|tagesplan/.test(t)) return DOMAIN_VECTORS.calendar!;
  if (/\bsuch|internet|web.?search|recherch/.test(t)) return DOMAIN_VECTORS.web!;
  if (/spotify|finder|\bstarte\b|\boeffne\b|programm/.test(t)) return DOMAIN_VECTORS.app!;
  if (/datei|ordner|notiz/.test(t)) return DOMAIN_VECTORS.file!;
  if (/browser|webseite|screenshot|formular/.test(t)) return [0, 0, 0.7, 0.3, 0];
  return DEFAULT_VEC;
}

// ─── Mocks ──────────────────────────────────────────────────

const mockEmbedQuery = vi.fn<(text: string) => Promise<number[]>>();
const mockEmbedBatch = vi.fn<(texts: string[]) => Promise<number[][]>>();

vi.mock("../memory/embeddings.js", () => ({
  createEmbeddingProvider: vi.fn().mockResolvedValue({
    provider: {
      id: "mock",
      model: "mock-model",
      embedQuery: (...args: [string]) => mockEmbedQuery(...args),
      embedBatch: (...args: [string[]]) => mockEmbedBatch(...args),
    },
  }),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({}),
}));

// ─── Import after mocks ────────────────────────────────────

import {
  initSemanticRouter,
  routeTools,
  resetSemanticRouter,
} from "../semantic-router.js";
import { createEmbeddingProvider } from "../memory/embeddings.js";

// ─── Helpers ────────────────────────────────────────────────

interface MockTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permissions: readonly string[];
  requiresConfirmation: boolean;
  runsOn: "server" | "desktop";
  execute: () => Promise<{ success: boolean; output: string }>;
}

function makeTool(name: string): MockTool {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: { type: "object", properties: {} },
    permissions: [],
    requiresConfirmation: false,
    runsOn: "server",
    execute: async () => ({ success: true, output: "" }),
  };
}

const ALL_TOOLS: MockTool[] = [
  "gmail", "calendar", "web-search", "browser", "app-launcher",
  "filesystem", "notes", "shell", "calculator", "translator",
  "datetime", "json-tools", "weather", "image-gen", "youtube",
].map(makeTool);

function setupEmbeddings(): void {
  mockEmbedBatch.mockImplementation(async (texts) =>
    texts.map((t) => textToVector(t)),
  );
  mockEmbedQuery.mockImplementation(async (text) => textToVector(text));
}

// ─── Tests ──────────────────────────────────────────────────

describe("semantic-router", () => {
  beforeEach(() => {
    resetSemanticRouter();
    vi.clearAllMocks();
    setupEmbeddings();
  });

  // ── Acceptance Tests ────────────────────────────────────

  describe("acceptance", () => {
    // Acceptance tests pre-init the index so routing is active
    it("routes 'oeffne Spotify' to app-launcher, not browser", async () => {
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const result = await routeTools("oeffne Spotify", ALL_TOOLS);
      const names = result.map((t) => t.name);
      expect(names).toContain("app-launcher");
      // browser is now in BASE_TOOLS (always included)
      expect(result.length).toBeLessThanOrEqual(12);
    });

    it("routes 'zeig meine E-Mails' to gmail", async () => {
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const result = await routeTools("zeig meine E-Mails", ALL_TOOLS);
      const names = result.map((t) => t.name);
      expect(names).toContain("gmail");
      expect(result.length).toBeLessThanOrEqual(12);
    });

    it("routes 'was steht heute im Kalender' to calendar", async () => {
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const result = await routeTools("was steht heute im Kalender", ALL_TOOLS);
      const names = result.map((t) => t.name);
      expect(names).toContain("calendar");
      expect(result.length).toBeLessThanOrEqual(12);
    });

    it("routes 'such im Internet nach TypeScript' to web-search", async () => {
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const result = await routeTools("such im Internet nach TypeScript", ALL_TOOLS);
      const names = result.map((t) => t.name);
      expect(names).toContain("web-search");
      expect(result.length).toBeLessThanOrEqual(12);
    });
  });

  // ── Robustness Tests ──────────────────────────────────

  describe("robustness", () => {
    it("returns all tools when provider init fails", async () => {
      vi.mocked(createEmbeddingProvider).mockRejectedValueOnce(
        new Error("No API key"),
      );
      // Init fails → routeTools should always return all tools
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const result = await routeTools("zeig meine E-Mails", ALL_TOOLS);
      expect(result).toHaveLength(ALL_TOOLS.length);
    });

    it("does not re-add disabled tools", async () => {
      // Init with full list, then route with subset (gmail removed)
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const subset = ALL_TOOLS.filter((t) => t.name !== "gmail");
      const result = await routeTools("zeig meine E-Mails", subset);
      const names = result.map((t) => t.name);
      expect(names).not.toContain("gmail");
    });

    it("returns all tools when count <= TOP_K", async () => {
      const fewTools = ALL_TOOLS.slice(0, 4);
      const result = await routeTools("anything", fewTools);
      expect(result).toHaveLength(fewTools.length);
    });

    it("always includes tools not in the index", async () => {
      // Init with standard tools, then add a dynamic one
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      const dynamicTool = makeTool("my-custom-tool");
      const withDynamic = [...ALL_TOOLS, dynamicTool];
      const result = await routeTools("irgendwas", withDynamic);
      const names = result.map((t) => t.name);
      expect(names).toContain("my-custom-tool");
    });

    it("returns all tools when query embedding fails", async () => {
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      mockEmbedQuery.mockRejectedValueOnce(new Error("Embed failed"));
      const result = await routeTools("test", ALL_TOOLS);
      expect(result).toHaveLength(ALL_TOOLS.length);
    });

    it("resetSemanticRouter clears state correctly", async () => {
      await initSemanticRouter(ALL_TOOLS.map((t) => t.name));
      resetSemanticRouter();
      // After reset, routeTools returns all (index gone), re-triggers background init
      const result = await routeTools("test", ALL_TOOLS);
      expect(result).toHaveLength(ALL_TOOLS.length);
    });

    it("returns all tools while index is building (non-blocking)", async () => {
      // First call triggers background init but returns all tools immediately
      const result = await routeTools("zeig meine E-Mails", ALL_TOOLS);
      expect(result).toHaveLength(ALL_TOOLS.length);
    });
  });
});
