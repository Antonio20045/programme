/**
 * Image Generation tool — generate and edit images via OpenAI Images API.
 * Returns base64-encoded PNG (no second fetch needed).
 * API key from OPENAI_API_KEY environment variable.
 */

import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateArgs {
  readonly action: 'generate'
  readonly prompt: string
  readonly size?: string
}

interface EditArgs {
  readonly action: 'edit'
  readonly prompt: string
  readonly imageBase64: string
  readonly size?: string
}

type ImageGenArgs = GenerateArgs | EditArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 60_000
const MAX_PROMPT_LENGTH = 4000
const DEFAULT_MODEL = 'dall-e-3'
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['api.openai.com'])

const VALID_SIZES: ReadonlySet<string> = new Set([
  '1024x1024',
  '1024x1792',
  '1792x1024',
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
// OpenAI Images API
// ---------------------------------------------------------------------------

interface OpenAIImageData {
  readonly b64_json?: string
}

interface OpenAIImagesResponse {
  readonly data?: readonly OpenAIImageData[]
  readonly error?: { readonly message?: string }
}

function getApiKey(): string {
  const key = process.env['OPENAI_API_KEY']
  if (!key || key.trim() === '') {
    throw new Error('OPENAI_API_KEY environment variable is required')
  }
  return key.trim()
}

async function generateImage(prompt: string, size: string): Promise<string> {
  const url = 'https://api.openai.com/v1/images/generations'
  validateApiUrl(url)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('OpenAI API authentication failed — check your OPENAI_API_KEY')
    }
    if (response.status === 429) {
      throw new Error('OpenAI API rate limit exceeded — try again later')
    }
    const errorBody = (await response.json().catch(() => ({}))) as OpenAIImagesResponse
    const msg = errorBody.error?.message ?? response.statusText
    throw new Error(`OpenAI API error: ${String(response.status)} ${msg}`)
  }

  const data = (await response.json()) as OpenAIImagesResponse
  const b64 = data.data?.[0]?.b64_json

  if (!b64) {
    throw new Error('OpenAI API returned no image data')
  }

  return b64
}

async function editImage(prompt: string, imageBase64: string, size: string): Promise<string> {
  const url = 'https://api.openai.com/v1/images/edits'
  validateApiUrl(url)

  // Convert base64 to blob for multipart form data
  const imageBuffer = Buffer.from(imageBase64, 'base64')
  const blob = new Blob([imageBuffer], { type: 'image/png' })

  const formData = new FormData()
  formData.append('image', blob, 'image.png')
  formData.append('prompt', prompt)
  formData.append('n', '1')
  formData.append('size', size)
  formData.append('response_format', 'b64_json')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: formData,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('OpenAI API authentication failed — check your OPENAI_API_KEY')
    }
    if (response.status === 429) {
      throw new Error('OpenAI API rate limit exceeded — try again later')
    }
    const errorBody = (await response.json().catch(() => ({}))) as OpenAIImagesResponse
    const msg = errorBody.error?.message ?? response.statusText
    throw new Error(`OpenAI API error: ${String(response.status)} ${msg}`)
  }

  const data = (await response.json()) as OpenAIImagesResponse
  const b64 = data.data?.[0]?.b64_json

  if (!b64) {
    throw new Error('OpenAI API returned no image data')
  }

  return b64
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): ImageGenArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'generate') {
    const prompt = obj['prompt']
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('generate requires a non-empty "prompt" string')
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt too long (max ${String(MAX_PROMPT_LENGTH)} characters)`)
    }
    const size = obj['size']
    const resolvedSize = typeof size === 'string' && size.trim() !== '' ? size.trim() : '1024x1024'
    if (!VALID_SIZES.has(resolvedSize)) {
      throw new Error(`Invalid size "${resolvedSize}". Valid: ${Array.from(VALID_SIZES).join(', ')}`)
    }
    return { action: 'generate', prompt: prompt.trim(), size: resolvedSize }
  }

  if (action === 'edit') {
    const prompt = obj['prompt']
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('edit requires a non-empty "prompt" string')
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt too long (max ${String(MAX_PROMPT_LENGTH)} characters)`)
    }
    const imageBase64 = obj['imageBase64']
    if (typeof imageBase64 !== 'string' || imageBase64.trim() === '') {
      throw new Error('edit requires a non-empty "imageBase64" string')
    }
    const size = obj['size']
    const resolvedSize = typeof size === 'string' && size.trim() !== '' ? size.trim() : '1024x1024'
    if (!VALID_SIZES.has(resolvedSize)) {
      throw new Error(`Invalid size "${resolvedSize}". Valid: ${Array.from(VALID_SIZES).join(', ')}`)
    }
    return { action: 'edit', prompt: prompt.trim(), imageBase64: imageBase64.trim(), size: resolvedSize }
  }

  throw new Error('action must be "generate" or "edit"')
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action: "generate" or "edit"',
      enum: ['generate', 'edit'],
    },
    prompt: {
      type: 'string',
      description: 'Image description / editing instruction (max 4000 chars)',
    },
    imageBase64: {
      type: 'string',
      description: 'Base64-encoded PNG image to edit (required for edit action)',
    },
    size: {
      type: 'string',
      description: 'Image size: "1024x1024" (default), "1024x1792", or "1792x1024"',
      enum: ['1024x1024', '1024x1792', '1792x1024'],
    },
  },
  required: ['action', 'prompt'],
}

export const imageGenTool: ExtendedAgentTool = {
  name: 'image-gen',
  description:
    'Generate and edit images using AI. Actions: generate(prompt, size?) creates a new image from text description; edit(prompt, imageBase64, size?) modifies an existing image. Returns base64-encoded PNG. Requires user confirmation (costs money).',
  parameters,
  permissions: ['net:http'],
  requiresConfirmation: true,
  defaultRiskTier: 3,
  riskTiers: { generate: 3, edit: 3 },
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'generate': {
        const b64 = await generateImage(parsed.prompt, parsed.size ?? '1024x1024')
        return {
          content: [{ type: 'image', data: b64, mimeType: 'image/png' }],
        }
      }
      case 'edit': {
        const b64 = await editImage(parsed.prompt, parsed.imageBase64, parsed.size ?? '1024x1024')
        return {
          content: [{ type: 'image', data: b64, mimeType: 'image/png' }],
        }
      }
    }
  },
}

export { validateApiUrl }
