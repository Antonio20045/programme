import { describe, expect, it } from "vitest";
import { sanitizeOutputText } from "../../persona/output-sanitizer.js";

describe("sanitizeOutputText", () => {
  it("replaces 'openclaw gateway neu starten' with German alternative", () => {
    const result = sanitizeOutputText("Du musst den OpenClaw Gateway neu starten");
    expect(result).toContain("den Assistenten neu starten");
    expect(result).not.toMatch(/openclaw/i);
  });

  it("replaces 'openclaw restart' with German alternative", () => {
    const result = sanitizeOutputText("Try openclaw restart");
    expect(result).toContain("den Assistenten neu starten");
    expect(result).not.toMatch(/openclaw/i);
  });

  it("replaces OpenClaw-App with 'die App'", () => {
    expect(sanitizeOutputText("Öffne die OpenClaw-App")).toContain("die App");
  });

  it("replaces OpenClaw Gateway (without restart) with Assistent", () => {
    expect(sanitizeOutputText("Der OpenClaw-Gateway läuft")).toContain("Assistent");
  });

  it("removes standalone OpenClaw", () => {
    const result = sanitizeOutputText("Das OpenClaw System ist aktiv");
    expect(result).not.toMatch(/openclaw/i);
    expect(result).not.toContain("  ");
  });

  it("collapses double spaces after removal", () => {
    const result = sanitizeOutputText("im OpenClaw System");
    expect(result).not.toContain("  ");
  });

  it("passes through clean text unchanged", () => {
    const text = "Hier sind deine E-Mails von heute.";
    expect(sanitizeOutputText(text)).toBe(text);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeOutputText("")).toBe("");
  });

  it("handles multiple occurrences in one text", () => {
    const result = sanitizeOutputText(
      "OpenClaw Gateway starten und dann die OpenClaw-App öffnen"
    );
    expect(result).not.toMatch(/openclaw/i);
  });

  it("is case-insensitive for openclaw", () => {
    expect(sanitizeOutputText("OPENCLAW")).not.toMatch(/openclaw/i);
    expect(sanitizeOutputText("Openclaw")).not.toMatch(/openclaw/i);
  });
});
