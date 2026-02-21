/**
 * Translator tool — translate text and detect languages via DeepL API.
 * Supports both Free and Pro API keys.
 * API key from DEEPL_API_KEY environment variable.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranslateArgs {
  readonly action: 'translate'
  readonly text: string
  readonly targetLang: string
  readonly sourceLang?: string
}

interface DetectArgs {
  readonly action: 'detect'
  readonly text: string
}

type TranslatorArgs = TranslateArgs | DetectArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000
const MAX_TEXT_LENGTH = 50_000

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'api-free.deepl.com',
  'api.deepl.com',
])

// ---------------------------------------------------------------------------
// URL validation (SSRF protection)
// ---------------------------------------------------------------------------

function isPrivateHostname(hostname: string): boolean {
  if (hostname === '::1' || hostname === '[::1]') return true

  const parts = hostname.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number)
    const [a, b] = octets as [number, number, number, number]
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true
  }

  const lower = hostname.toLowerCase()
  if (lower.startsWith('fd') || lower.startsWith('fe80')) return true

  return false
}

function validateApiUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only https: is allowed`)
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host "${parsed.hostname}" is not in the allowed hosts list`)
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`Blocked private/internal hostname: ${parsed.hostname}`)
  }

  return parsed
}

// ---------------------------------------------------------------------------
// DeepL API
// ---------------------------------------------------------------------------

interface DeepLTranslation {
  readonly detected_source_language?: string
  readonly text?: string
}

interface DeepLResponse {
  readonly translations?: readonly DeepLTranslation[]
}

function getApiBase(): string {
  const key = process.env['DEEPL_API_KEY']
  if (!key || key.trim() === '') {
    throw new Error('DEEPL_API_KEY environment variable is required')
  }
  // Free keys end with ":fx"
  if (key.endsWith(':fx')) {
    return 'https://api-free.deepl.com'
  }
  return 'https://api.deepl.com'
}

function getApiKey(): string {
  const key = process.env['DEEPL_API_KEY']
  if (!key || key.trim() === '') {
    throw new Error('DEEPL_API_KEY environment variable is required')
  }
  return key.trim()
}

async function translateText(
  text: string,
  targetLang: string,
  sourceLang?: string,
): Promise<{ translatedText: string; detectedSourceLang: string }> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long (max ${String(MAX_TEXT_LENGTH)} characters)`)
  }

  const base = getApiBase()
  const url = `${base}/v2/translate`
  validateApiUrl(url)

  const body = new URLSearchParams({
    text,
    target_lang: targetLang.toUpperCase(),
  })

  if (sourceLang) {
    body.set('source_lang', sourceLang.toUpperCase())
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${getApiKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('DeepL API authentication failed — check your DEEPL_API_KEY')
    }
    if (response.status === 456) {
      throw new Error('DeepL API quota exceeded')
    }
    throw new Error(`DeepL API error: ${String(response.status)} ${response.statusText}`)
  }

  const data = (await response.json()) as DeepLResponse
  const translation = data.translations?.[0]

  if (!translation?.text) {
    throw new Error('DeepL API returned no translation')
  }

  return {
    translatedText: translation.text,
    detectedSourceLang: translation.detected_source_language ?? 'unknown',
  }
}

async function detectLanguage(text: string): Promise<string> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long (max ${String(MAX_TEXT_LENGTH)} characters)`)
  }

  // DeepL has no dedicated detect endpoint — translate a short snippet to EN
  // and read detected_source_language from the response.
  const snippet = text.slice(0, 200)

  const base = getApiBase()
  const url = `${base}/v2/translate`
  validateApiUrl(url)

  const body = new URLSearchParams({
    text: snippet,
    target_lang: 'EN',
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${getApiKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`DeepL API error: ${String(response.status)} ${response.statusText}`)
  }

  const data = (await response.json()) as DeepLResponse
  const detected = data.translations?.[0]?.detected_source_language

  if (!detected) {
    throw new Error('Could not detect language')
  }

  return detected
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): TranslatorArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'translate') {
    const text = obj['text']
    const targetLang = obj['targetLang']
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('translate requires a non-empty "text" string')
    }
    if (typeof targetLang !== 'string' || targetLang.trim() === '') {
      throw new Error('translate requires a non-empty "targetLang" string')
    }
    const sourceLang = obj['sourceLang']
    return {
      action: 'translate',
      text: text.trim(),
      targetLang: targetLang.trim(),
      sourceLang: typeof sourceLang === 'string' && sourceLang.trim() !== '' ? sourceLang.trim() : undefined,
    }
  }

  if (action === 'detect') {
    const text = obj['text']
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('detect requires a non-empty "text" string')
    }
    return { action: 'detect', text: text.trim() }
  }

  throw new Error('action must be "translate" or "detect"')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "translate" or "detect"',
      enum: ['translate', 'detect'],
    },
    text: {
      type: 'string',
      description: 'Text to translate or detect language of',
    },
    targetLang: {
      type: 'string',
      description: 'Target language code (e.g. DE, EN, FR, ES) — required for translate',
    },
    sourceLang: {
      type: 'string',
      description: 'Source language code (optional, auto-detected if omitted)',
    },
  },
  required: ['action', 'text'],
}

export const translatorTool: ExtendedAgentTool = {
  name: 'translator',
  description:
    'Translate text between languages and detect languages using DeepL. Actions: translate(text, targetLang, sourceLang?) translates text; detect(text) identifies the source language.',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: false,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'translate': {
        const result = await translateText(parsed.text, parsed.targetLang, parsed.sourceLang)
        return textResult(JSON.stringify({
          translatedText: result.translatedText,
          detectedSourceLang: result.detectedSourceLang,
          targetLang: parsed.targetLang.toUpperCase(),
        }))
      }
      case 'detect': {
        const lang = await detectLanguage(parsed.text)
        return textResult(JSON.stringify({ detectedLanguage: lang }))
      }
    }
  },
}

export { validateApiUrl }
