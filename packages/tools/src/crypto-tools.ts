/**
 * Crypto Tools — password generation, UUID, hashing, HMAC, random bytes, tokens.
 * All operations use Node.js built-in `crypto` module (CSPRNG).
 * No external dependencies, no network, no file I/O.
 */

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PasswordArgs {
  readonly action: 'password'
  readonly length?: number
  readonly uppercase?: boolean
  readonly lowercase?: boolean
  readonly digits?: boolean
  readonly symbols?: boolean
}

interface UuidArgs {
  readonly action: 'uuid'
  readonly count?: number
}

interface HashArgs {
  readonly action: 'hash'
  readonly data: string
  readonly algorithm?: string
}

interface HmacArgs {
  readonly action: 'hmac'
  readonly data: string
  readonly key: string
  readonly algorithm?: string
}

interface RandomArgs {
  readonly action: 'random'
  readonly bytes: number
  readonly encoding?: string
}

interface TokenArgs {
  readonly action: 'token'
  readonly length?: number
  readonly encoding?: string
}

type CryptoToolsArgs = PasswordArgs | UuidArgs | HashArgs | HmacArgs | RandomArgs | TokenArgs

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128
const MAX_INPUT_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_RANDOM_BYTES = 1024
const MAX_UUID_COUNT = 100
const DEFAULT_TOKEN_LENGTH = 32

const HASH_ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha512', 'md5'])
const TOKEN_ENCODINGS: ReadonlySet<string> = new Set(['hex', 'base64', 'base64url'])

const CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
} as const

// ---------------------------------------------------------------------------
// Password generation (rejection sampling, Fisher-Yates shuffle)
// ---------------------------------------------------------------------------

function randomInt(max: number): number {
  // Rejection sampling to avoid modulo bias
  if (max <= 0) throw new Error('max must be positive')
  const byteCount = Math.ceil(Math.log2(max) / 8) || 1
  const maxValid = Math.pow(256, byteCount)
  const remainder = maxValid % max

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const bytes = randomBytes(byteCount)
    let value = 0
    for (let i = 0; i < byteCount; i++) {
      value = value * 256 + (bytes[i] as number)
    }
    if (value < maxValid - remainder) {
      return value % max
    }
  }
}

function fisherYatesShuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const tmp = arr[i] as string
    arr[i] = arr[j] as string
    arr[j] = tmp
  }
  return arr
}

