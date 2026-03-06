import { describe, expect, it } from "vitest";
import { transformError } from "../../persona/error-transformer.js";

describe("transformError", () => {
  it("returns generic fallback for empty string", () => {
    expect(transformError("")).toBe("Das hat leider nicht funktioniert.");
  });

  it("returns generic fallback for whitespace-only string", () => {
    expect(transformError("   ")).toBe("Das hat leider nicht funktioniert.");
  });

  it("transforms ECONNREFUSED", () => {
    expect(transformError("connect ECONNREFUSED 127.0.0.1:5432")).toBe(
      "Der Dienst ist gerade nicht erreichbar.",
    );
  });

  it("transforms ETIMEDOUT", () => {
    expect(transformError("connect ETIMEDOUT 10.0.0.1:443")).toBe(
      "Die Anfrage hat zu lange gedauert.",
    );
  });

  it("transforms ENOENT", () => {
    expect(transformError("ENOENT: no such file or directory")).toBe(
      "Die Datei wurde nicht gefunden.",
    );
  });

  it("transforms 401 unauthorized", () => {
    expect(transformError("Request failed with status 401")).toBe(
      "Zugriff nicht erlaubt.",
    );
  });

  it("transforms 429 rate limit", () => {
    expect(transformError("Too many requests (429)")).toBe(
      "Zu viele Anfragen. Bitte kurz warten.",
    );
  });

  it("transforms 5xx errors", () => {
    expect(transformError("Internal server error 500")).toBe(
      "Der Dienst hat einen Fehler gemeldet.",
    );
  });

  it("transforms token expired", () => {
    expect(transformError("Error: invalid grant")).toBe(
      "Die Anmeldung ist abgelaufen. Bitte erneut verbinden.",
    );
  });

  it("transforms desktop agent disconnected", () => {
    expect(transformError("Desktop Agent disconnected")).toBe(
      "Die Verbindung zum Desktop wurde unterbrochen.",
    );
  });

  it("strips stack traces from unknown errors", () => {
    const error = "Something went wrong at doStuff (/app/src/index.ts:42:13)";
    const result = transformError(error);
    expect(result).not.toContain("/app/src/index.ts");
    expect(result).not.toContain("at doStuff");
  });

  it("strips file paths from unknown errors", () => {
    const error = "Failed to read /etc/config/settings.json";
    const result = transformError(error);
    expect(result).not.toContain("/etc/config/settings.json");
  });

  it("passes through already-German messages", () => {
    const msg = "Die Aktion wurde abgebrochen";
    expect(transformError(msg)).toBe(msg);
  });
});
