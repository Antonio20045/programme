import { describe, expect, it, vi } from "vitest";
import { applyToolPersonas } from "../../persona/tool-persona-overlay.js";
import type { ExtendedAgentTool } from "../../../../tools/src/types.js";

function makeTool(overrides: Partial<ExtendedAgentTool> = {}): ExtendedAgentTool {
  return {
    name: "calculator",
    description: "Calculator tool — arithmetic expressions, unit conversion",
    parameters: {
      type: "object" as const,
      properties: {
        expression: { type: "string" as const, description: "The math expression" },
      },
      required: ["expression"],
    },
    permissions: [],
    requiresConfirmation: false,
    runsOn: "server",
    execute: vi.fn(),
    ...overrides,
  };
}

describe("applyToolPersonas", () => {
  it("returns empty array for empty input", () => {
    expect(applyToolPersonas([])).toEqual([]);
  });

  it("preserves tool name", () => {
    const result = applyToolPersonas([makeTool()]);
    expect(result[0]!.name).toBe("calculator");
  });

  it("preserves execute function reference", () => {
    const tool = makeTool();
    const result = applyToolPersonas([tool]);
    expect(result[0]!.execute).toBe(tool.execute);
  });

  it("replaces description with persona", () => {
    const tool = makeTool();
    const result = applyToolPersonas([tool]);
    expect(result[0]!.description).not.toBe(tool.description);
    expect(result[0]!.description).toContain("Ich kann");
  });

  it("replaces parameter descriptions when paramOverrides exist", () => {
    const tool = makeTool({
      name: "gmail",
      parameters: {
        type: "object" as const,
        properties: {
          action: { type: "string" as const, description: "The action to perform" },
        },
        required: ["action"],
      },
    });
    const result = applyToolPersonas([tool]);
    expect(result[0]!.parameters.properties["action"]!.description).not.toBe(
      "The action to perform",
    );
  });

  it("does not mutate the original tool", () => {
    const tool = makeTool();
    const originalDesc = tool.description;
    applyToolPersonas([tool]);
    expect(tool.description).toBe(originalDesc);
  });

  it("handles unknown tools with generic description", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tool = makeTool({ name: "unknown-thing" });
    const result = applyToolPersonas([tool]);
    expect(result[0]!.description).toBeTruthy();
    warnSpy.mockRestore();
  });
});
