import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { cryptoToolsTool, generatePassword, HASH_ALGORITHMS } from '../src/crypto-tools'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/crypto-tools.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: { content: readonly { type: string; text?: string }[] }): unknown {
  const first = result.content[0] as { type: 'text'; text: string }
  return JSON.parse(first.text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('crypto-tools tool', () => {
  // -------------------------------------------------------------------------
  // Tool metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(cryptoToolsTool.name).toBe('crypto-tools')
    })

    it('runs on server', () => {
      expect(cryptoToolsTool.runsOn).toBe('server')
    })

    it('has no permissions', () => {
      expect(cryptoToolsTool.permissions).toEqual([])
    })

    it('does not require confirmation', () => {
      expect(cryptoToolsTool.requiresConfirmation).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // password()
  // -------------------------------------------------------------------------

  describe('password()', () => {
    it('generates password with default length (16)', async () => {
      const result = parseResult(await cryptoToolsTool.execute({ action: 'password' })) as {
        password: string; length: number
      }
      expect(result.length).toBe(16)
      expect(result.password.length).toBe(16)
    })

    it('generates password with custom length', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'password', length: 32,
      })) as { password: string; length: number }
      expect(result.length).toBe(32)
    })

    it('includes all default categories', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'password', length: 64,
      })) as { password: string }
      const pw = result.password
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[0-9]/)
      expect(pw).toMatch(/[^a-zA-Z0-9]/)
    })

    it('respects disabled categories', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'password', length: 20, symbols: false, digits: false,
      })) as { password: string }
      expect(result.password).toMatch(/^[a-zA-Z]+$/)
    })

    it('generates only digits when other categories disabled', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'password', length: 12, uppercase: false, lowercase: false, symbols: false,
      })) as { password: string }
      expect(result.password).toMatch(/^\d+$/)
    })

    it('rejects password shorter than 8', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'password', length: 4 }),
      ).rejects.toThrow('between 8 and 128')
    })

    it('rejects password longer than 128', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'password', length: 200 }),
      ).rejects.toThrow('between 8 and 128')
    })

    it('rejects all categories disabled', async () => {
      await expect(
        cryptoToolsTool.execute({
          action: 'password', uppercase: false, lowercase: false, digits: false, symbols: false,
        }),
      ).rejects.toThrow('At least one character category')
    })

    it('generates unique passwords on successive calls', async () => {
      const r1 = parseResult(await cryptoToolsTool.execute({ action: 'password' })) as { password: string }
      const r2 = parseResult(await cryptoToolsTool.execute({ action: 'password' })) as { password: string }
      expect(r1.password).not.toBe(r2.password)
    })
  })

  // -------------------------------------------------------------------------
  // generatePassword() — exported
  // -------------------------------------------------------------------------

  describe('generatePassword()', () => {
    it('guarantees at least one char from each enabled category', () => {
      // Run multiple times to check consistency
      for (let i = 0; i < 10; i++) {
        const pw = generatePassword({ action: 'password', length: 8 })
        expect(pw).toMatch(/[A-Z]/)
        expect(pw).toMatch(/[a-z]/)
        expect(pw).toMatch(/[0-9]/)
        expect(pw).toMatch(/[^a-zA-Z0-9]/)
      }
    })
  })

  // -------------------------------------------------------------------------
  // uuid()
  // -------------------------------------------------------------------------

  describe('uuid()', () => {
    it('generates single UUID v4 by default', async () => {
      const result = parseResult(await cryptoToolsTool.execute({ action: 'uuid' })) as {
        uuids: string[]; count: number
      }
      expect(result.count).toBe(1)
      expect(result.uuids).toHaveLength(1)
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
      expect(result.uuids[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    })

    it('generates multiple UUIDs', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'uuid', count: 5,
      })) as { uuids: string[]; count: number }
      expect(result.count).toBe(5)
      expect(result.uuids).toHaveLength(5)
      // All unique
      const unique = new Set(result.uuids)
      expect(unique.size).toBe(5)
    })

    it('rejects count > 100', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'uuid', count: 200 }),
      ).rejects.toThrow('between 1 and 100')
    })

    it('rejects count < 1', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'uuid', count: 0 }),
      ).rejects.toThrow('between 1 and 100')
    })
  })

  // -------------------------------------------------------------------------
  // hash()
  // -------------------------------------------------------------------------

  describe('hash()', () => {
    it('computes sha256 by default', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'hash', data: 'hello',
      })) as { algorithm: string; hash: string }
      expect(result.algorithm).toBe('sha256')
      // Known sha256 of "hello"
      expect(result.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('computes sha512', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'hash', data: 'hello', algorithm: 'sha512',
      })) as { algorithm: string; hash: string }
      expect(result.algorithm).toBe('sha512')
      expect(result.hash.length).toBe(128) // 512 bits = 128 hex chars
    })

    it('computes md5', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'hash', data: 'hello', algorithm: 'md5',
      })) as { hash: string }
      expect(result.hash).toBe('5d41402abc4b2a76b9719d911017c592')
    })

    it('rejects unsupported algorithm', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'hash', data: 'test', algorithm: 'sha1' }),
      ).rejects.toThrow('Unsupported hash algorithm')
    })
  })

  // -------------------------------------------------------------------------
  // hmac()
  // -------------------------------------------------------------------------

  describe('hmac()', () => {
    it('computes HMAC-SHA256', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'hmac', data: 'hello', key: 'secret',
      })) as { algorithm: string; hmac: string }
      expect(result.algorithm).toBe('sha256')
      expect(typeof result.hmac).toBe('string')
      expect(result.hmac.length).toBe(64) // 256 bits = 64 hex chars
    })

    it('does NOT include key in output', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'hmac', data: 'hello', key: 'my-secret-key',
      })) as Record<string, unknown>
      expect(result).not.toHaveProperty('key')
      expect(JSON.stringify(result)).not.toContain('my-secret-key')
    })

    it('produces different output for different keys', async () => {
      const r1 = parseResult(await cryptoToolsTool.execute({
        action: 'hmac', data: 'hello', key: 'key1',
      })) as { hmac: string }
      const r2 = parseResult(await cryptoToolsTool.execute({
        action: 'hmac', data: 'hello', key: 'key2',
      })) as { hmac: string }
      expect(r1.hmac).not.toBe(r2.hmac)
    })

    it('rejects missing key', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'hmac', data: 'hello' }),
      ).rejects.toThrow('"key" string')
    })
  })

  // -------------------------------------------------------------------------
  // random()
  // -------------------------------------------------------------------------

  describe('random()', () => {
    it('generates hex random bytes', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'random', bytes: 16,
      })) as { value: string; encoding: string; bytes: number }
      expect(result.encoding).toBe('hex')
      expect(result.bytes).toBe(16)
      expect(result.value).toMatch(/^[0-9a-f]{32}$/) // 16 bytes = 32 hex chars
    })

    it('generates base64 random bytes', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'random', bytes: 16, encoding: 'base64',
      })) as { value: string; encoding: string }
      expect(result.encoding).toBe('base64')
      expect(result.value.length).toBeGreaterThan(0)
    })

    it('rejects bytes > 1024', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'random', bytes: 2000 }),
      ).rejects.toThrow('between 1 and 1024')
    })

    it('rejects unsupported encoding', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'random', bytes: 16, encoding: 'ascii' }),
      ).rejects.toThrow('Unsupported encoding')
    })
  })

  // -------------------------------------------------------------------------
  // token()
  // -------------------------------------------------------------------------

  describe('token()', () => {
    it('generates token with default settings', async () => {
      const result = parseResult(await cryptoToolsTool.execute({ action: 'token' })) as {
        token: string; encoding: string; byteLength: number
      }
      expect(result.encoding).toBe('hex')
      expect(result.byteLength).toBe(32)
      expect(result.token).toMatch(/^[0-9a-f]{64}$/) // 32 bytes = 64 hex chars
    })

    it('generates base64url token', async () => {
      const result = parseResult(await cryptoToolsTool.execute({
        action: 'token', encoding: 'base64url',
      })) as { token: string; encoding: string }
      expect(result.encoding).toBe('base64url')
      // base64url should not contain + or /
      expect(result.token).not.toMatch(/[+/=]/)
    })
  })

  // -------------------------------------------------------------------------
  // HASH_ALGORITHMS — exported
  // -------------------------------------------------------------------------

  describe('HASH_ALGORITHMS', () => {
    it('contains exactly sha256, sha512, md5', () => {
      expect(HASH_ALGORITHMS.has('sha256')).toBe(true)
      expect(HASH_ALGORITHMS.has('sha512')).toBe(true)
      expect(HASH_ALGORITHMS.has('md5')).toBe(true)
      expect(HASH_ALGORITHMS.size).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // Argument validation
  // -------------------------------------------------------------------------

  describe('argument validation', () => {
    it('rejects null args', async () => {
      await expect(cryptoToolsTool.execute(null)).rejects.toThrow('Arguments must be an object')
    })

    it('rejects non-object args', async () => {
      await expect(cryptoToolsTool.execute('string')).rejects.toThrow('Arguments must be an object')
    })

    it('rejects unknown action', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'hack' }),
      ).rejects.toThrow('action must be')
    })

    it('rejects hash without data', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'hash' }),
      ).rejects.toThrow('"data" string')
    })

    it('rejects hmac without data', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'hmac', key: 'x' }),
      ).rejects.toThrow('"data" string')
    })

    it('rejects random without bytes', async () => {
      await expect(
        cryptoToolsTool.execute({ action: 'random' }),
      ).rejects.toThrow('"bytes" number')
    })
  })

  // -------------------------------------------------------------------------
  // Security — source code audit
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('uses node:crypto (CSPRNG) not Math.random', () => {
      expect(sourceCode).not.toContain('Math.random')
    })
  })
})
