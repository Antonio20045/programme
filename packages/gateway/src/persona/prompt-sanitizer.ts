/**
 * Sanitizes system prompt text by replacing technical terms
 * with human-friendly German alternatives.
 */

// ─── Replacement Map ─────────────────────────────────────────

const REPLACEMENTS: readonly [RegExp, string][] = [
  [/\bOAuth\b/gi, 'Anmeldung'],
  [/\bAPI\b/g, 'Schnittstelle'],
  [/\bAPIs\b/g, 'Schnittstellen'],
  [/\bToken\b/gi, 'Zugang'],
  [/\bTokens\b/gi, 'Zugaenge'],
  [/\bWebhook(?:s)?\b/gi, 'Benachrichtigung'],
  [/\bEndpoint(?:s)?\b/gi, 'Anlaufstelle'],
  [/\bPlugin(?:s)?\b/gi, 'Erweiterung'],
  [/\bMiddleware\b/gi, 'Zwischenschicht'],
  [/\bSDK\b/g, 'Werkzeugkasten'],
  [/\bRuntime\b/gi, 'Laufzeitumgebung'],
  [/\bBackend\b/gi, 'Hintergrundsystem'],
  [/\bFrontend\b/gi, 'Oberflaeche'],
  [/\bConfig(?:uration)?\b/gi, 'Einstellung'],
  [/\bSchema(?:s)?\b/gi, 'Struktur'],
  [/\bProvider\b/gi, 'Anbieter'],
  [/\bOpenClaw\b/gi, ''],
  [/\bopenclaw\b/g, ''],
]

// ─── Public API ──────────────────────────────────────────────

/**
 * Replace technical terms in prompt text with human-friendly alternatives.
 * Returns the sanitized text. Empty/falsy input passes through unchanged.
 */
export function sanitizePromptText(text: string): string {
  if (!text) return text

  let result = text
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }

  return result
}
