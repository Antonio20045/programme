/**
 * Central blocklist of technical terms that should not leak to the LLM or end-user.
 *
 * Exports a check function that returns all matches found in a given text.
 * Used by error-transformer, prompt-sanitizer, and output-monitor.
 */

// ─── Term Blocklist ──────────────────────────────────────────

const BLOCKED_TERMS: ReadonlySet<string> = new Set([
  // Infrastructure
  'api', 'oauth', 'gateway', 'config', 'plugin', 'hook', 'webhook',
  'schema', 'openclaw', 'endpoint', 'middleware', 'sdk', 'jwt',
  'websocket', 'sse', 'node_modules', 'ipc', 'electron', 'preload',
  'renderer', 'pi-ai', 'pi-agent', 'llm', 'provider', 'runtime',
  'backend', 'frontend', 'microservice', 'http', 'tcp',

  // LLM internals
  'tool_use', 'tool_call', 'function_call', 'input_schema',
  'tool_result', 'tool_error', 'tool_confirm', 'system_prompt',
  'assistant_message', 'user_message', 'content_block',

  // Code/Dev
  'typescript', 'javascript', 'node.js', 'npm', 'pnpm',
  'json', 'yaml', 'dockerfile', 'webpack', 'vite',
  'stderr', 'stdout', 'stdin', 'process.env', 'env_var',

  // Database
  'postgresql', 'postgres', 'sqlite', 'sql', 'migration',
  'upsert', 'jsonb', 'orm',

  // Auth internals
  'token', 'bearer', 'refresh_token', 'access_token',
  'client_id', 'client_secret', 'grant_type',
])

// ─── Regex Patterns ──────────────────────────────────────────

const TECHNICAL_PATTERNS: readonly RegExp[] = [
  // File paths: /foo/bar.ts, ./src/index.js, C:\Users\...
  /(?:^|[\s(])[./\\][a-zA-Z0-9_\-/.\\]+\.[a-z]{1,4}(?:\s|$|[,;)])/,

  // Stack traces: at FunctionName (file:line:col)
  /at\s+\S+\s+\([^)]+:\d+:\d+\)/,

  // Node/System error codes: ENOENT, ECONNREFUSED, ERR_MODULE_NOT_FOUND
  /\b(?:E[A-Z]{2,}(?:[A-Z_]*[A-Z])?|ERR_[A-Z_]+)\b/,

  // ENV variables: KEY=value or KEY="value"
  /\b[A-Z][A-Z0-9_]{2,}=[^\s]+/,

  // Module paths: @scope/package, require('...')
  /@[a-z0-9-]+\/[a-z0-9-]+/,

  // HTTP methods + URLs in technical context
  /\b(?:GET|POST|PUT|DELETE|PATCH)\s+\/[a-z]/i,
]

// ─── Public API ──────────────────────────────────────────────

/**
 * Check text for technical terms and patterns.
 * Returns an array of matched terms/patterns (empty = clean).
 */
export function containsTechnicalTerms(text: string): string[] {
  if (!text) return []

  const matches: string[] = []
  const lowerText = text.toLowerCase()

  // Word-boundary check for blocked terms
  for (const term of BLOCKED_TERMS) {
    // Terms with special chars (underscores, dots, hyphens) need indexOf
    if (term.includes('_') || term.includes('.') || term.includes('-')) {
      if (lowerText.includes(term)) {
        matches.push(term)
      }
    } else {
      // Use word boundary for plain words
      const regex = new RegExp(`\\b${term}\\b`, 'i')
      if (regex.test(text)) {
        matches.push(term)
      }
    }
  }

  // Pattern checks
  for (const pattern of TECHNICAL_PATTERNS) {
    if (pattern.test(text)) {
      const found = text.match(pattern)
      if (found) {
        matches.push(found[0].trim())
      }
    }
  }

  return matches
}
