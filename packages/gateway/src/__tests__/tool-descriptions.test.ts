import { describe, expect, it } from "vitest";
import {
  buildToolDescriptionHints,
  getToolPersona,
} from "../persona/tool-descriptions.js";

// ---------------------------------------------------------------------------
// getToolPersona
// ---------------------------------------------------------------------------

describe("getToolPersona", () => {
  it("returns persona for known tool", () => {
    const persona = getToolPersona("gmail");
    expect(persona.description).toContain("Ich");
    expect(persona.description).toContain("E-Mail");
  });

  it("returns generic persona for unknown tool", () => {
    const persona = getToolPersona("nonexistent-tool-xyz");
    expect(persona.description).toBe("Ich kann dir bei dieser Aufgabe helfen.");
  });

  it("all personas start with 'Ich'", () => {
    const knownTools = [
      "calculator", "translator", "datetime", "json-tools", "crypto-tools",
      "web-search", "gmail", "calendar", "browser", "app-launcher",
      "filesystem", "shell", "notes", "reminders", "delegate", "create-agent",
    ];
    for (const tool of knownTools) {
      const persona = getToolPersona(tool);
      expect(persona.description).toMatch(/^Ich /);
    }
  });

  // ── Disambiguation descriptions ──

  it("app-launcher mentions Desktop-Apps and excludes browser domain", () => {
    const p = getToolPersona("app-launcher");
    expect(p.description).toContain("Desktop-App");
    expect(p.description).toContain("browser");
  });

  it("browser mentions Webseiten and excludes app-launcher domain", () => {
    const p = getToolPersona("browser");
    expect(p.description).toContain("Webseiten");
    expect(p.description).toContain("app-launcher");
  });

  it("gmail mentions IMMER for email queries", () => {
    const p = getToolPersona("gmail");
    expect(p.description).toContain("IMMER");
    expect(p.description).toContain("Posteingang");
  });

  it("calendar mentions IMMER for schedule queries", () => {
    const p = getToolPersona("calendar");
    expect(p.description).toContain("IMMER");
    expect(p.description).toContain("Termin");
  });

  it("web-search excludes email and calendar domains", () => {
    const p = getToolPersona("web-search");
    expect(p.description).toContain("Wissensfragen");
    expect(p.description).toContain("Nicht fuer E-Mails");
  });
});

// ---------------------------------------------------------------------------
// buildToolDescriptionHints
// ---------------------------------------------------------------------------

describe("buildToolDescriptionHints", () => {
  it("includes only available tools", () => {
    const hints = buildToolDescriptionHints(["gmail", "calendar"]);
    expect(hints).toContain("gmail:");
    expect(hints).toContain("calendar:");
    expect(hints).not.toContain("browser:");
    expect(hints).not.toContain("app-launcher:");
  });

  it("starts with Werkzeuge header", () => {
    const hints = buildToolDescriptionHints(["calculator"]);
    expect(hints).toMatch(/^## Werkzeuge/);
  });

  it("returns empty list section when no tools match", () => {
    const hints = buildToolDescriptionHints(["unknown-tool"]);
    expect(hints).toContain("## Werkzeuge");
    expect(hints).not.toContain("- unknown-tool:");
  });

  // ── Routing rules ──

  it("adds Werkzeugauswahl block when app-launcher and browser are available", () => {
    const hints = buildToolDescriptionHints(["app-launcher", "browser"]);
    expect(hints).toContain("## Werkzeugauswahl");
    expect(hints).toContain("app-launcher");
    expect(hints).toContain("browser");
  });

  it("adds gmail routing rule when gmail is available", () => {
    const hints = buildToolDescriptionHints(["gmail"]);
    expect(hints).toContain("Werkzeugauswahl");
    expect(hints).toContain("gmail");
  });

  it("adds calendar routing rule when calendar is available", () => {
    const hints = buildToolDescriptionHints(["calendar"]);
    expect(hints).toContain("Werkzeugauswahl");
    expect(hints).toContain("calendar");
  });

  it("adds web-search/browser routing rule when both are available", () => {
    const hints = buildToolDescriptionHints(["web-search", "browser"]);
    expect(hints).toContain("Werkzeugauswahl");
    expect(hints).toContain("web-search");
    expect(hints).toContain("browser");
  });

  it("omits Werkzeugauswahl when no routing-relevant tools are available", () => {
    const hints = buildToolDescriptionHints(["calculator", "translator"]);
    expect(hints).not.toContain("Werkzeugauswahl");
  });
});
