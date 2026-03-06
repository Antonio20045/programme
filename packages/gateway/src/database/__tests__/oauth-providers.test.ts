/**
 * Tests for OAuth Providers CRUD module.
 * Run: cd packages/gateway && npx vitest run src/database/__tests__/oauth-providers.test.ts
 */

import { vi, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Mock crypto module BEFORE importing oauth-providers
// ---------------------------------------------------------------------------

vi.mock('../crypto.js', () => ({
  encryptToken: vi.fn((plain: string) => `encrypted-${plain}`),
  decryptToken: vi.fn((enc: string) => `decrypted-${enc}`),
}))

import {
  getProvider,
  getAllProviders,
  getEnabledProviders,
  upsertProviderFromEnv,
} from '../oauth-providers.js'
import { encryptToken, decryptToken } from '../crypto.js'

// ---------------------------------------------------------------------------
// Source code for security audit
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(__dirname, '../oauth-providers.ts')
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool = { query: mockQuery }

const GOOGLE_ROW = {
  id: 'google',
  display_name: 'Google',
  client_id: 'real-client-id',
  client_secret_enc: 'enc-secret',
  authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_url: 'https://oauth2.googleapis.com/token',
  revoke_url: 'https://oauth2.googleapis.com/revoke',
  scopes: { gmail: 'https://www.googleapis.com/auth/gmail.modify' },
  icon_url: null,
  enabled: true,
}

const PENDING_ROW = {
  ...GOOGLE_ROW,
  client_id: 'pending',
  client_secret_enc: 'pending',
  enabled: false,
}

beforeEach(() => {
  mockQuery.mockReset()
  vi.mocked(encryptToken).mockClear()
  vi.mocked(decryptToken).mockClear()
})

afterEach(() => {
  delete process.env['GOOGLE_CLIENT_ID']
  delete process.env['GOOGLE_CLIENT_SECRET']
})

// ---------------------------------------------------------------------------
// getProvider
// ---------------------------------------------------------------------------

describe('getProvider', () => {
  it('returns provider with decrypted secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [GOOGLE_ROW] })

    const provider = await getProvider(mockPool, 'google')

    expect(provider).not.toBeNull()
    expect(provider!.id).toBe('google')
    expect(provider!.displayName).toBe('Google')
    expect(provider!.clientId).toBe('real-client-id')
    expect(provider!.clientSecret).toBe('decrypted-enc-secret')
    expect(decryptToken).toHaveBeenCalledWith('enc-secret')
    expect(provider!.authorizeUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(provider!.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(provider!.revokeUrl).toBe('https://oauth2.googleapis.com/revoke')
    expect(provider!.scopes).toEqual({ gmail: 'https://www.googleapis.com/auth/gmail.modify' })
    expect(provider!.enabled).toBe(true)
  })

  it('returns null for non-existent provider', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const provider = await getProvider(mockPool, 'spotify')

    expect(provider).toBeNull()
  })

  it('returns null when client_id is pending', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PENDING_ROW] })

    const provider = await getProvider(mockPool, 'google')

    expect(provider).toBeNull()
  })

  it('uses parameterized query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await getProvider(mockPool, 'google')

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      ['google'],
    )
  })
})

// ---------------------------------------------------------------------------
// getAllProviders
// ---------------------------------------------------------------------------

describe('getAllProviders', () => {
  it('filters out pending entries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [GOOGLE_ROW, PENDING_ROW] })

    const providers = await getAllProviders(mockPool)

    // PENDING_ROW has client_id = 'pending', should be filtered
    expect(providers).toHaveLength(1)
    expect(providers[0]!.id).toBe('google')
  })

  it('returns empty array when no providers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const providers = await getAllProviders(mockPool)

    expect(providers).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getEnabledProviders
// ---------------------------------------------------------------------------

describe('getEnabledProviders', () => {
  it('returns only enabled non-pending providers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [GOOGLE_ROW] })

    const providers = await getEnabledProviders(mockPool)

    expect(providers).toHaveLength(1)
    expect(providers[0]!.enabled).toBe(true)

    // Verify query filters at SQL level
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("enabled = true"),
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("client_id != 'pending'"),
    )
  })
})

// ---------------------------------------------------------------------------
// upsertProviderFromEnv
// ---------------------------------------------------------------------------

describe('upsertProviderFromEnv', () => {
  it('updates pending provider with ENV credentials', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'env-client-id'
    process.env['GOOGLE_CLIENT_SECRET'] = 'env-client-secret'

    // SELECT returns pending entry
    mockQuery.mockResolvedValueOnce({
      rows: [{ client_id: 'pending', enabled: false }],
    })
    // UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await upsertProviderFromEnv(mockPool)

    expect(mockQuery).toHaveBeenCalledTimes(2)
    const updateCall = mockQuery.mock.calls[1]!
    expect(updateCall[0]).toContain('UPDATE oauth_providers')
    expect(updateCall[1]).toEqual([
      'env-client-id',
      'encrypted-env-client-secret',
      'google',
    ])
    expect(encryptToken).toHaveBeenCalledWith('env-client-secret')
  })

  it('does nothing when ENV vars are not set', async () => {
    // No GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET

    await upsertProviderFromEnv(mockPool)

    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('does nothing when provider already has real credentials', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'env-client-id'
    process.env['GOOGLE_CLIENT_SECRET'] = 'env-client-secret'

    // SELECT returns already-configured entry
    mockQuery.mockResolvedValueOnce({
      rows: [{ client_id: 'real-client-id', enabled: true }],
    })

    await upsertProviderFromEnv(mockPool)

    // Only the SELECT, no UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('does nothing when provider does not exist in DB', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'env-client-id'
    process.env['GOOGLE_CLIENT_SECRET'] = 'env-client-secret'

    mockQuery.mockResolvedValueOnce({ rows: [] })

    await upsertProviderFromEnv(mockPool)

    expect(mockQuery).toHaveBeenCalledTimes(1)
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

  it('uses no dynamic SQL (string concatenation in queries)', () => {
    // All queries should use $1, $2, ... parameterized placeholders
    // No template literals or string concat in query strings
    const queryLines = SOURCE_CODE.split('\n').filter((line) =>
      line.includes('pool.query'),
    )
    for (const line of queryLines) {
      expect(line).not.toMatch(/`.*\$\{/)
    }
  })

  it('imports only from crypto.js (no external deps)', () => {
    const imports = SOURCE_CODE.match(/from\s+['"]([^'"]+)['"]/g) ?? []
    for (const imp of imports) {
      expect(imp).toMatch(/crypto\.js/)
    }
  })
})
