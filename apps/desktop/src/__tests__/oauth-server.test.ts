import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockServer = vi.hoisted(() => ({
  listen: vi.fn(),
  close: vi.fn((_cb?: () => void) => { _cb?.() }),
  on: vi.fn(),
}))

const mockCreateServer = vi.hoisted(() => vi.fn(() => mockServer))

const mockFetch = vi.hoisted(() => vi.fn())
const mockSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
  decryptString: vi.fn((b: Buffer) => String(b).replace('enc:', '')),
}))

const mockFs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  accessSync: vi.fn(),
  constants: { F_OK: 0 },
  readdirSync: vi.fn(() => []),
}))

vi.mock('node:http', () => ({ default: { createServer: mockCreateServer } }))
vi.mock('node:crypto', () => ({ default: { randomUUID: () => 'test-state-uuid' } }))
vi.mock('electron', () => ({
  net: { fetch: mockFetch },
  safeStorage: mockSafeStorage,
}))
vi.mock('fs', () => ({ default: mockFs }))

import { OAuthServer, exchangeAndStoreTokens, getValidToken, revokeTokens, getIntegrationStatus } from '../main/oauth-server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  vi.clearAllMocks()
  mockServer.listen.mockReset()
  mockServer.close.mockReset().mockImplementation((_cb?: () => void) => { _cb?.() })
  mockServer.on.mockReset()
  mockCreateServer.mockReset().mockReturnValue(mockServer)
  mockFetch.mockReset()
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
  mockFs.accessSync.mockReset()

  process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'test-client-id'
  process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = 'test-client-secret'
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthServer', () => {
  beforeEach(resetMocks)

  afterEach(() => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID']
    delete process.env['GOOGLE_OAUTH_CLIENT_SECRET']
  })

  describe('start', () => {
    it('creates HTTP server on 127.0.0.1', () => {
      const server = new OAuthServer()
      server.start()
      expect(mockCreateServer).toHaveBeenCalledOnce()
      expect(mockServer.listen).toHaveBeenCalledWith(18790, '127.0.0.1')
    })

    it('registers error handler', () => {
      const server = new OAuthServer()
      server.start()
      expect(mockServer.on).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  describe('buildAuthUrl', () => {
    it('builds URL for gmail with correct scope', () => {
      const server = new OAuthServer()
      server.start()
      const url = server.buildAuthUrl('gmail')
      expect(url).toContain('accounts.google.com')
      expect(url).toContain('gmail.modify')
      expect(url).toContain('test-client-id')
      expect(url).toContain('test-state-uuid')
      expect(url).toContain('access_type=offline')
    })

    it('builds URL for calendar with correct scope', () => {
      const server = new OAuthServer()
      server.start()
      const url = server.buildAuthUrl('calendar')
      expect(url).toContain('auth%2Fcalendar')
    })

    it('builds URL for drive with correct scope', () => {
      const server = new OAuthServer()
      server.start()
      const url = server.buildAuthUrl('drive')
      expect(url).toContain('drive.file')
    })

    it('throws for unknown service', () => {
      const server = new OAuthServer()
      server.start()
      expect(() => server.buildAuthUrl('unknown')).toThrow('Unbekannter Service')
    })
  })

  describe('waitForCallback', () => {
    it('resolves with code on successful callback', async () => {
      const server = new OAuthServer()
      server.start()

      // Extract the request handler
      const handler = mockCreateServer.mock.calls[0]?.[0] as (req: unknown, res: unknown) => void

      const promise = server.waitForCallback(5000)

      // Simulate callback request
      const mockReq = { url: '/callback?code=auth-code-123&state=test-state-uuid' }
      const mockRes = { writeHead: vi.fn(), end: vi.fn() }
      handler(mockReq, mockRes)

      const code = await promise
      expect(code).toBe('auth-code-123')
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    })

    it('rejects on state mismatch', async () => {
      const server = new OAuthServer()
      server.start()

      const handler = mockCreateServer.mock.calls[0]?.[0] as (req: unknown, res: unknown) => void

      const promise = server.waitForCallback(5000)

      const mockReq = { url: '/callback?code=auth-code&state=wrong-state' }
      const mockRes = { writeHead: vi.fn(), end: vi.fn() }
      handler(mockReq, mockRes)

      await expect(promise).rejects.toThrow('State-Parameter')
      expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    })

    it('rejects on timeout', async () => {
      vi.useFakeTimers()
      const server = new OAuthServer()
      server.start()

      const promise = server.waitForCallback(1000)

      vi.advanceTimersByTime(1001)

      await expect(promise).rejects.toThrow('Zeitüberschreitung')
      vi.useRealTimers()
    })

    it('returns 404 for non-callback paths', () => {
      const server = new OAuthServer()
      server.start()

      const handler = mockCreateServer.mock.calls[0]?.[0] as (req: unknown, res: unknown) => void
      const mockReq = { url: '/other' }
      const mockRes = { writeHead: vi.fn(), end: vi.fn() }
      handler(mockReq, mockRes)

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
    })
  })

  describe('stop', () => {
    it('closes the server', async () => {
      const server = new OAuthServer()
      server.start()
      await server.stop()
      expect(mockServer.close).toHaveBeenCalled()
    })

    it('resolves when no server exists', async () => {
      const server = new OAuthServer()
      await server.stop() // Should not throw
    })
  })
})

describe('exchangeAndStoreTokens', () => {
  beforeEach(resetMocks)

  afterEach(() => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID']
    delete process.env['GOOGLE_OAUTH_CLIENT_SECRET']
  })

  it('sends correct POST body to token endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_in: 3600,
        scope: 'gmail.modify',
      }),
    })

    await exchangeAndStoreTokens('auth-code', 'gmail')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )

    const body = String(mockFetch.mock.calls[0]?.[1]?.body ?? '')
    expect(body).toContain('code=auth-code')
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('client_id=test-client-id')
  })

  it('stores encrypted token data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_in: 3600,
        scope: 'gmail.modify',
      }),
    })

    await exchangeAndStoreTokens('auth-code', 'gmail')

    expect(mockFs.mkdirSync).toHaveBeenCalled()
    expect(mockSafeStorage.encryptString).toHaveBeenCalled()
    expect(mockFs.writeFileSync).toHaveBeenCalled()

    const writtenPath = String(mockFs.writeFileSync.mock.calls[0]?.[0] ?? '')
    expect(writtenPath).toContain('oauth-gmail.enc')
  })

  it('throws on failed exchange', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    })

    await expect(exchangeAndStoreTokens('bad-code', 'gmail')).rejects.toThrow('Token-Exchange fehlgeschlagen')
  })
})

