import { describe, expect, it } from "vitest";
import { sanitizePromptText } from "../../persona/prompt-sanitizer.js";

describe("sanitizePromptText", () => {
  it("replaces OAuth with Anmeldung", () => {
    expect(sanitizePromptText("Uses OAuth for login")).toContain("Anmeldung");
    expect(sanitizePromptText("Uses OAuth for login")).not.toContain("OAuth");
  });

  it("replaces API with Schnittstelle", () => {
    expect(sanitizePromptText("Call the API")).toContain("Schnittstelle");
  });

  it("replaces Token with Zugang", () => {
    expect(sanitizePromptText("Refresh the Token")).toContain("Zugang");
  });

  it("replaces Webhook with Benachrichtigung", () => {
    expect(sanitizePromptText("Setup a Webhook")).toContain("Benachrichtigung");
  });

  it("replaces Provider with Anbieter", () => {
    expect(sanitizePromptText("The Provider is Google")).toContain("Anbieter");
  });

  it("replaces Config with Einstellung", () => {
    expect(sanitizePromptText("Check the Config file")).toContain("Einstellung");
  });

  it("passes through unknown text unchanged", () => {
    const text = "Guten Morgen, wie kann ich helfen?";
    expect(sanitizePromptText(text)).toBe(text);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizePromptText("")).toBe("");
  });

  it("handles multiple replacements in one text", () => {
    const result = sanitizePromptText("The API uses OAuth Tokens from the Provider");
    expect(result).not.toContain("API");
    expect(result).not.toContain("OAuth");
    expect(result).not.toContain("Token");
    expect(result).not.toContain("Provider");
  });
});
