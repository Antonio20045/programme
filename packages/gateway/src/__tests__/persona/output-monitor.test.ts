import { describe, expect, it } from "vitest";
import { monitorOutput } from "../../persona/output-monitor.js";

describe("monitorOutput", () => {
  it("returns empty for clean text", () => {
    expect(monitorOutput("Das Wetter morgen ist sonnig.")).toEqual([]);
  });

  it("returns matches for text with technical terms", () => {
    const matches = monitorOutput("The gateway returned an oauth error");
    expect(matches).toContain("gateway");
    expect(matches).toContain("oauth");
  });

  it("does not modify the input text", () => {
    const text = "The gateway uses oauth tokens";
    const copy = text;
    monitorOutput(text);
    expect(text).toBe(copy);
  });

  it("returns empty for empty string", () => {
    expect(monitorOutput("")).toEqual([]);
  });

  it("detects technical patterns like file paths", () => {
    const matches = monitorOutput("Error in ./src/main.ts file");
    expect(matches.length).toBeGreaterThan(0);
  });
});