describe('getValidToken', () => {
  beforeEach(resetMocks)

  afterEach(() => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID']
    delete process.env['GOOGLE_OAUTH_CLIENT_SECRET']
  })

  it('returns access_token when not expired', async () => {
    const tokenData = {
      access_token: 'valid-at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'test',
      obtained_at: Date.now(),
    }
    mockFs.readFileSync.mockReturnValue(Buffer.from(`enc:${JSON.stringify(tokenData)}`))

    const token = await getValidToken('gmail')
    expect(token).toBe('valid-at')
  })

  it('refreshes expired token', async () => {
    const tokenData = {
      access_token: 'old-at',
      refresh_token: 'rt-refresh',
      expires_in: 3600,
      scope: 'test',
      obtained_at: Date.now() - 4_000_000, // expired
    }
    mockFs.readFileSync.mockReturnValue(Buffer.from(`enc:${JSON.stringify(tokenData)}`))

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'new-at',
        expires_in: 3600,
      }),
    })

    const token = await getValidToken('gmail')
    expect(token).toBe('new-at')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    )

    const body = String(mockFetch.mock.calls[0]?.[1]?.body ?? '')
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=rt-refresh')
  })

  it('stores refreshed token', async () => {
    const tokenData = {
      access_token: 'old-at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'test',
      obtained_at: Date.now() - 4_000_000,
    }
    mockFs.readFileSync.mockReturnValue(Buffer.from(`enc:${JSON.stringify(tokenData)}`))

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'new-at',
        expires_in: 3600,
      }),
    })

    await getValidToken('gmail')

    expect(mockSafeStorage.encryptString).toHaveBeenCalled()
    expect(mockFs.writeFileSync).toHaveBeenCalled()
  })

  it('throws when no token exists', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT') })

    await expect(getValidToken('gmail')).rejects.toThrow('Kein Token')
  })
})

