import { describe, expect, it } from "vitest";
import { containsTechnicalTerms } from "../../persona/blocklist.js";

describe("containsTechnicalTerms", () => {
  it("returns empty for empty text", () => {
    expect(containsTechnicalTerms("")).toEqual([]);
  });

  it("returns empty for clean text", () => {
    expect(containsTechnicalTerms("Hallo, wie geht es dir?")).toEqual([]);
  });

  it("detects blocked terms", () => {
    const matches = containsTechnicalTerms("The gateway uses OAuth tokens");
    expect(matches).toContain("gateway");
    expect(matches).toContain("oauth");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("detects terms case-insensitively", () => {
    const matches = containsTechnicalTerms("The GATEWAY is running");
    expect(matches).toContain("gateway");
  });

  it("detects underscore terms like tool_call", () => {
    const matches = containsTechnicalTerms("Got a tool_call response");
    expect(matches).toContain("tool_call");
  });

  it("detects stack traces", () => {
    const matches = containsTechnicalTerms("Error at doStuff (/app/src/index.ts:42:13)");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("detects file paths", () => {
    const matches = containsTechnicalTerms("Failed to load ./src/config.ts properly");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("detects system error codes", () => {
    const matches = containsTechnicalTerms("ECONNREFUSED on port 3000");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("detects ENV variables", () => {
    const matches = containsTechnicalTerms("Missing GOOGLE_CLIENT_ID=abc123");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("detects module specifiers", () => {
    const matches = containsTechnicalTerms("Cannot find @ki-assistent/tools");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does not false-positive on normal German words", () => {
    const matches = containsTechnicalTerms("Dein Termin ist morgen um 10 Uhr");
    expect(matches).toEqual([]);
  });
});
