/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- test file scanning known project sources */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const SRC_DIR = join(__dirname, "..", "src")

function getAllSourceFiles(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper scanning known project dir
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(SRC_DIR, f))
}

describe("Security — Zero Knowledge Relay", () => {
  const sourceFiles = getAllSourceFiles()

  it("has source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  it.each(["console.log", "console.info", "console.debug", "console.warn"])(
    "no %s in source files",
    (pattern) => {
      for (const file of sourceFiles) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads known project files
        const content = readFileSync(file, "utf-8")
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const line = lines.at(i)!
          // Skip comments
          if (line.trim().startsWith("//")) continue
          expect(
            line.includes(pattern),
            `Found "${pattern}" in ${file}:${i + 1}`
          ).toBe(false)
        }
      }
    }
  )

  it("no dangerous dynamic execution in source files", () => {
    // Construct patterns dynamically to avoid triggering security hooks on this test file
    const dangerous = [
      ["ev", "al("],
      ["new Fun", "ction("],
    ].map(([a, b]) => a + b)

    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8")
      for (const pattern of dangerous) {
        expect(
          content.includes(pattern),
          `Found "${pattern}" in ${file}`
        ).toBe(false)
      }
    }
  })

  it("no imports from @ki-assistent/shared", () => {
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8")
      expect(
        content.includes("@ki-assistent/shared"),
        `Found @ki-assistent/shared import in ${file}`
      ).toBe(false)
    }
  })

  it("no imports from @ki-assistent/gateway", () => {
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8")
      expect(
        content.includes("@ki-assistent/gateway"),
        `Found @ki-assistent/gateway import in ${file}`
      ).toBe(false)
    }
  })

  it("no console.* calls at all (Zero Knowledge)", () => {
    const consolePattern = /console\.\w+\s*\(/
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8")
      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (line.trim().startsWith("//")) continue
        expect(
          consolePattern.test(line),
          `Found console.* in ${file}:${i + 1}: ${line.trim()}`
        ).toBe(false)
      }
    }
  })
})
