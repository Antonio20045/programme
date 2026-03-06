import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock pi-ai and pi-coding-agent before importing the adapter
vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => {
  const MockAuthStorage = vi.fn();
  const MockModelRegistry = vi.fn(() => ({
    find: vi.fn(),
    getApiKey: vi.fn(),
  }));
  return { AuthStorage: MockAuthStorage, ModelRegistry: MockModelRegistry };
});

vi.mock("../agents/pi-model-discovery.js", () => ({
  discoverAuthStorage: vi.fn(() => ({})),
  discoverModels: vi.fn(() => ({
    find: vi.fn(),
    getApiKey: vi.fn(),
  })),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
}));

vi.mock("../agents/workspace.js", () => ({
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/test-workspace"),
  resolveDefaultAgentWorkspaceDir: vi.fn(() => "/tmp/default-workspace"),
}));

import { createLlmClient, _resetRegistryCache } from "../llm-client-adapter.js";
import { completeSimple } from "@mariozechner/pi-ai";
import { discoverModels } from "../agents/pi-model-discovery.js";

const mockCompleteSimple = vi.mocked(completeSimple);
const mockDiscoverModels = vi.mocked(discoverModels);

function makeMockRegistry(overrides?: {
  find?: ReturnType<typeof vi.fn>;
  getApiKey?: ReturnType<typeof vi.fn>;
}) {
  return {
    find: overrides?.find ?? vi.fn(() => ({ id: "test-model", provider: "google" })),
    getApiKey: overrides?.getApiKey ?? vi.fn(async () => "test-key"),
  };
}

describe("createLlmClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistryCache();
    mockDiscoverModels.mockReturnValue(makeMockRegistry() as never);
  });

  it("returns an object with a chat method", () => {
    const client = createLlmClient();
    expect(client).toBeDefined();
    expect(typeof client.chat).toBe("function");
  });

  it("throws when model is not found in registry", async () => {
    mockDiscoverModels.mockReturnValue(
      makeMockRegistry({ find: vi.fn(() => undefined) }) as never,
    );

    // Force fresh registry by creating new client in fresh module context
    // Since the registry is cached, we test with a provider/model combo
    const client = createLlmClient();
    await expect(
      client.chat({
        provider: "nonexistent",
        model: "nonexistent-model",
        system: "test",
        messages: [],
        tools: [],
        max_tokens: 100,
      }),
    ).rejects.toThrow("Model not found");
  });

  it("throws when no API key is available", async () => {
    mockDiscoverModels.mockReturnValue(
      makeMockRegistry({
        find: vi.fn(() => ({ id: "test", provider: "google" })),
        getApiKey: vi.fn(async () => undefined),
      }) as never,
    );

    const client = createLlmClient();
    await expect(
      client.chat({
        provider: "google",
        model: "test",
        system: "test",
        messages: [],
        tools: [],
        max_tokens: 100,
      }),
    ).rejects.toThrow("No API key");
  });

  it("converts stop_reason correctly from pi-ai response", async () => {
    const registry = makeMockRegistry();
    mockDiscoverModels.mockReturnValue(registry as never);

    mockCompleteSimple.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      stopReason: "stop",
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: "google-generative-ai",
      provider: "google",
      model: "test-model",
      timestamp: Date.now(),
    });

    const client = createLlmClient();
    const result = await client.chat({
      provider: "google",
      model: "test-model",
      system: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      max_tokens: 1000,
    });

    expect(result.stop_reason).toBe("end_turn");
    expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("maps toolUse stop reason to tool_use", async () => {
    const registry = makeMockRegistry();
    mockDiscoverModels.mockReturnValue(registry as never);

    mockCompleteSimple.mockResolvedValue({
      role: "assistant",
      content: [
        { type: "text", text: "Let me search" },
        { type: "tool_call", id: "tc-1", name: "web-search", arguments: '{"query":"test"}' },
      ],
      stopReason: "toolUse",
      usage: { input: 20, output: 15, cacheRead: 0, cacheWrite: 0, totalTokens: 35, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: "google-generative-ai",
      provider: "google",
      model: "test-model",
      timestamp: Date.now(),
    } as never);

    const client = createLlmClient();
    const result = await client.chat({
      provider: "google",
      model: "test-model",
      system: "test",
      messages: [{ role: "user", content: "search something" }],
      tools: [{ name: "web-search", description: "Search the web", input_schema: { type: "object", properties: { query: { type: "string" } } } }],
      max_tokens: 1000,
    });

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "tc-1",
      name: "web-search",
      input: { query: "test" },
    });
  });

  it("maps length stop reason to max_tokens", async () => {
    const registry = makeMockRegistry();
    mockDiscoverModels.mockReturnValue(registry as never);

    mockCompleteSimple.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "Truncated..." }],
      stopReason: "length",
      usage: { input: 10, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: "google-generative-ai",
      provider: "google",
      model: "test-model",
      timestamp: Date.now(),
    });

    const client = createLlmClient();
    const result = await client.chat({
      provider: "google",
      model: "test-model",
      system: "test",
      messages: [{ role: "user", content: "Write a very long essay" }],
      tools: [],
      max_tokens: 100,
    });

    expect(result.stop_reason).toBe("max_tokens");
  });

  it("passes tools to completeSimple with correct schema mapping", async () => {
    const registry = makeMockRegistry();
    mockDiscoverModels.mockReturnValue(registry as never);

    mockCompleteSimple.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      stopReason: "stop",
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: "google-generative-ai",
      provider: "google",
      model: "test-model",
      timestamp: Date.now(),
    });

    const client = createLlmClient();
    await client.chat({
      provider: "google",
      model: "test-model",
      system: "test",
      messages: [{ role: "user", content: "test" }],
      tools: [{
        name: "my-tool",
        description: "A tool",
        input_schema: { type: "object", properties: { arg: { type: "string" } } },
      }],
      max_tokens: 500,
    });

    expect(mockCompleteSimple).toHaveBeenCalledTimes(1);
    const [, context, options] = mockCompleteSimple.mock.calls[0]!;
    expect(context.systemPrompt).toBe("test");
    expect(context.tools).toEqual([{
      name: "my-tool",
      description: "A tool",
      parameters: { type: "object", properties: { arg: { type: "string" } } },
    }]);
    expect(options).toEqual(expect.objectContaining({ apiKey: "test-key", maxTokens: 500 }));
  });

  it("converts multi-turn messages with tool results", async () => {
    const registry = makeMockRegistry();
    mockDiscoverModels.mockReturnValue(registry as never);

    mockCompleteSimple.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "Result processed" }],
      stopReason: "stop",
      usage: { input: 30, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 40, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      api: "google-generative-ai",
      provider: "google",
      model: "test-model",
      timestamp: Date.now(),
    });

    const client = createLlmClient();
    await client.chat({
      provider: "google",
      model: "test-model",
      system: "test",
      messages: [
        { role: "user", content: "search for something" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Searching..." },
            { type: "tool_use", id: "tc-1", name: "search", input: { q: "test" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-1", content: "Found: result" },
          ],
        },
      ],
      tools: [],
      max_tokens: 500,
    });

    expect(mockCompleteSimple).toHaveBeenCalledTimes(1);
    const [, context] = mockCompleteSimple.mock.calls[0]!;
    expect(context.messages).toHaveLength(3);
    // Tool result message
    const toolResultMsg = context.messages[2]!;
    expect(toolResultMsg.role).toBe("user");
    expect(Array.isArray(toolResultMsg.content)).toBe(true);
  });
});
