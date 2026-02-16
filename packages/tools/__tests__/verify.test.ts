/**
 * Tests for tool signature verification (Ed25519).
 * Uses Node.js built-in crypto for test keypair — no libsodium needed.
 */

import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifyToolWithConfig } from '../src/verify'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'

// ── Source path for security tests ──────────────────────────────

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(CURRENT_DIR, '..', 'src', 'verify.ts')

// ── Test keypair (generated once per test run) ──────────────────

const { publicKey: pubKeyObject, privateKey: privKeyObject } =
  generateKeyPairSync('ed25519')

const spkiDer = pubKeyObject.export({ type: 'spki', format: 'der' })
const rawPubKey = Buffer.from(spkiDer).subarray(12) // Skip 12-byte DER prefix
const pubKeyHex = rawPubKey.toString('hex')

// ── Helpers ─────────────────────────────────────────────────────

function signContent(content: Buffer): { hash: string; signature: string } {
  const hash = createHash('sha256').update(content).digest()
  const sig = cryptoSign(null, hash, privKeyObject)
  return { hash: hash.toString('hex'), signature: sig.toString('hex') }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'verify-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeSignaturesJson(
  signatures: Record<string, { hash: string; signature: string }>,
): string {
  const sigPath = join(tmpDir, 'signatures.json')
  writeFileSync(
    sigPath,
    JSON.stringify({
      version: 1,
      signedAt: new Date().toISOString(),
      signatures,
    }),
  )
  return sigPath
}

function writeToolFile(name: string, content: string): string {
  const toolPath = join(tmpDir, name)
  writeFileSync(toolPath, content)
  return toolPath
}

// ── Behavior Tests ──────────────────────────────────────────────

describe('verifyToolWithConfig', () => {
  it('returns true for validly signed tool', () => {
    const content = 'export const x = 1\n'
    const toolPath = writeToolFile('good-tool.ts', content)
    const signed = signContent(Buffer.from(content))
    const sigPath = writeSignaturesJson({ 'good-tool.ts': signed })

    expect(verifyToolWithConfig(toolPath, sigPath, pubKeyHex)).toBe(true)
  })

  it('returns false for manipulated file', () => {
    const original = 'export const x = 1\n'
    const toolPath = writeToolFile('tampered-tool.ts', original)
    const signed = signContent(Buffer.from(original))
    const sigPath = writeSignaturesJson({ 'tampered-tool.ts': signed })

    // Tamper with the file after signing
    writeFileSync(toolPath, 'export const x = 999\n')

    expect(verifyToolWithConfig(toolPath, sigPath, pubKeyHex)).toBe(false)
  })

  it('returns false for missing signature', () => {
    const toolPath = writeToolFile('unsigned.ts', 'export const y = 2\n')
    const sigPath = writeSignaturesJson({}) // No entry for unsigned.ts

    expect(verifyToolWithConfig(toolPath, sigPath, pubKeyHex)).toBe(false)
  })

  it('returns false (not crash) for corrupt signatures.json', () => {
    const toolPath = writeToolFile('any-tool.ts', 'content')
    const sigPath = join(tmpDir, 'signatures.json')
    writeFileSync(sigPath, 'this is not valid json {{{')

    expect(verifyToolWithConfig(toolPath, sigPath, pubKeyHex)).toBe(false)
  })

  it('returns false for wrong public key', () => {
    const content = 'export const z = 3\n'
    const toolPath = writeToolFile('wrongkey.ts', content)
    const signed = signContent(Buffer.from(content))
    const sigPath = writeSignaturesJson({ 'wrongkey.ts': signed })

    // Verify with a different keypair
    const { publicKey: otherPub } = generateKeyPairSync('ed25519')
    const otherDer = otherPub.export({ type: 'spki', format: 'der' })
    const otherHex = Buffer.from(otherDer).subarray(12).toString('hex')

    expect(verifyToolWithConfig(toolPath, sigPath, otherHex)).toBe(false)
  })

  it('returns false for non-existent tool file', () => {
    const sigPath = writeSignaturesJson({})

    expect(
      verifyToolWithConfig(join(tmpDir, 'nonexistent.ts'), sigPath, pubKeyHex),
    ).toBe(false)
  })

  it('returns false for non-existent signatures file', () => {
    const toolPath = writeToolFile('orphan.ts', 'code')

    expect(
      verifyToolWithConfig(toolPath, join(tmpDir, 'no-such.json'), pubKeyHex),
    ).toBe(false)
  })

  it('returns false for empty public key (placeholder)', () => {
    const content = 'export const a = 1\n'
    const toolPath = writeToolFile('empty-key.ts', content)
    const signed = signContent(Buffer.from(content))
    const sigPath = writeSignaturesJson({ 'empty-key.ts': signed })

    expect(verifyToolWithConfig(toolPath, sigPath, '')).toBe(false)
  })

  it('returns false for signatures.json with wrong version', () => {
    const content = 'export const b = 2\n'
    const toolPath = writeToolFile('version.ts', content)
    const sigPath = join(tmpDir, 'signatures.json')
    writeFileSync(sigPath, JSON.stringify({ version: 99, signatures: {} }))

    expect(verifyToolWithConfig(toolPath, sigPath, pubKeyHex)).toBe(false)
  })

  it('returns false for forged hash with valid-looking signature', () => {
    const content = 'export const c = 3\n'
    const toolPath = writeToolFile('forged.ts', content)
    const sigPath = writeSignaturesJson({
      'forged.ts': {
        hash: 'a'.repeat(64), // Fake hash
        signature: 'b'.repeat(128), // Fake signature
      },
    })

    expect(verifyToolWithConfig(toolPath, sigPath, pubKeyHex)).toBe(false)
  })
})

// ── Source Code Security ────────────────────────────────────────

describe('source code security', () => {
  it('contains no code execution patterns', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    assertNoEval(source)
  })

  it('contains no unauthorized fetch calls', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    assertNoUnauthorizedFetch(source, [])
  })
})
