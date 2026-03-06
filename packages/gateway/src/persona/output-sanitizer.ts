/**
 * Sanitizes LLM output text by replacing internal/technical terms
 * that should not be visible to the end user.
 *
 * Applied to SSE token events and done events BEFORE they reach the client.
 * DB writes keep raw text for debugging/analytics.
 */

// ─── Replacement Map ─────────────────────────────────────────
// Order matters: compound phrases first (longest match), then standalone.

const OUTPUT_REPLACEMENTS: readonly [RegExp, string][] = [
  // Compound phrases first
  [/openclaw\s+gateway\s+(?:neu\s*starten|restart)/gi, 'den Assistenten neu starten'],
  [/openclaw\s+(?:neu\s*starten|restart)/gi, 'den Assistenten neu starten'],
  [/OpenClaw[.-]?[Aa]pp/gi, 'die App'],
  [/OpenClaw[-\s]?Gateway/gi, 'Assistent'],
  // Standalone
  [/\bOpenClaw\b/gi, ''],
  [/\bopenclaw\b/g, ''],
  // Cleanup: collapse double spaces from removals
  [/ {2,}/g, ' '],
]

// ─── Public API ──────────────────────────────────────────────

/**
 * Replace internal product names in output text with user-facing alternatives.
 * Returns the sanitized text. Empty/falsy input passes through unchanged.
 */
export function sanitizeOutputText(text: string): string {
  if (!text) return text

  let result = text
  for (const [pattern, replacement] of OUTPUT_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }

  return result
}
