/**
 * Tool signature verification — Ed25519 via Node.js built-in crypto.
 * Zero external dependencies.
 *
 * The Gateway calls verifyTool() before loading any tool file.
 * Returns false on any error — never throws.
 */

import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_SIGNING_PUBLIC_KEY } from './public-key'

// ── Types ───────────────────────────────────────────────────────

interface SignatureEntry {
  readonly hash: string
  readonly signature: string
}

interface SignaturesFile {
  readonly version: number
  readonly signatures: Readonly<Record<string, SignatureEntry>>
}

// ── Constants ───────────────────────────────────────────────────

/** DER prefix for Ed25519 SPKI encoding (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

// ── Helpers ─────────────────────────────────────────────────────

function hexToPublicKey(hex: string): KeyObject {
  const raw = Buffer.from(hex, 'hex')
  if (raw.length !== 32) {
    throw new Error('Ed25519 public key must be 32 bytes')
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

function loadSignatures(signaturesPath: string): SignaturesFile | null {
  try {
    const raw = readFileSync(signaturesPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed !== 'object' || parsed === null) return null

    const obj = parsed as Record<string, unknown>
    if (obj['version'] !== 1) return null
    if (typeof obj['signatures'] !== 'object' || obj['signatures'] === null) return null

    return parsed as SignaturesFile
  } catch {
    return null
  }
}

// ── Default paths ───────────────────────────────────────────────

const currentDir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_SIGNATURES_PATH = resolve(currentDir, '..', 'signatures.json')

// ── Public API ──────────────────────────────────────────────────

/**
 * Verifies a tool file's Ed25519 signature against signatures.json.
 * Uses the baked-in public key from public-key.ts.
 * Returns false (never throws) on any error.
 */
export function verifyTool(toolPath: string): boolean {
  return verifyToolWithConfig(toolPath, DEFAULT_SIGNATURES_PATH, TOOL_SIGNING_PUBLIC_KEY)
}

/**
 * Testable version — accepts explicit config instead of module-level defaults.
 */
export function verifyToolWithConfig(
  toolPath: string,
  signaturesPath: string,
  publicKeyHex: string,
): boolean {
  try {
    // 1. Reject empty public key (placeholder not yet replaced by sign-tools)
    if (!publicKeyHex || publicKeyHex.length !== 64) {
      console.error('[verify] Public key not configured — run sign-tools first')
      return false
    }

    // 2. Load signatures
    const sigFile = loadSignatures(signaturesPath)
    if (!sigFile) {
      console.error(`[verify] Failed to load signatures from ${signaturesPath}`)
      return false
    }

    // 3. Find entry for this tool
    const fileName = basename(toolPath)
    const entry = sigFile.signatures[fileName]
    if (!entry) {
      console.error(`[verify] No signature found for ${fileName}`)
      return false
    }

    // 4. Hash the tool file
    const fileContent = readFileSync(toolPath)
    const hash = createHash('sha256').update(fileContent).digest('hex')

    // 5. Check hash matches (constant-time comparison to prevent timing attacks)
    const hashBuf = Buffer.from(hash, 'hex')
    const entryHashBuf = Buffer.from(entry.hash, 'hex')
    if (hashBuf.length !== entryHashBuf.length || !timingSafeEqual(hashBuf, entryHashBuf)) {
      console.error(
        `[verify] Hash mismatch for ${fileName}: expected ${entry.hash.slice(0, 16)}..., got ${hash.slice(0, 16)}...`,
      )
      return false
    }

    // 6. Verify Ed25519 signature
    const publicKey = hexToPublicKey(publicKeyHex)
    const hashBytes = Buffer.from(hash, 'hex')
    const signature = Buffer.from(entry.signature, 'hex')

    const valid = verify(null, hashBytes, publicKey, signature)
    if (!valid) {
      console.error(`[verify] Invalid signature for ${fileName}`)
    }
    return valid
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[verify] Verification failed for ${toolPath}: ${message}`)
    return false
  }
}
