import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TEST_DB_DIR = path.join(os.tmpdir(), 'credential-vault-test-' + process.pid)
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'credentials.db')

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => TEST_DB_DIR),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => {
      const str = b.toString()
      return str.startsWith('enc:') ? str.slice(4) : str
    }),
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialVault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true })
    }
    // Remove old DB if exists
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
      try { fs.unlinkSync(f) } catch { /* noop */ }
    }
  })

  afterEach(() => {
    // Cleanup DB files
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
      try { fs.unlinkSync(f) } catch { /* noop */ }
    }
  })

  async function importVault() {
    vi.resetModules()
    const mod = await import('../main/credential-vault')
    return new mod.default()
  }

  it('stores and lists credentials', async () => {
    const vault = await importVault()
    const id = vault.store('example.com', 'user1', 'secret123')
    expect(typeof id).toBe('string')

    const list = vault.listAll()
    expect(list).toHaveLength(1)
    expect(list[0].domain).toBe('example.com')
    expect(list[0].username).toBe('user1')
    // Password must NOT appear in list
    expect(JSON.stringify(list[0])).not.toContain('secret123')
  })

  it('finds credentials by domain', async () => {
    const vault = await importVault()
    vault.store('example.com', 'user1', 'pw1')
    vault.store('other.com', 'user2', 'pw2')

    const found = vault.findByDomain('example.com')
    expect(found).toHaveLength(1)
    expect(found[0].username).toBe('user1')
  })

  it('normalizes domain (strips port, lowercases)', async () => {
    const vault = await importVault()
    vault.store('Example.COM', 'user1', 'pw1')

    const found = vault.findByDomain('example.com')
    expect(found).toHaveLength(1)
  })

  it('resolves encrypted password by id', async () => {
    const vault = await importVault()
    const id = vault.store('example.com', 'user1', 'mypassword')

    const resolved = vault.resolve(id)
    expect(resolved).toBe('mypassword')
  })

  it('returns null for non-existent id on resolve', async () => {
    const vault = await importVault()
    expect(vault.resolve('nonexistent')).toBeNull()
  })

  it('deletes credential', async () => {
    const vault = await importVault()
    const id = vault.store('example.com', 'user1', 'pw')
    vault.delete(id)

    expect(vault.listAll()).toHaveLength(0)
  })

  it('upserts on duplicate domain+username', async () => {
    const vault = await importVault()
    vault.store('example.com', 'user1', 'oldpw')
    vault.store('example.com', 'user1', 'newpw')

    const list = vault.listAll()
    expect(list).toHaveLength(1)
  })

  it('generates secure password with correct length', async () => {
    const vault = await importVault()
    const pw = vault.generateSecurePassword(24)
    expect(pw).toHaveLength(24)
  })

  it('generated password contains all character groups', async () => {
    const vault = await importVault()
    const pw = vault.generateSecurePassword(20)
    expect(pw).toMatch(/[a-z]/)
    expect(pw).toMatch(/[A-Z]/)
    expect(pw).toMatch(/[0-9]/)
    expect(pw).toMatch(/[^a-zA-Z0-9]/)
  })

  it('rejects password length < 8', async () => {
    const vault = await importVault()
    expect(() => vault.generateSecurePassword(4)).toThrow('between 8 and 128')
  })

  it('rejects password length > 128', async () => {
    const vault = await importVault()
    expect(() => vault.generateSecurePassword(200)).toThrow('between 8 and 128')
  })

  // Security tests
  it('SECURITY: listAll never returns password data', async () => {
    const vault = await importVault()
    vault.store('example.com', 'user', 'supersecret')

    const list = vault.listAll()
    for (const entry of list) {
      const serialized = JSON.stringify(entry)
      expect(serialized).not.toContain('supersecret')
      expect(serialized).not.toContain('encrypted')
      expect(serialized).not.toContain('enc:')
    }
  })

  it('SECURITY: findByDomain never returns password data', async () => {
    const vault = await importVault()
    vault.store('example.com', 'user', 'topsecret')

    const found = vault.findByDomain('example.com')
    for (const entry of found) {
      const serialized = JSON.stringify(entry)
      expect(serialized).not.toContain('topsecret')
      expect(serialized).not.toContain('encrypted')
    }
  })
})
