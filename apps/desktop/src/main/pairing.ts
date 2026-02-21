/* eslint-disable security/detect-non-literal-fs-filename */
/* eslint-disable security/detect-object-injection */
import { net, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { generateKeyPair, toBase64 } from '@ki-assistent/shared'
import QRCode from 'qrcode'

const PAIRING_DIR = path.join(os.homedir(), '.openclaw')
const CREDENTIALS_DIR = path.join(PAIRING_DIR, 'credentials')
const PAIRING_JSON_PATH = path.join(PAIRING_DIR, 'pairing.json')

interface PairingData {
  deviceId: string
  partnerDeviceId: string
  partnerPublicKey: string
  relayUrl: string
  pairedAt: string
}

interface InitResult {
  qrDataUrl: string
  pairingToken: string
  deviceId: string
  expiresAt: number
}

interface PollResult {
  paired: boolean
  partnerDeviceId?: string
  partnerPublicKey?: string
  jwt?: string
}

/**
 * Validate relay URL: HTTPS required for external servers,
 * HTTP only allowed for localhost / 127.0.0.1 (wrangler dev).
 */
function validateRelayUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Ungültige Relay-URL'
  }
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname
    if (host === 'localhost' || host === '127.0.0.1') return null
    return 'HTTP nur für localhost erlaubt — verwende HTTPS für externe Server'
  }
  return 'Nur http:// oder https:// erlaubt'
}

// In-memory fallback when safeStorage is not available
const memoryStore = new Map<string, string>()

export class PairingManager {
  private relayUrl: string

  constructor(relayUrl: string) {
    const urlError = validateRelayUrl(relayUrl)
    if (urlError !== null) {
      throw new Error(urlError)
    }
    this.relayUrl = relayUrl
  }

  async initPairing(): Promise<InitResult> {
    const keyPair = generateKeyPair()
    const deviceId = randomUUID().replace(/-/g, '')
    const publicKeyB64 = toBase64(keyPair.publicKey)
    const secretKeyB64 = toBase64(keyPair.secretKey)

    // Store private key securely
    this.storeSecret('pairing:privateKey', secretKeyB64)
    this.storeSecret('pairing:deviceId', deviceId)

    // Call relay POST /pair/init
    const response = await net.fetch(`${this.relayUrl}/pair/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, publicKey: publicKeyB64 }),
    })

    if (!response.ok) {
      const err = (await response.json()) as { error?: string }
      throw new Error(err.error ?? `Relay error: ${String(response.status)}`)
    }

    const data = (await response.json()) as { pairingToken: string; expiresAt: number }

    // Generate QR code as data URL
    const qrPayload = JSON.stringify({
      relayUrl: this.relayUrl,
      pairingToken: data.pairingToken,
      deviceId,
      publicKey: publicKeyB64,
    })

    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 256, margin: 2 })

    return {
      qrDataUrl,
      pairingToken: data.pairingToken,
      deviceId,
      expiresAt: data.expiresAt,
    }
  }

  async pollPairingStatus(token: string): Promise<PollResult> {
    const response = await net.fetch(
      `${this.relayUrl}/pair/status?token=${encodeURIComponent(token)}`,
      { method: 'GET' },
    )

    if (response.status === 410) {
      return { paired: false }
    }

    if (response.status === 404) {
      return { paired: false }
    }

    if (!response.ok) {
      return { paired: false }
    }

    const data = (await response.json()) as {
      paired: boolean
      partnerDeviceId?: string
      partnerPublicKey?: string
      jwt?: string
    }

    if (data.paired && data.jwt && data.partnerDeviceId && data.partnerPublicKey) {
      // Store JWT securely
      this.storeSecret('pairing:jwt', data.jwt)

      // Store public pairing info (NO secrets)
      const pairingData: PairingData = {
        deviceId: this.getSecret('pairing:deviceId') ?? '',
        partnerDeviceId: data.partnerDeviceId,
        partnerPublicKey: data.partnerPublicKey,
        relayUrl: this.relayUrl,
        pairedAt: new Date().toISOString(),
      }

      fs.mkdirSync(PAIRING_DIR, { recursive: true })
      fs.writeFileSync(PAIRING_JSON_PATH, JSON.stringify(pairingData, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      })

      return {
        paired: true,
        partnerDeviceId: data.partnerDeviceId,
        partnerPublicKey: data.partnerPublicKey,
      }
    }

    return { paired: false }
  }

  getStoredPairing(): PairingData | null {
    try {
      const content = fs.readFileSync(PAIRING_JSON_PATH, 'utf-8')
      return JSON.parse(content) as PairingData
    } catch {
      return null
    }
  }

  async unpair(): Promise<void> {
    const stored = this.getStoredPairing()
    if (stored) {
      const jwt = this.getSecret('pairing:jwt')
      if (jwt) {
        try {
          await net.fetch(`${this.relayUrl}/pair/${stored.deviceId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${jwt}` },
          })
        } catch {
          // Relay unreachable — still clean up locally
        }
      }
    }

    // Delete local data
    try {
      fs.unlinkSync(PAIRING_JSON_PATH)
    } catch {
      // File may not exist
    }

    // Delete secrets
    this.deleteSecret('pairing:privateKey')
    this.deleteSecret('pairing:jwt')
    this.deleteSecret('pairing:deviceId')
  }

  storeSecret(key: string, value: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      fs.mkdirSync(CREDENTIALS_DIR, { recursive: true })
      const encrypted = safeStorage.encryptString(value)
      fs.writeFileSync(path.join(CREDENTIALS_DIR, `${key}.enc`), encrypted, { mode: 0o600 })
    } else {
      // In-memory only — will be lost on restart
      memoryStore.set(key, value)
    }
  }

  getSecret(key: string): string | null {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = fs.readFileSync(path.join(CREDENTIALS_DIR, `${key}.enc`))
        return safeStorage.decryptString(encrypted)
      } catch {
        return null
      }
    }
    return memoryStore.get(key) ?? null
  }

  private deleteSecret(key: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        fs.unlinkSync(path.join(CREDENTIALS_DIR, `${key}.enc`))
      } catch {
        // File may not exist
      }
    }
    memoryStore.delete(key)
  }
}
