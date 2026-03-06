import { describe, expect, it } from "vitest"
import { selectModel, detectMultiStep } from "../src/model-router.js"
import type { SelectModelContext } from "../src/model-router.js"

// ─── Helpers ──────────────────────────────────────────────────

function ctx(overrides: Partial<SelectModelContext> = {}): SelectModelContext {
  return { toolCount: 0, hasMultiStep: false, ...overrides }
}

// ─── selectModel ─────────────────────────────────────────────

describe("selectModel", () => {
  it("returns Haiku for simple messages", () => {
    expect(selectModel("Wie spät ist es?", ctx())).toBe("anthropic/claude-haiku-4-5")
  })

  it("returns Opus on /opus prefix", () => {
    expect(selectModel("/opus Analysiere die Codebase", ctx())).toBe("anthropic/claude-opus-4-6")
  })

  it("returns Opus on userOverride", () => {
    expect(selectModel("Analysiere alles", ctx({ userOverride: "opus" }))).toBe("anthropic/claude-opus-4-6")
  })

  it("returns Sonnet when >= 2 criteria met (analysis + multi-step)", () => {
    const result = selectModel(
      "Analysiere die Ergebnisse und dann fasse zusammen",
      ctx({ toolCount: 3, hasMultiStep: true }),
    )
    expect(result).toBe("anthropic/claude-sonnet-4-5")
  })

  it("returns Haiku when only 1 criterion met", () => {
    // Only analysis, no multi-step / no coding / no multi-tool
    expect(selectModel("Fasse das zusammen", ctx())).toBe("anthropic/claude-haiku-4-5")
  })
})

// ─── detectMultiStep ─────────────────────────────────────────

describe("detectMultiStep", () => {
  it("detects sequential connectors (DE)", () => {
    expect(detectMultiStep("Suche danach und dann fasse zusammen", [])).toBe(true)
  })

  it("detects sequential connectors (EN)", () => {
    expect(detectMultiStep("First search, then summarize the results", [])).toBe(true)
  })

  it("detects numbered list with 2+ items", () => {
    expect(detectMultiStep("1. Search files\n2. Summarize results", [])).toBe(true)
  })

  it("returns false for simple message without history", () => {
    expect(detectMultiStep("Wie spät ist es?", [])).toBe(false)
  })

  it("returns true when 2+ distinct tools in recent history", () => {
    expect(detectMultiStep("Hallo", ["web-search", "calendar"])).toBe(true)
  })

  it("returns false when only 1 tool in recent history", () => {
    expect(detectMultiStep("Hallo", ["web-search", "web-search"])).toBe(false)
  })
})
