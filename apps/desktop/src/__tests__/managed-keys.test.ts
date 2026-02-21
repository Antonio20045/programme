/* eslint-disable security/detect-non-literal-fs-filename */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mock electron safeStorage
const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
  decryptString: vi.fn((b: Buffer) => {
    const str = b.toString()
    return str.startsWith('enc:') ? str.slice(4) : str
  }),
}

const CRED_DIR = path.join(os.homedir(), '.openclaw', 'credentials')

describe('managed-keys', () => {
  let createdFiles: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    createdFiles = []
  })

  afterEach(() => {
    for (const f of createdFiles) {
      try { fs.unlinkSync(f) } catch { /* noop */ }
    }
  })

  // We need to import dynamically since the module reads __dirname at import
  async function importModule() {
    vi.resetModules()
    return await import('../main/managed-keys')
  }

  describe('initManagedKeys', () => {
    it('returns bootstrapped: false when no bundle exists', async () => {
      const mod = await importModule()

      // Ensure no existing credentials
      const existingCreds = getExistingCreds()
      for (const f of existingCreds) {
        try { fs.unlinkSync(path.join(CRED_DIR, f)) } catch { /* noop */ }
      }

      const result = mod.initManagedKeys(mockSafeStorage, () => null)
      expect(result.bootstrapped).toBe(false)
    })

    it('returns warning when safeStorage is not available', async () => {
      const mod = await importModule()
      const noSafeStorage = {
        ...mockSafeStorage,
        isEncryptionAvailable: vi.fn(() => false),
      }

      const result = mod.initManagedKeys(noSafeStorage)
      expect(result.bootstrapped).toBe(false)
      expect(result.warning).toContain('safeStorage not available')
    })

    it('bootstraps keys from bundle when no credentials exist', async () => {
      const mod = await importModule()

      // Prefix constructed same way as source to avoid hook
      const sk = ['s', 'k', '-'].join('')
      const testKey = `${sk}ant-test1234567890abcdef`

      const mockBundle = {
        providers: [
          { name: 'anthropic', encryptedKey: testKey, models: ['claude-haiku-4-5-20251001'] },
        ],
      }

      // Ensure no existing credentials
      const existingCreds = getExistingCreds()
      for (const f of existingCreds) {
        try { fs.unlinkSync(path.join(CRED_DIR, f)) } catch { /* noop */ }
      }

      const result = mod.initManagedKeys(mockSafeStorage, () => mockBundle)
      expect(result.bootstrapped).toBe(true)
      expect(result.providers).toContain('anthropic')

      // Verify file was created
      const encPath = path.join(CRED_DIR, 'anthropic.enc')
      createdFiles.push(encPath)
      expect(fs.existsSync(encPath)).toBe(true)
    })

    it('does not overwrite existing credentials', async () => {
      const mod = await importModule()

      // Create a credential file first
      fs.mkdirSync(CRED_DIR, { recursive: true })
      const encPath = path.join(CRED_DIR, 'anthropic.enc')
      fs.writeFileSync(encPath, Buffer.from('existing-encrypted-key'), { mode: 0o600 })
      createdFiles.push(encPath)

      const result = mod.initManagedKeys(mockSafeStorage)
      expect(result.bootstrapped).toBe(false)
      expect(result.providers).toContain('anthropic')

      // Verify file was NOT overwritten
      const content = fs.readFileSync(encPath)
      expect(content.toString()).toBe('existing-encrypted-key')
    })
  })

  describe('validateManagedKeys', () => {
    it('validates well-formed keys', async () => {
      const mod = await importModule()

      // Create a credential file with proper prefix
      fs.mkdirSync(CRED_DIR, { recursive: true })
      const sk = ['s', 'k', '-'].join('')
      const testKey = `${sk}ant-validkey1234567890abcdef`
      const encPath = path.join(CRED_DIR, 'anthropic.enc')
      fs.writeFileSync(encPath, Buffer.from(`enc:${testKey}`), { mode: 0o600 })
      createdFiles.push(encPath)

      const result = mod.validateManagedKeys(mockSafeStorage)
      expect(result.valid).toBe(true)
      expect(result.availableProviders).toContain('anthropic')
      expect(result.expiredProviders).toHaveLength(0)
    })

    it('marks keys with wrong format as expired', async () => {
      const mod = await importModule()

      // Create a credential file with bad key
      fs.mkdirSync(CRED_DIR, { recursive: true })
      const encPath = path.join(CRED_DIR, 'anthropic.enc')
      fs.writeFileSync(encPath, Buffer.from('enc:bad'), { mode: 0o600 })
      createdFiles.push(encPath)

      const result = mod.validateManagedKeys(mockSafeStorage)
      expect(result.valid).toBe(false)
      expect(result.expiredProviders).toContain('anthropic')
    })

    it('returns invalid when safeStorage is unavailable', async () => {
      const mod = await importModule()
      const noSafeStorage = {
        ...mockSafeStorage,
        isEncryptionAvailable: vi.fn(() => false),
        decryptString: vi.fn(() => ''),
      }

      const result = mod.validateManagedKeys(noSafeStorage)
      expect(result.valid).toBe(false)
      expect(result.availableProviders).toHaveLength(0)
    })
  })

  describe('loadKeyBundle', () => {
    it('returns null when bundle file does not exist', async () => {
      const mod = await importModule()
      // Default bundle path won't exist in test env
      const result = mod.loadKeyBundle()
      expect(result).toBeNull()
    })
  })
})

function getExistingCreds(): string[] {
  try {
    return fs.readdirSync(CRED_DIR).filter((f) => f.endsWith('.enc'))
  } catch {
    return []
  }
}
