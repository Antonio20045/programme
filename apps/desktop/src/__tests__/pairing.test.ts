/* eslint-disable security/detect-non-literal-fs-filename */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mock electron before importing
vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
}))

vi.mock('@ki-assistent/shared', () => ({
  generateKeyPair: vi.fn(() => ({
    publicKey: new Uint8Array(32).fill(1),
    secretKey: new Uint8Array(32).fill(2),
  })),
  toBase64: vi.fn((data: Uint8Array) => Buffer.from(data).toString('base64')),
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QRCODE') },
}))

import { PairingManager } from '../main/pairing'
import { net, safeStorage } from 'electron'

const PAIRING_DIR = path.join(os.homedir(), '.openclaw')
const PAIRING_JSON = path.join(PAIRING_DIR, 'pairing.json')
const CRED_DIR = path.join(PAIRING_DIR, 'credentials')

const MOCK_RELAY_URL = 'https://relay.example.com'
const MOCK_TOKEN = 'abc123token'

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('PairingManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any written files
    try { fs.unlinkSync(PAIRING_JSON) } catch { /* noop */ }
    try {
      for (const f of fs.readdirSync(CRED_DIR)) {
        if (f.startsWith('pairing:')) fs.unlinkSync(path.join(CRED_DIR, f))
      }
    } catch { /* noop */ }
  })

  it('constructor rejects invalid relay URLs', () => {
    expect(() => new PairingManager('ftp://relay.example.com')).toThrow()
    expect(() => new PairingManager('http://evil.example.com')).toThrow()
    expect(() => new PairingManager('https://relay.example.com')).not.toThrow()
    expect(() => new PairingManager('http://localhost:8787')).not.toThrow()
    expect(() => new PairingManager('http://127.0.0.1:8787')).not.toThrow()
  })

  it('initPairing generates keypair, calls relay, returns QR data URL', async () => {
    const fetchMock = mockFetchResponse(201, {
      pairingToken: MOCK_TOKEN,
      expiresAt: Date.now() + 300_000,
    })
    vi.mocked(net.fetch).mockImplementation(fetchMock)

    const mgr = new PairingManager(MOCK_RELAY_URL)
    const result = await mgr.initPairing()

    expect(result.qrDataUrl).toBe('data:image/png;base64,QRCODE')
    expect(result.pairingToken).toBe(MOCK_TOKEN)
    expect(result.deviceId).toMatch(/^[0-9a-f]{32}$/)
    expect(result.expiresAt).toBeGreaterThan(Date.now())

    // Verify relay was called
    expect(net.fetch).toHaveBeenCalledWith(
      `${MOCK_RELAY_URL}/pair/init`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('QR payload contains all 4 required fields', async () => {
    const fetchMock = mockFetchResponse(201, {
      pairingToken: MOCK_TOKEN,
      expiresAt: Date.now() + 300_000,
    })
    vi.mocked(net.fetch).mockImplementation(fetchMock)

    const QRCode = await import('qrcode')
    const mgr = new PairingManager(MOCK_RELAY_URL)
    await mgr.initPairing()

    const toDataURL = vi.mocked(QRCode.default.toDataURL)
    expect(toDataURL).toHaveBeenCalled()
    const qrPayloadStr = toDataURL.mock.calls[0]![0] as string
    const qrPayload = JSON.parse(qrPayloadStr) as Record<string, unknown>

    expect(qrPayload).toHaveProperty('relayUrl', MOCK_RELAY_URL)
    expect(qrPayload).toHaveProperty('pairingToken', MOCK_TOKEN)
    expect(qrPayload).toHaveProperty('deviceId')
    expect(qrPayload).toHaveProperty('publicKey')
  })

  it('pollPairingStatus with paired=false does not store anything', async () => {
    const fetchMock = mockFetchResponse(200, { paired: false, expiresAt: Date.now() + 300_000 })
    vi.mocked(net.fetch).mockImplementation(fetchMock)

    const mgr = new PairingManager(MOCK_RELAY_URL)
    const result = await mgr.pollPairingStatus(MOCK_TOKEN)

    expect(result.paired).toBe(false)
    expect(fs.existsSync(PAIRING_JSON)).toBe(false)
  })

  it('pollPairingStatus with paired=true stores JWT and partner in pairing.json', async () => {
    // First call: initPairing to set deviceId
    const initFetch = mockFetchResponse(201, {
      pairingToken: MOCK_TOKEN,
      expiresAt: Date.now() + 300_000,
    })
    vi.mocked(net.fetch).mockImplementation(initFetch)

    const mgr = new PairingManager(MOCK_RELAY_URL)
    await mgr.initPairing()

    // Second call: pollPairingStatus
    const pollFetch = mockFetchResponse(200, {
      paired: true,
      partnerDeviceId: 'aabb00112233aabb00112233aabb0011',
      partnerPublicKey: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==',
      jwt: 'jwt-for-desktop',
    })
    vi.mocked(net.fetch).mockImplementation(pollFetch)

    const result = await mgr.pollPairingStatus(MOCK_TOKEN)

    expect(result.paired).toBe(true)
    expect(result.partnerDeviceId).toBe('aabb00112233aabb00112233aabb0011')

    // Verify pairing.json was written
    expect(fs.existsSync(PAIRING_JSON)).toBe(true)
    const stored = JSON.parse(fs.readFileSync(PAIRING_JSON, 'utf-8')) as Record<string, unknown>
    expect(stored['partnerDeviceId']).toBe('aabb00112233aabb00112233aabb0011')
    expect(stored['relayUrl']).toBe(MOCK_RELAY_URL)
  })

  it('expired token (410) does not crash', async () => {
    const fetchMock = mockFetchResponse(410, { error: 'Token expired', code: 'TOKEN_EXPIRED' })
    vi.mocked(net.fetch).mockImplementation(fetchMock)

    const mgr = new PairingManager(MOCK_RELAY_URL)
    const result = await mgr.pollPairingStatus(MOCK_TOKEN)

    expect(result.paired).toBe(false)
  })

  it('unpair calls relay DELETE and removes local data', async () => {
    // Setup: write pairing.json and credentials
    const mgr = new PairingManager(MOCK_RELAY_URL)
    fs.mkdirSync(PAIRING_DIR, { recursive: true })
    fs.writeFileSync(PAIRING_JSON, JSON.stringify({
      deviceId: 'aabb00112233aabb00112233aabb0011',
      partnerDeviceId: 'ccdd00112233ccdd00112233ccdd0011',
      partnerPublicKey: 'AQEBAQ==',
      relayUrl: MOCK_RELAY_URL,
      pairedAt: new Date().toISOString(),
    }))
    mgr.storeSecret('pairing:jwt', 'fake-jwt')

    const fetchMock = mockFetchResponse(200, { ok: true })
    vi.mocked(net.fetch).mockImplementation(fetchMock)

    await mgr.unpair()

    // Verify relay DELETE was called
    expect(net.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/pair/'),
      expect.objectContaining({ method: 'DELETE' }),
    )

    // Verify local data deleted
    expect(fs.existsSync(PAIRING_JSON)).toBe(false)
  })

  it('uses in-memory fallback when safeStorage is not available', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)

    const mgr = new PairingManager(MOCK_RELAY_URL)
    mgr.storeSecret('test-key', 'test-value')

    // Should retrieve from memory
    expect(mgr.getSecret('test-key')).toBe('test-value')

    // Should NOT have written to disk
    const encFile = path.join(CRED_DIR, 'test-key.enc')
    expect(fs.existsSync(encFile)).toBe(false)
  })

  it('SECURITY: private key is NOT in pairing.json', async () => {
    // Init pairing to generate keys
    const initFetch = mockFetchResponse(201, {
      pairingToken: MOCK_TOKEN,
      expiresAt: Date.now() + 300_000,
    })
    vi.mocked(net.fetch).mockImplementation(initFetch)

    const mgr = new PairingManager(MOCK_RELAY_URL)
    await mgr.initPairing()

    // Complete pairing
    const pollFetch = mockFetchResponse(200, {
      paired: true,
      partnerDeviceId: 'aabb00112233aabb00112233aabb0011',
      partnerPublicKey: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==',
      jwt: 'jwt-for-desktop',
    })
    vi.mocked(net.fetch).mockImplementation(pollFetch)

    await mgr.pollPairingStatus(MOCK_TOKEN)

    // Read pairing.json and verify NO secrets
    const content = fs.readFileSync(PAIRING_JSON, 'utf-8')
    expect(content).not.toContain('secretKey')
    expect(content).not.toContain('privateKey')
    expect(content).not.toContain('jwt')
    // Only public data allowed
    const parsed = JSON.parse(content) as Record<string, unknown>
    const keys = Object.keys(parsed)
    expect(keys).toEqual(
      expect.arrayContaining(['deviceId', 'partnerDeviceId', 'partnerPublicKey', 'relayUrl', 'pairedAt']),
    )
    expect(keys.length).toBe(5)
  })
})
