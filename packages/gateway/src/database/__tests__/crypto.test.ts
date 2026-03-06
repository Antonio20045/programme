/**
 * Tests for AES-256-GCM encryption helper.
 * Run: pnpm vitest run packages/gateway/src/database/__tests__/crypto.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encryptToken, decryptToken, getEncryptionKey } from '../crypto.js'

// ---------------------------------------------------------------------------
// Source code for security audit
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../crypto.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Test key (32 bytes = 64 hex chars)
// ---------------------------------------------------------------------------

const TEST_KEY = 'a'.repeat(64)

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalKey = process.env['TOKEN_ENCRYPTION_KEY']

beforeEach(() => {
  process.env['TOKEN_ENCRYPTION_KEY'] = TEST_KEY
})

afterEach(() => {
  if (originalKey !== undefined) {
    process.env['TOKEN_ENCRYPTION_KEY'] = originalKey
  } else {
    delete process.env['TOKEN_ENCRYPTION_KEY']
  }
})

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('encrypt / decrypt round-trip', () => {
  it('decrypts back to the original plaintext', () => {
    const plaintext = 'my-secret-oauth-token-12345'
    const encrypted = encryptToken(plaintext)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('handles empty string', () => {
    const encrypted = encryptToken('')
    expect(decryptToken(encrypted)).toBe('')
  })

  it('handles unicode text', () => {
    const plaintext = 'Geheimer Schlüssel 🔐 für Ähre'
    const encrypted = encryptToken(plaintext)
    expect(decryptToken(encrypted)).toBe(plaintext)
  })

  it('handles long tokens', () => {
    const plaintext = 'x'.repeat(10_000)
    const encrypted = encryptToken(plaintext)
    expect(decryptToken(encrypted)).toBe(plaintext)
  })
})

// ---------------------------------------------------------------------------
// IV uniqueness
// ---------------------------------------------------------------------------

describe('IV uniqueness', () => {
  it('produces different ciphertexts for the same plaintext', () => {
    const plaintext = 'same-input'
    const a = encryptToken(plaintext)
    const b = encryptToken(plaintext)
    expect(a).not.toBe(b)

    // Both decrypt to the same plaintext
    expect(decryptToken(a)).toBe(plaintext)
    expect(decryptToken(b)).toBe(plaintext)
  })

  it('uses different IVs on each call', () => {
    const a = encryptToken('test')
    const b = encryptToken('test')
    const ivA = a.split(':')[0]
    const ivB = b.split(':')[0]
    expect(ivA).not.toBe(ivB)
  })
})

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

describe('tamper detection', () => {
  it('throws on manipulated ciphertext', () => {
    const encrypted = encryptToken('secret')
    const parts = encrypted.split(':')
    // Flip a byte in the ciphertext
    const tampered = `${parts[0]}:${parts[1]}:ff${parts[2]!.slice(2)}`
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('throws on manipulated auth tag', () => {
    const encrypted = encryptToken('secret')
    const parts = encrypted.split(':')
    const tampered = `${parts[0]}:${'00'.repeat(16)}:${parts[2]}`
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('throws on manipulated IV', () => {
    const encrypted = encryptToken('secret')
    const parts = encrypted.split(':')
    const tampered = `${'00'.repeat(16)}:${parts[1]}:${parts[2]}`
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('throws on invalid format (missing parts)', () => {
    expect(() => decryptToken('only-one-part')).toThrow('Invalid ciphertext format')
    expect(() => decryptToken('two:parts')).toThrow('Invalid ciphertext format')
  })
})

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------

describe('getEncryptionKey', () => {
  it('throws when TOKEN_ENCRYPTION_KEY is not set', () => {
    delete process.env['TOKEN_ENCRYPTION_KEY']
    expect(() => getEncryptionKey()).toThrow('TOKEN_ENCRYPTION_KEY must be a 64-char hex string')
  })

  it('throws when key is too short', () => {
    process.env['TOKEN_ENCRYPTION_KEY'] = 'abcd'
    expect(() => getEncryptionKey()).toThrow('TOKEN_ENCRYPTION_KEY must be a 64-char hex string')
  })

  it('throws when key is too long', () => {
    process.env['TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(65)
    expect(() => getEncryptionKey()).toThrow('TOKEN_ENCRYPTION_KEY must be a 64-char hex string')
  })

  it('returns 32-byte Buffer for valid 64-char hex key', () => {
    process.env['TOKEN_ENCRYPTION_KEY'] = TEST_KEY
    const key = getEncryptionKey()
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })
})

// ---------------------------------------------------------------------------
// Security: source code audit
// ---------------------------------------------------------------------------

describe('security', () => {
  it('contains no eval or dynamic code execution', () => {
    const evalCall = ['\\bev', 'al\\s*\\('].join('')
    const newFunc = ['\\bnew\\s+Fun', 'ction\\s*\\('].join('')
    expect(SOURCE_CODE).not.toMatch(new RegExp(evalCall))
    expect(SOURCE_CODE).not.toMatch(new RegExp(newFunc))
  })

  it('uses node:crypto only (no external deps)', () => {
    const imports = SOURCE_CODE.match(/from\s+['"]([^'"]+)['"]/g) ?? []
    for (const imp of imports) {
      expect(imp).toContain('node:crypto')
    }
  })
})
