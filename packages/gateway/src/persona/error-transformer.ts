/**
 * Transforms technical error messages into user-friendly German text.
 *
 * Pattern-based: known errors get specific messages, everything else
 * gets blocklist patterns stripped. If nothing meaningful remains,
 * a generic fallback is returned.
 */

// ─── Known Error Patterns ────────────────────────────────────

interface ErrorPattern {
  readonly test: (text: string) => boolean
  readonly message: string
}

const ERROR_PATTERNS: readonly ErrorPattern[] = [
  {
    test: (t) => /ECONNREFUSED/i.test(t),
    message: 'Der Dienst ist gerade nicht erreichbar.',
  },
  {
    test: (t) => /ETIMEDOUT/i.test(t),
    message: 'Die Anfrage hat zu lange gedauert.',
  },
  {
    test: (t) => /ENOTFOUND/i.test(t),
    message: 'Der Dienst konnte nicht gefunden werden.',
  },
  {
    test: (t) => /ENOENT/i.test(t),
    message: 'Die Datei wurde nicht gefunden.',
  },
  {
    test: (t) => /EPERM|EACCES/i.test(t),
    message: 'Keine Berechtigung fuer diesen Zugriff.',
  },
  {
    test: (t) => /\b401\b|unauthorized/i.test(t),
    message: 'Zugriff nicht erlaubt.',
  },
  {
    test: (t) => /\b403\b|forbidden/i.test(t),
    message: 'Zugriff verweigert.',
  },
  {
    test: (t) => /\b429\b|rate.?limit|too many requests/i.test(t),
    message: 'Zu viele Anfragen. Bitte kurz warten.',
  },
  {
    test: (t) => /\b5\d{2}\b|internal.?server.?error|service.?unavailable/i.test(t),
    message: 'Der Dienst hat einen Fehler gemeldet.',
  },
  {
    test: (t) => /invalid.?grant|token.?expired|token.?revoked/i.test(t),
    message: 'Die Anmeldung ist abgelaufen. Bitte erneut verbinden.',
  },
  {
    test: (t) => /desktop agent disconnected|agent nicht verbunden/i.test(t),
    message: 'Die Verbindung zum Desktop wurde unterbrochen.',
  },
  {
    test: (t) => /timeout/i.test(t),
    message: 'Die Anfrage hat zu lange gedauert.',
  },
]

// ─── Strip Patterns ──────────────────────────────────────────

const STRIP_PATTERNS: readonly RegExp[] = [
  // Stack traces
  /\s*at\s+\S+\s+\([^)]+:\d+:\d+\)/g,
  // File paths
  /(?:\/[\w./-]+\.(?:ts|js|mjs|json|tsx|jsx))/g,
  // node_modules paths
  /node_modules\/[^\s]+/g,
  // Error codes like ENOENT, ERR_MODULE_NOT_FOUND
  /\b(?:E[A-Z]{2,}(?:[A-Z_]*[A-Z])?|ERR_[A-Z_]+)\b/g,
  // ENV-style KEY=value
  /\b[A-Z][A-Z0-9_]{2,}=[^\s]+/g,
  // Module specifiers @scope/pkg
  /@[a-z0-9-]+\/[a-z0-9-]+/g,
]

const GENERIC_FALLBACK = 'Das hat leider nicht funktioniert.'

// ─── Public API ──────────────────────────────────────────────

/**
 * Transform a technical error string into a user-friendly German message.
 *
 * 1. Check against known patterns → return specific message.
 * 2. Otherwise strip technical artifacts and return cleaned text.
 * 3. If nothing meaningful remains → generic fallback.
 */
export function transformError(error: string): string {
  if (!error || error.trim().length === 0) return GENERIC_FALLBACK

  // Check known patterns first
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      return pattern.message
    }
  }

  // Strip technical artifacts
  let cleaned = error
  for (const pattern of STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  // If nothing meaningful remains
  if (cleaned.length < 3) return GENERIC_FALLBACK

  return cleaned
}
