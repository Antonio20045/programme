/**
 * Tests for Sub-Agent tool registration in createUserTools.
 *
 * The base createUserTools tests (notes, reminders, gmail, calendar) live in
 * src/__tests__/tool-factory.test.ts. This file covers the llmClient-based
 * agent tools (delegate + agent-factory).
 */

import { vi, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be before import
// ---------------------------------------------------------------------------

vi.mock("../src/database/crypto.js", () => ({
  decryptToken: vi.fn((enc: string) => `decrypted-${enc}`),
  encryptToken: vi.fn((plain: string) => `encrypted-${plain}`),
}));

const mockGetProvider = vi.fn();
vi.mock("../src/database/oauth-providers.js", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}));

// Mock delegate-tool and agent-factory
const mockDelegateTool = {
  name: "delegate",
  description: "Delegate tasks to sub-agents",
  parameters: { type: "object" as const, properties: {}, required: [] },
  permissions: [],
  requiresConfirmation: true,
  runsOn: "server" as const,
  defaultRiskTier: 2 as const,
  execute: vi.fn(),
};

const mockAgentFactoryTool = {
  name: "create-agent",
  description: "Create a new sub-agent",
  parameters: { type: "object" as const, properties: {}, required: [] },
  permissions: [],
  requiresConfirmation: true,
  runsOn: "server" as const,
  defaultRiskTier: 2 as const,
  execute: vi.fn(),
};

vi.mock("../../tools/src/delegate-tool.js", () => ({
  createDelegateTool: vi.fn(() => mockDelegateTool),
}));

vi.mock("../../tools/src/agent-factory.js", () => ({
  createAgentFactoryTool: vi.fn(() => mockAgentFactoryTool),
}));

import { createUserTools } from "../src/tool-factory.js";
import { createDelegateTool } from "../../tools/src/delegate-tool.js";
import { createAgentFactoryTool } from "../../tools/src/agent-factory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
const mockPool = { query: mockQuery };
const USER_ID = "user-agent-test";

const mockLlmClient = {
  chat: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProvider.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createUserTools — agent tools", () => {
  it("does NOT include delegate/agent-factory without llmClient", async () => {
    const tools = await createUserTools(USER_ID, mockPool);
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("delegate");
    expect(names).not.toContain("create-agent");
    expect(createDelegateTool).not.toHaveBeenCalled();
    expect(createAgentFactoryTool).not.toHaveBeenCalled();
  });

  it("includes delegate and agent-factory when llmClient is provided", async () => {
    const tools = await createUserTools(USER_ID, mockPool, mockLlmClient);
    const names = tools.map((t) => t.name);

    expect(names).toContain("delegate");
    expect(names).toContain("create-agent");
  });

  it("passes correct arguments to createDelegateTool", async () => {
    await createUserTools(USER_ID, mockPool, mockLlmClient);

    expect(createDelegateTool).toHaveBeenCalledWith(USER_ID, mockPool, mockLlmClient);
  });

  it("passes correct arguments to createAgentFactoryTool", async () => {
    await createUserTools(USER_ID, mockPool, mockLlmClient);

    expect(createAgentFactoryTool).toHaveBeenCalledWith(USER_ID, mockPool);
  });

  it("agent tools come after base tools", async () => {
    const tools = await createUserTools(USER_ID, mockPool, mockLlmClient);
    const names = tools.map((t) => t.name);

    // Base tools first
    expect(names.indexOf("notes")).toBeLessThan(names.indexOf("delegate"));
    expect(names.indexOf("reminders")).toBeLessThan(names.indexOf("delegate"));
  });

  it("base tools still present with llmClient", async () => {
    const tools = await createUserTools(USER_ID, mockPool, mockLlmClient);
    const names = tools.map((t) => t.name);

    expect(names).toContain("notes");
    expect(names).toContain("reminders");
  });
});