describe('revokeTokens', () => {
  beforeEach(resetMocks)

  it('deletes credential file', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT') })

    await revokeTokens('gmail')

    expect(mockFs.unlinkSync).toHaveBeenCalled()
    const deletedPath = String(mockFs.unlinkSync.mock.calls[0]?.[0] ?? '')
    expect(deletedPath).toContain('oauth-gmail.enc')
  })

  it('attempts revoke at Google when token exists', async () => {
    const tokenData = {
      access_token: 'at-to-revoke',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'test',
      obtained_at: Date.now(),
    }
    mockFs.readFileSync.mockReturnValue(Buffer.from(`enc:${JSON.stringify(tokenData)}`))
    mockFetch.mockResolvedValue({ ok: true })

    await revokeTokens('gmail')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('at-to-revoke'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not throw when revoke fails', async () => {
    const tokenData = {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'test',
      obtained_at: Date.now(),
    }
    mockFs.readFileSync.mockReturnValue(Buffer.from(`enc:${JSON.stringify(tokenData)}`))
    mockFetch.mockRejectedValue(new Error('Network error'))

    await expect(revokeTokens('gmail')).resolves.toBeUndefined()
  })
})

describe('getIntegrationStatus', () => {
  beforeEach(resetMocks)

  it('returns correct booleans based on file existence', () => {
    mockFs.accessSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('oauth-gmail')) return undefined
      throw new Error('ENOENT')
    })

    const status = getIntegrationStatus()
    expect(status).toEqual({ gmail: true, calendar: false, drive: false })
  })

  it('returns all false when no files exist', () => {
    mockFs.accessSync.mockImplementation(() => { throw new Error('ENOENT') })

    const status = getIntegrationStatus()
    expect(status).toEqual({ gmail: false, calendar: false, drive: false })
  })

  it('returns all true when all files exist', () => {
    mockFs.accessSync.mockReturnValue(undefined)

    const status = getIntegrationStatus()
    expect(status).toEqual({ gmail: true, calendar: true, drive: true })
  })
})

describe('Security', () => {
  it('server binds to 127.0.0.1 only', () => {
    resetMocks()
    const server = new OAuthServer()
    server.start()
    expect(mockServer.listen).toHaveBeenCalledWith(18790, '127.0.0.1')
  })

  it('validates state parameter (CSRF protection)', async () => {
    resetMocks()
    const server = new OAuthServer()
    server.start()

    const handler = mockCreateServer.mock.calls[0]?.[0] as (req: unknown, res: unknown) => void
    const promise = server.waitForCallback(5000)

    const mockReq = { url: '/callback?code=code&state=attacker-state' }
    const mockRes = { writeHead: vi.fn(), end: vi.fn() }
    handler(mockReq, mockRes)

    await expect(promise).rejects.toThrow('State-Parameter')
  })

  it('does not contain eval or Function constructor', async () => {
    const { readFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = readFileSync(
      new URL('../main/oauth-server.ts', import.meta.url),
      'utf-8',
    )
    expect(source).not.toMatch(/\beval\s*\(/)
    expect(source).not.toMatch(/new\s+Function\s*\(/)
  })

  it('reads client credentials from env vars only', async () => {
    const { readFileSync } = await vi.importActual<typeof import('fs')>('fs')
    const source = readFileSync(
      new URL('../main/oauth-server.ts', import.meta.url),
      'utf-8',
    )
    // No hardcoded client IDs or secrets
    expect(source).not.toMatch(/client_id\s*[:=]\s*['"][^'"{]+['"]/)
    expect(source).not.toMatch(/client_secret\s*[:=]\s*['"][^'"{]+['"]/)
    // Uses process.env
    expect(source).toContain("process.env['GOOGLE_OAUTH_CLIENT_ID']")
    expect(source).toContain("process.env['GOOGLE_OAUTH_CLIENT_SECRET']")
  })
})
