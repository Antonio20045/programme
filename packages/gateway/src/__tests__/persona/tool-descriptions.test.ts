import { vi, describe, expect, it } from "vitest";
import { getToolPersona, buildToolDescriptionHints } from "../../persona/tool-descriptions.js";
import { containsTechnicalTerms } from "../../persona/blocklist.js";

describe("getToolPersona", () => {
  const KNOWN_TOOLS = [
    "calculator", "translator", "datetime", "json-tools", "crypto-tools",
    "data-transform", "code-runner", "url-tools", "web-search", "news-feed",
    "weather", "image-gen", "summarizer", "diagram", "archive", "http-client",
    "knowledge", "youtube", "pdf-tools", "gmail", "calendar", "google-contacts",
    "google-tasks", "google-drive", "google-docs", "google-sheets", "whatsapp",
    "scheduler", "browser", "shell", "system-info", "clipboard", "screenshot",
    "git-tools", "app-launcher", "media-control", "image-tools", "ocr",
    "filesystem", "notes", "reminders", "delegate", "create-agent",
    "connect-google",
  ];

  it("returns a persona for every known tool", () => {
    for (const name of KNOWN_TOOLS) {
      const persona = getToolPersona(name);
      expect(persona.description).toBeTruthy();
    }
  });

  it("all descriptions are in first person (start with 'Ich')", () => {
    for (const name of KNOWN_TOOLS) {
      const persona = getToolPersona(name);
      expect(persona.description).toMatch(/^Ich /);
    }
  });

  it("no description contains blocklist terms", () => {
    for (const name of KNOWN_TOOLS) {
      const persona = getToolPersona(name);
      const matches = containsTechnicalTerms(persona.description);
      expect(matches, `Tool "${name}" description leaks: ${matches.join(", ")}`).toEqual([]);
    }
  });

  it("returns generic persona + warns for unknown tool", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const persona = getToolPersona("nonexistent-tool-xyz");
    expect(persona.description).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nonexistent-tool-xyz"));
    warnSpy.mockRestore();
  });
});

describe("buildToolDescriptionHints", () => {
  it("returns header even with empty tool list", () => {
    const hints = buildToolDescriptionHints([]);
    expect(hints).toContain("## Werkzeuge");
    expect(hints).not.toContain("- calculator:");
  });

  it("only includes tools from the available list", () => {
    const hints = buildToolDescriptionHints(["calculator", "gmail"]);
    expect(hints).toContain("- calculator:");
    expect(hints).toContain("- gmail:");
    expect(hints).not.toContain("- browser:");
    expect(hints).not.toContain("- delegate:");
  });

  it("ignores unknown tool names", () => {
    const hints = buildToolDescriptionHints(["calculator", "nonexistent-xyz"]);
    expect(hints).toContain("- calculator:");
    expect(hints).not.toContain("nonexistent-xyz");
  });

  it("contains entries for all known tools when all are passed", () => {
    const allTools = [
      "calculator", "translator", "datetime", "gmail", "calendar", "delegate",
    ];
    const hints = buildToolDescriptionHints(allTools);
    expect(hints).toContain("- calculator:");
    expect(hints).toContain("- gmail:");
    expect(hints).toContain("- delegate:");
  });
});
