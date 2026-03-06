// ---------------------------------------------------------------------------
// Cache Manager — prompt-cache strategy for static content blocks
// ---------------------------------------------------------------------------

import type { CacheConfig, CacheMetrics, ContentBlock } from "./types.js";
import { MODEL_PRICING } from "./types.js";

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  maxEntries: 500,
  ttlMs: 3_600_000,
};

/**
 * Blocks whose content rarely changes across turns.
 * These get `cache_control: { type: "ephemeral" }` for Anthropic prompt caching
 * (90% discount on cached input tokens).
 */
const STATIC_BLOCKS = new Set([
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "system_prompt",
  "tool_definitions",
]);

/**
 * Prefixes for blocks whose content changes per turn.
 * These never receive cache_control headers.
 */
const DYNAMIC_PREFIXES = [
  "memory/",
  "user_message",
  "tool_output",
  "tool_result",
];

interface NamedBlock {
  name: string;
  text: string;
}

export class CacheManager {
  private readonly config: CacheConfig;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    invalidations: 0,
    savedTokens: 0,
    savedCostUsd: 0,
  };

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Block classification
  // -------------------------------------------------------------------------

  /** Returns true if the block name identifies static (cacheable) content. */
  isStaticBlock(name: string): boolean {
    if (STATIC_BLOCKS.has(name)) return true;
    // Not a known static name — check if it matches a dynamic prefix
    for (const prefix of DYNAMIC_PREFIXES) {
      if (name.startsWith(prefix)) return false;
    }
    // Unknown blocks default to non-static (safer)
    return false;
  }

  // -------------------------------------------------------------------------
  // Cache header injection
  // -------------------------------------------------------------------------

  /**
   * Takes named content blocks and returns Anthropic-format ContentBlocks
   * with `cache_control` on static blocks (when caching is enabled).
   */
  buildCacheHeaders(blocks: readonly NamedBlock[]): ContentBlock[] {
    return blocks.map((block) => {
      const base: ContentBlock = { type: "text", text: block.text };
      if (this.config.enabled && this.isStaticBlock(block.name)) {
        base.cache_control = { type: "ephemeral" };
      }
      return base;
    });
  }

  // -------------------------------------------------------------------------
  // Block ordering
  // -------------------------------------------------------------------------

  /**
   * Reorders blocks so static blocks come first (maximises cache prefix hits).
   * Preserves relative order within each group.
   */
  optimizeBlockOrder(blocks: readonly NamedBlock[]): NamedBlock[] {
    const staticBlocks: NamedBlock[] = [];
    const dynamicBlocks: NamedBlock[] = [];
    for (const block of blocks) {
      if (this.isStaticBlock(block.name)) {
        staticBlocks.push(block);
      } else {
        dynamicBlocks.push(block);
      }
    }
    return [...staticBlocks, ...dynamicBlocks];
  }

  // -------------------------------------------------------------------------
  // Metrics tracking
  // -------------------------------------------------------------------------

  /** Record a cache hit and calculate savings based on model pricing. */
  recordHit(savedTokens: number, model: string): void {
    this.metrics.hits++;
    this.metrics.savedTokens += savedTokens;

    const pricing = MODEL_PRICING[model]; // eslint-disable-line security/detect-object-injection
    if (pricing) {
      const fullCost = (savedTokens * pricing.inputPer1MTokens) / 1_000_000;
      const cachedCost =
        (savedTokens * pricing.cachedPer1MTokens) / 1_000_000;
      this.metrics.savedCostUsd += fullCost - cachedCost;
    }
  }

  /** Record a cache miss. */
  recordMiss(): void {
    this.metrics.misses++;
  }

  /** Returns current metrics with computed hit rate. */
  getMetrics(): CacheMetrics & { hitRate: number } {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
    };
  }

  /** Reset all metrics to zero. */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      savedTokens: 0,
      savedCostUsd: 0,
    };
  }
}