function generatePassword(args: PasswordArgs): string {
  const length = args.length ?? 16
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password length must be between ${String(MIN_PASSWORD_LENGTH)} and ${String(MAX_PASSWORD_LENGTH)}`)
  }

  const useUpper = args.uppercase !== false
  const useLower = args.lowercase !== false
  const useDigits = args.digits !== false
  const useSymbols = args.symbols !== false

  const activeSets: string[] = []
  if (useUpper) activeSets.push(CHAR_SETS.uppercase)
  if (useLower) activeSets.push(CHAR_SETS.lowercase)
  if (useDigits) activeSets.push(CHAR_SETS.digits)
  if (useSymbols) activeSets.push(CHAR_SETS.symbols)

  if (activeSets.length === 0) {
    throw new Error('At least one character category must be enabled')
  }

  if (length < activeSets.length) {
    throw new Error(`Password length must be at least ${String(activeSets.length)} to include one character from each enabled category`)
  }

  const allChars = activeSets.join('')
  const chars: string[] = []

  // Guarantee at least one char from each active category
  for (const set of activeSets) {
    const idx = randomInt(set.length)
    chars.push(set[idx] as string)
  }

  // Fill remaining with random chars from combined set
  while (chars.length < length) {
    const idx = randomInt(allChars.length)
    chars.push(allChars[idx] as string)
  }

  // Shuffle to remove predictable pattern (first N chars from each category)
  fisherYatesShuffle(chars)

  return chars.join('')
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

function executePassword(args: PasswordArgs): AgentToolResult {
  const password = generatePassword(args)
  return textResult(JSON.stringify({
    password,
    length: password.length,
  }))
}

function executeUuid(args: UuidArgs): AgentToolResult {
  const count = args.count ?? 1
  if (count < 1 || count > MAX_UUID_COUNT || !Number.isInteger(count)) {
    throw new Error(`count must be an integer between 1 and ${String(MAX_UUID_COUNT)}`)
  }
  const uuids: string[] = []
  for (let i = 0; i < count; i++) {
    uuids.push(randomUUID())
  }
  return textResult(JSON.stringify({ uuids, count: uuids.length }))
}

function executeHash(args: HashArgs): AgentToolResult {
  const algorithm = (args.algorithm ?? 'sha256').toLowerCase()
  if (!HASH_ALGORITHMS.has(algorithm)) {
    const valid = Array.from(HASH_ALGORITHMS).join(', ')
    throw new Error(`Unsupported hash algorithm "${args.algorithm ?? ''}". Supported: ${valid}`)
  }
  if (args.data.length > MAX_INPUT_SIZE) {
    throw new Error('Input data exceeds maximum size of 10MB')
  }
  const hash = createHash(algorithm).update(args.data).digest('hex')
  return textResult(JSON.stringify({ algorithm, hash }))
}

function executeHmac(args: HmacArgs): AgentToolResult {
  const algorithm = (args.algorithm ?? 'sha256').toLowerCase()
  if (!HASH_ALGORITHMS.has(algorithm)) {
    const valid = Array.from(HASH_ALGORITHMS).join(', ')
    throw new Error(`Unsupported HMAC algorithm "${args.algorithm ?? ''}". Supported: ${valid}`)
  }
  if (args.data.length > MAX_INPUT_SIZE) {
    throw new Error('Input data exceeds maximum size of 10MB')
  }
  // Key is used but NEVER included in the output
  const hmac = createHmac(algorithm, args.key).update(args.data).digest('hex')
  return textResult(JSON.stringify({ algorithm, hmac }))
}

function executeRandom(args: RandomArgs): AgentToolResult {
  if (args.bytes < 1 || args.bytes > MAX_RANDOM_BYTES || !Number.isInteger(args.bytes)) {
    throw new Error(`bytes must be an integer between 1 and ${String(MAX_RANDOM_BYTES)}`)
  }
  const encoding = (args.encoding ?? 'hex').toLowerCase()
  if (!TOKEN_ENCODINGS.has(encoding)) {
    const valid = Array.from(TOKEN_ENCODINGS).join(', ')
    throw new Error(`Unsupported encoding "${args.encoding ?? ''}". Supported: ${valid}`)
  }
  const bytes = randomBytes(args.bytes)
  const value = bytes.toString(encoding as BufferEncoding)
  return textResult(JSON.stringify({ bytes: args.bytes, encoding, value }))
}

function executeToken(args: TokenArgs): AgentToolResult {
  const length = args.length ?? DEFAULT_TOKEN_LENGTH
  if (length < 1 || length > MAX_RANDOM_BYTES || !Number.isInteger(length)) {
    throw new Error(`length must be an integer between 1 and ${String(MAX_RANDOM_BYTES)}`)
  }
  const encoding = (args.encoding ?? 'hex').toLowerCase()
  if (!TOKEN_ENCODINGS.has(encoding)) {
    const valid = Array.from(TOKEN_ENCODINGS).join(', ')
    throw new Error(`Unsupported encoding "${args.encoding ?? ''}". Supported: ${valid}`)
  }
  const token = randomBytes(length).toString(encoding as BufferEncoding)
  return textResult(JSON.stringify({ token, encoding, byteLength: length }))
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): CryptoToolsArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'password') {
    return {
      action: 'password',
      length: typeof obj['length'] === 'number' ? obj['length'] : undefined,
      uppercase: typeof obj['uppercase'] === 'boolean' ? obj['uppercase'] : undefined,
      lowercase: typeof obj['lowercase'] === 'boolean' ? obj['lowercase'] : undefined,
      digits: typeof obj['digits'] === 'boolean' ? obj['digits'] : undefined,
      symbols: typeof obj['symbols'] === 'boolean' ? obj['symbols'] : undefined,
    }
  }

  if (action === 'uuid') {
    return {
      action: 'uuid',
      count: typeof obj['count'] === 'number' ? obj['count'] : undefined,
    }
  }

  if (action === 'hash') {
    const data = obj['data']
    if (typeof data !== 'string') {
      throw new Error('hash requires a "data" string')
    }
    return {
      action: 'hash',
      data,
      algorithm: typeof obj['algorithm'] === 'string' ? obj['algorithm'] : undefined,
    }
  }

  if (action === 'hmac') {
    const data = obj['data']
    const key = obj['key']
    if (typeof data !== 'string') {
      throw new Error('hmac requires a "data" string')
    }
    if (typeof key !== 'string') {
      throw new Error('hmac requires a "key" string')
    }
    return {
      action: 'hmac',
      data,
      key,
      algorithm: typeof obj['algorithm'] === 'string' ? obj['algorithm'] : undefined,
    }
  }

  if (action === 'random') {
    const bytes = obj['bytes']
    if (typeof bytes !== 'number') {
      throw new Error('random requires a "bytes" number')
    }
    return {
      action: 'random',
      bytes,
      encoding: typeof obj['encoding'] === 'string' ? obj['encoding'] : undefined,
    }
  }

  if (action === 'token') {
    return {
      action: 'token',
      length: typeof obj['length'] === 'number' ? obj['length'] : undefined,
      encoding: typeof obj['encoding'] === 'string' ? obj['encoding'] : undefined,
    }
  }

  throw new Error('action must be "password", "uuid", "hash", "hmac", "random", or "token"')
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
      description: 'Action: "password", "uuid", "hash", "hmac", "random", or "token"',
      enum: ['password', 'uuid', 'hash', 'hmac', 'random', 'token'],
    },
    length: {
      type: 'number',
      description: 'Password length (8-128, default 16) or token byte length (1-1024, default 32)',
    },
    uppercase: {
      type: 'boolean',
      description: 'Include uppercase letters in password (default true)',
    },
    lowercase: {
      type: 'boolean',
      description: 'Include lowercase letters in password (default true)',
    },
    digits: {
      type: 'boolean',
      description: 'Include digits in password (default true)',
    },
    symbols: {
      type: 'boolean',
      description: 'Include symbols in password (default true)',
    },
    count: {
      type: 'number',
      description: 'Number of UUIDs to generate (1-100, default 1)',
    },
    data: {
      type: 'string',
      description: 'Data to hash or HMAC (max 10MB)',
    },
    key: {
      type: 'string',
      description: 'Secret key for HMAC (never included in output)',
    },
    algorithm: {
      type: 'string',
      description: 'Hash algorithm: sha256 (default), sha512, md5',
    },
    bytes: {
      type: 'number',
      description: 'Number of random bytes (1-1024)',
    },
    encoding: {
      type: 'string',
      description: 'Output encoding: hex (default), base64, base64url',
    },
  },
  required: ['action'],
}

export const cryptoToolsTool: ExtendedAgentTool = {
  name: 'crypto-tools',
  description:
    'Cryptographic utilities using CSPRNG. Actions: password(length?, uppercase?, lowercase?, digits?, symbols?) generates secure password; uuid(count?) generates UUID v4; hash(data, algorithm?) computes hash; hmac(data, key, algorithm?) computes HMAC; random(bytes, encoding?) generates random bytes; token(length?, encoding?) generates API token.',
  parameters,
  permissions: [],
  requiresConfirmation: false,
  defaultRiskTier: 0,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    switch (parsed.action) {
      case 'password':
        return executePassword(parsed)
      case 'uuid':
        return executeUuid(parsed)
      case 'hash':
        return executeHash(parsed)
      case 'hmac':
        return executeHmac(parsed)
      case 'random':
        return executeRandom(parsed)
      case 'token':
        return executeToken(parsed)
    }
  },
}

export { generatePassword, HASH_ALGORITHMS }
