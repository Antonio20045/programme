import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatRouter } from "../cost-optimizer/heartbeat-router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSuccess(
  models: Array<{ name: string; size: number }> = [
    { name: "llama3.2:1b", size: 1_000_000 },
    { name: "gemma2:2b", size: 2_000_000 },
  ],
) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockFetchError() {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Connection refused"),
  );
}

function mockFetchTimeout() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 10);
      }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HeartbeatRouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor validation
  // -------------------------------------------------------------------------

  describe("constructor URL validation", () => {
    it("accepts http:// URLs", () => {
      expect(
        () => new HeartbeatRouter({ ollamaUrl: "http://127.0.0.1:11434" }),
      ).not.toThrow();
    });

    it("accepts https:// URLs", () => {
      expect(
        () => new HeartbeatRouter({ ollamaUrl: "https://ollama.example.com" }),
      ).not.toThrow();
    });

    it("rejects javascript: URLs", () => {
      expect(
        // eslint-disable-next-line no-script-url
        () => new HeartbeatRouter({ ollamaUrl: "javascript:alert(1)" }),
      ).toThrow("Only http:// and https:// are allowed");
    });

    it("rejects file: URLs", () => {
      expect(
        () => new HeartbeatRouter({ ollamaUrl: "file:///etc/passwd" }),
      ).toThrow("Only http:// and https:// are allowed");
    });
  });

  // -------------------------------------------------------------------------
  // detectOllama
  // -------------------------------------------------------------------------

  describe("detectOllama", () => {
    it("returns available=true with models on success", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter();
      const result = await router.detectOllama();

      expect(result.available).toBe(true);
      expect(result.models).toEqual(["llama3.2:1b", "gemma2:2b"]);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("sorts models by size (smallest first)", async () => {
      mockFetchSuccess([
        { name: "big-model", size: 10_000_000 },
        { name: "tiny-model", size: 500_000 },
        { name: "medium-model", size: 3_000_000 },
      ]);
      const router = new HeartbeatRouter();
      const result = await router.detectOllama();

      expect(result.models).toEqual([
        "tiny-model",
        "medium-model",
        "big-model",
      ]);
    });

    it("returns available=false on fetch error", async () => {
      mockFetchError();
      const router = new HeartbeatRouter();
      const result = await router.detectOllama();

      expect(result.available).toBe(false);
      expect(result.models).toEqual([]);
    });

    it("returns available=false on timeout", async () => {
      mockFetchTimeout();
      const router = new HeartbeatRouter();
      const result = await router.detectOllama();

      expect(result.available).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("caches result for subsequent calls", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter({ intervalMs: 60_000 });

      await router.detectOllama();
      await router.detectOllama();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after invalidateCache()", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter({ intervalMs: 60_000 });

      await router.detectOllama();
      router.invalidateCache();
      await router.detectOllama();

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("handles missing models array gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const router = new HeartbeatRouter();
      const result = await router.detectOllama();

      expect(result.available).toBe(true);
      expect(result.models).toEqual([]);
    });

    it("returns available=false on non-OK response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not Found", { status: 404 }),
      );
      const router = new HeartbeatRouter();
      const result = await router.detectOllama();

      expect(result.available).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getHeartbeatModel
  // -------------------------------------------------------------------------

  describe("getHeartbeatModel", () => {
    it("returns ollama model when Ollama is available", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter();
      const model = await router.getHeartbeatModel();

      expect(model).toBe("ollama/llama3.2:1b");
    });

    it("returns cloud fallback when Ollama is unavailable", async () => {
      mockFetchError();
      const router = new HeartbeatRouter();
      const model = await router.getHeartbeatModel();

      expect(model).toBe("claude-haiku-4-5-20251001");
    });

    it("prefers models from preferredLocalModels", async () => {
      mockFetchSuccess([
        { name: "llama3.2:1b", size: 1_000_000 },
        { name: "phi3:mini", size: 2_000_000 },
      ]);
      const router = new HeartbeatRouter({
        preferredLocalModels: ["phi3:mini"],
      });
      const model = await router.getHeartbeatModel();

      expect(model).toBe("ollama/phi3:mini");
    });

    it("falls back to smallest when preferred not available", async () => {
      mockFetchSuccess([
        { name: "llama3.2:1b", size: 1_000_000 },
        { name: "gemma2:2b", size: 2_000_000 },
      ]);
      const router = new HeartbeatRouter({
        preferredLocalModels: ["nonexistent-model"],
      });
      const model = await router.getHeartbeatModel();

      expect(model).toBe("ollama/llama3.2:1b");
    });

    it("returns cloud fallback when Ollama has no models", async () => {
      mockFetchSuccess([]);
      const router = new HeartbeatRouter();
      const model = await router.getHeartbeatModel();

      expect(model).toBe("claude-haiku-4-5-20251001");
    });
  });

  // -------------------------------------------------------------------------
  // isHeartbeatRequest
  // -------------------------------------------------------------------------

  describe("isHeartbeatRequest", () => {
    const router = new HeartbeatRouter();

    it.each([
      "HEARTBEAT",
      "ping",
      "[heartbeat]",
      "heartbeat_ok",
      "Health check. Respond OK.",
      "  HEARTBEAT  ",
      "Health check Respond OK",
    ])("returns true for '%s'", (msg) => {
      expect(router.isHeartbeatRequest(msg)).toBe(true);
    });

    it.each([
      "Hello",
      "What is a heartbeat?",
      "ping me back with details",
      "HEARTBEAT extra text",
      "run health check",
    ])("returns false for '%s'", (msg) => {
      expect(router.isHeartbeatRequest(msg)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // routeHeartbeat
  // -------------------------------------------------------------------------

  describe("routeHeartbeat", () => {
    it("routes heartbeat to Ollama when available", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter();
      const result = await router.routeHeartbeat("HEARTBEAT");

      expect(result.routed).toBe(true);
      expect(result.provider).toBe("ollama");
      expect(result.model).toMatch(/^ollama\//);
      expect(result.fallback).toBe(false);
    });

    it("routes heartbeat to cloud when Ollama unavailable", async () => {
      mockFetchError();
      const router = new HeartbeatRouter();
      const result = await router.routeHeartbeat("ping");

      expect(result.routed).toBe(true);
      expect(result.provider).toBe("cloud");
      expect(result.model).toBe("claude-haiku-4-5-20251001");
      expect(result.fallback).toBe(true);
    });

    it("does not route non-heartbeat messages", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter();
      const result = await router.routeHeartbeat("Hello, how are you?");

      expect(result.routed).toBe(false);
    });

    it("includes latencyMs in result", async () => {
      mockFetchSuccess();
      const router = new HeartbeatRouter();
      const result = await router.routeHeartbeat("HEARTBEAT");

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
