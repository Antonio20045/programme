/**
 * Semantic Router — Embedding-based Tool Pre-Routing
 *
 * Filters 40+ tools down to the Top-K most relevant per user message,
 * so the LLM only sees a small, focused subset.
 */

import type { ExtendedAgentTool } from "../../tools/src/types.js";
import { loadConfig } from "./config/config.js";
import type { EmbeddingProvider } from "./memory/embeddings.js";
import { createEmbeddingProvider } from "./memory/embeddings.js";
import { cosineSimilarity } from "./memory/internal.js";
import { getToolPersona } from "./persona/tool-descriptions.js";

// ─── Constants ──────────────────────────────────────────────

const TOP_K = 12;
const BASE_TOOLS: ReadonlySet<string> = new Set<string>([
  "gmail",
  "calendar",
  "connect-google",
  "filesystem",
  "web-search",
  "browser",
  "desktop-control",
  "screenshot",
  "app-launcher",
]);

// ─── Module State (Singleton) ───────────────────────────────

let embeddingProvider: EmbeddingProvider | null = null;
let toolIndex: Map<string, number[]> | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

// ─── Init ───────────────────────────────────────────────────

export async function initSemanticRouter(
  toolNames: readonly string[],
): Promise<void> {
  // Idempotent: skip if index already covers all requested tools
  if (toolIndex) {
    const allPresent = toolNames.every((n) => toolIndex!.has(n));
    if (allPresent) return;
  }

  // Deduplicate concurrent calls
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      const result = await createEmbeddingProvider({
        config: loadConfig(),
        provider: "auto",
        model: "",
        fallback: "none",
      });
      embeddingProvider = result.provider;

      // Build "toolName: description" strings for embedding
      const descriptions = toolNames.map((name) => {
        const persona = getToolPersona(name);
        return `${name}: ${persona.description}`;
      });

      const vectors = await embeddingProvider.embedBatch(descriptions);

      const index = new Map<string, number[]>();
      for (let i = 0; i < toolNames.length; i++) {
        const vec = vectors[i];
        if (vec) {
          index.set(toolNames[i]!, vec);
        }
      }
      toolIndex = index;
    } catch (err) {
      initFailed = true;
      console.warn("[semantic-router] Init failed, using all tools as fallback:", err);
    } finally {
      initPromise = null;
    }
  })();

  await initPromise;
}

// ─── Route ──────────────────────────────────────────────────

export async function routeTools(
  message: string,
  availableTools: readonly ExtendedAgentTool[],
): Promise<ExtendedAgentTool[]> {
  // Non-blocking lazy init: kick off in background, don't await
  if (!toolIndex && !initFailed && !initPromise) {
    void initSemanticRouter(availableTools.map((t) => t.name));
  }

  // Fallback: index not ready yet or provider failed
  if (!toolIndex || !embeddingProvider) {
    return [...availableTools];
  }

  // Few tools: no filtering needed
  if (availableTools.length <= TOP_K) {
    return [...availableTools];
  }

  // Embed the user query
  let queryVec: number[];
  try {
    queryVec = await embeddingProvider.embedQuery(message);
  } catch {
    return [...availableTools];
  }

  // Score each tool
  const scored: Array<{ name: string; score: number }> = [];
  for (const tool of availableTools) {
    const vec = toolIndex.get(tool.name);
    if (!vec) {
      // Unknown tool (not in index) — always include
      scored.push({ name: tool.name, score: Infinity });
    } else {
      scored.push({ name: tool.name, score: cosineSimilarity(queryVec, vec) });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Collect selected tool names
  const selected = new Set<string>();

  // 1. Base tools (if in availableTools)
  for (const name of BASE_TOOLS) {
    if (scored.some((s) => s.name === name)) {
      selected.add(name);
    }
  }

  // 2. Unindexed tools (score = Infinity)
  for (const s of scored) {
    if (s.score === Infinity) {
      selected.add(s.name);
    }
  }

  // 3. Fill remaining slots up to TOP_K with highest-scoring tools
  for (const s of scored) {
    if (selected.size >= TOP_K) break;
    if (s.score !== Infinity) {
      selected.add(s.name);
    }
  }

  // Return in original order
  return availableTools.filter((t) => selected.has(t.name));
}

// ─── Reset (for tests) ─────────────────────────────────────

export function resetSemanticRouter(): void {
  embeddingProvider = null;
  toolIndex = null;
  initPromise = null;
  initFailed = false;
}
