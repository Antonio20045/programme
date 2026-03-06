// ---------------------------------------------------------------------------
// Heartbeat Router — route heartbeat pings to free local Ollama
// ---------------------------------------------------------------------------

import type {
  HeartbeatConfig,
  HeartbeatRouteResult,
  OllamaDetectionResult,
} from "./types.js";

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 1_800_000, // 30 min
  ollamaUrl: "http://127.0.0.1:11434",
  preferredLocalModels: [],
};

const CLOUD_FALLBACK_MODEL = "claude-haiku-4-5-20251001";

/**
 * Heartbeat message detection pattern.
 * Matches: HEARTBEAT, ping, [heartbeat], heartbeat_ok, Health check. Respond OK.
 */
const HEARTBEAT_PATTERN =
  /^\s*(?:HEARTBEAT|ping|\[heartbeat\]|heartbeat_ok|Health check\.?\s*Respond OK\.?)\s*$/i;

/** Only http:// and https:// URLs are allowed. */
function validateUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      `Invalid Ollama URL: "${url}". Only http:// and https:// are allowed.`,
    );
  }
}

export class HeartbeatRouter {
  private readonly config: HeartbeatConfig;
  private cachedResult: OllamaDetectionResult | null = null;
  private cacheTimestamp = 0;

  constructor(config?: Partial<HeartbeatConfig>) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
    validateUrl(this.config.ollamaUrl);
  }

  // -------------------------------------------------------------------------
  // Ollama detection (lazy-cached)
  // -------------------------------------------------------------------------

  /**
   * Detect available Ollama models. Result is cached for `intervalMs`.
   * On error/timeout: returns `{ available: false }`.
   */
  async detectOllama(): Promise<OllamaDetectionResult> {
    const now = Date.now();
    if (
      this.cachedResult !== null &&
      now - this.cacheTimestamp < this.config.intervalMs
    ) {
      return this.cachedResult;
    }

    const start = performance.now();
    try {
      const response = await fetch(
        `${this.config.ollamaUrl}/api/tags`,
        { signal: AbortSignal.timeout(5_000) },
      );

      if (!response.ok) {
        const latencyMs = performance.now() - start;
        this.cachedResult = { available: false, models: [], latencyMs };
        this.cacheTimestamp = now;
        return this.cachedResult;
      }

      const data = (await response.json()) as {
        models?: Array<{ name: string; size: number }>;
      };
      const models = (data.models ?? [])
        .sort((a, b) => a.size - b.size)
        .map((m) => m.name);

      const latencyMs = performance.now() - start;
      this.cachedResult = { available: true, models, latencyMs };
      this.cacheTimestamp = now;
      return this.cachedResult;
    } catch {
      const latencyMs = performance.now() - start;
      this.cachedResult = { available: false, models: [], latencyMs };
      this.cacheTimestamp = now;
      return this.cachedResult;
    }
  }

  // -------------------------------------------------------------------------
  // Model selection
  // -------------------------------------------------------------------------

  /**
   * Returns the best model for heartbeat requests.
   * Prefers local Ollama (free) → falls back to cloud Haiku.
   */
  async getHeartbeatModel(): Promise<string> {
    const detection = await this.detectOllama();
    if (!detection.available || detection.models.length === 0) {
      return CLOUD_FALLBACK_MODEL;
    }

    // Prefer a model from the preferred list if available
    for (const preferred of this.config.preferredLocalModels) {
      if (detection.models.includes(preferred)) {
        return `ollama/${preferred}`;
      }
    }

    // Fall back to smallest model (list is already sorted by size)
    return `ollama/${detection.models[0]!}`;
  }

  // -------------------------------------------------------------------------
  // Heartbeat detection
  // -------------------------------------------------------------------------

  /** Returns true if the message is a heartbeat/ping request. */
  isHeartbeatRequest(message: string): boolean {
    return HEARTBEAT_PATTERN.test(message);
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  /** Route a heartbeat message to the appropriate model. */
  async routeHeartbeat(message: string): Promise<HeartbeatRouteResult> {
    if (!this.isHeartbeatRequest(message)) {
      return {
        routed: false,
        model: CLOUD_FALLBACK_MODEL,
        provider: "cloud",
        latencyMs: 0,
        fallback: false,
      };
    }

    const start = performance.now();
    const model = await this.getHeartbeatModel();
    const latencyMs = performance.now() - start;
    const isOllama = model.startsWith("ollama/");

    return {
      routed: true,
      model,
      provider: isOllama ? "ollama" : "cloud",
      latencyMs,
      fallback: !isOllama,
    };
  }

  // -------------------------------------------------------------------------
  // Cache management
  // -------------------------------------------------------------------------

  /** Force re-detection on next call. */
  invalidateCache(): void {
    this.cachedResult = null;
    this.cacheTimestamp = 0;
  }
}
