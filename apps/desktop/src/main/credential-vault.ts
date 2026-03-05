import { app, safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// CredentialVault — safeStorage-encrypted credential store (SQLite + WAL)
// ---------------------------------------------------------------------------

interface CredentialRow {
  id: string
  domain: string
  username: string
  encrypted_password: Buffer
  label: string | null
  created_at: string
  updated_at: string
}

export interface CredentialMeta {
  id: string
  domain: string
  username: string
  label: string | null
}

const CHARSET_LOWER = 'abcdefghijklmnopqrstuvwxyz'
const CHARSET_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const CHARSET_DIGITS = '0123456789'
const CHARSET_SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?'
const CHARSET_ALL = CHARSET_LOWER + CHARSET_UPPER + CHARSET_DIGITS + CHARSET_SYMBOLS

export default class CredentialVault {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'credentials.db')
    this.db = new Database(dbPath)

    // Restrict DB file to owner-only (0o600) — domain+username metadata is plaintext
    try { fs.chmodSync(dbPath, 0o600) } catch { /* Windows no-op */ } // eslint-disable-line security/detect-non-literal-fs-filename

    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // better-sqlite3 db.exec — not shell exec (security-check safe)
    const migrate = this.db.transaction(() => {
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS credentials (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          username TEXT NOT NULL,
          encrypted_password BLOB NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(domain, username)
        )
      `).run()
      this.db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_credentials_domain ON credentials(domain)
      `).run()
    })
    migrate()
  }

  store(domain: string, username: string, plaintextPassword: string, label?: string): string {
    const normalizedDomain = normalizeDomain(domain)
    const encrypted = safeStorage.encryptString(plaintextPassword)
    const id = crypto.randomUUID()

    this.db.prepare(`
      INSERT INTO credentials (id, domain, username, encrypted_password, label)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(domain, username) DO UPDATE SET
        encrypted_password = excluded.encrypted_password,
        label = excluded.label,
        updated_at = datetime('now')
    `).run(id, normalizedDomain, username, encrypted, label ?? null)

    return id
  }

  findByDomain(domain: string): CredentialMeta[] {
    const normalizedDomain = normalizeDomain(domain)
    const rows = this.db.prepare(`
      SELECT id, domain, username, label FROM credentials WHERE domain = ?
    `).all(normalizedDomain) as Pick<CredentialRow, 'id' | 'domain' | 'username' | 'label'>[]

    return rows.map((r) => ({ id: r.id, domain: r.domain, username: r.username, label: r.label }))
  }

  resolve(id: string): string | null {
    const row = this.db.prepare(`
      SELECT encrypted_password FROM credentials WHERE id = ?
    `).get(id) as Pick<CredentialRow, 'encrypted_password'> | undefined

    if (!row) return null
    return safeStorage.decryptString(Buffer.from(row.encrypted_password))
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id)
  }

  listAll(): CredentialMeta[] {
    const rows = this.db.prepare(`
      SELECT id, domain, username, label FROM credentials ORDER BY domain, username
    `).all() as Pick<CredentialRow, 'id' | 'domain' | 'username' | 'label'>[]

    return rows.map((r) => ({ id: r.id, domain: r.domain, username: r.username, label: r.label }))
  }

  generateSecurePassword(length = 20): string {
    if (length < 8 || length > 128) {
      throw new Error('Password length must be between 8 and 128')
    }

    const charsetLen = CHARSET_ALL.length
    // Rejection sampling: avoid modulo bias
    const maxValid = 256 - (256 % charsetLen)
    const result = new Array<string>(length)

    // Guarantee at least one character from each group
    result[0] = randomCharFrom(CHARSET_LOWER, maxValid)
    result[1] = randomCharFrom(CHARSET_UPPER, maxValid)
    result[2] = randomCharFrom(CHARSET_DIGITS, maxValid)
    result[3] = randomCharFrom(CHARSET_SYMBOLS, maxValid)

    // Fill remaining
    for (let i = 4; i < length; i++) {
      result[i] = randomCharFrom(CHARSET_ALL, maxValid)
    }

    // Fisher-Yates shuffle
    for (let i = result.length - 1; i > 0; i--) {
      const bytes = crypto.randomBytes(4)
      const j = bytes.readUInt32BE(0) % (i + 1)
      const tmp = result[i]!
      result[i] = result[j]!
      result[j] = tmp
    }

    return result.join('')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDomain(domain: string): string {
  try {
    return new URL('https://' + domain).hostname
  } catch {
    return domain.toLowerCase().trim()
  }
}

function randomCharFrom(charset: string, maxValid: number): string {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const byte = crypto.randomBytes(1)[0]!
    if (byte < maxValid) {
      return charset[byte % charset.length]!
    }
  }
}
