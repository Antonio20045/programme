/**
 * AES-256-GCM encryption for sensitive data (OAuth tokens, etc.).
 * Uses node:crypto only — zero external dependencies.
 *
 * Format: iv:authTag:ciphertext (all hex-encoded)
 * Key: TOKEN_ENCRYPTION_KEY env var (64-char hex = 32 bytes)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export function getEncryptionKey(): Buffer {
  const hex = process.env['TOKEN_ENCRYPTION_KEY']
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid ciphertext format')
  const iv = Buffer.from(parts[0]!, 'hex')
  const authTag = Buffer.from(parts[1]!, 'hex')
  const encrypted = Buffer.from(parts[2]!, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf-8') + decipher.final('utf-8')
}
