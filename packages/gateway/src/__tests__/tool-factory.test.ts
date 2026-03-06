/**
 * Unit tests for per-user Tool-Context Factory.
 *
 * Run: cd packages/gateway && npx vitest run src/__tests__/tool-factory.test.ts
 */

import { vi, beforeEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Mock crypto module BEFORE importing tool-factory
// ---------------------------------------------------------------------------

vi.mock('../database/crypto.js', () => ({
  decryptToken: vi.fn((enc: string) => `decrypted-${enc}`),
  encryptToken: vi.fn((plain: string) => `encrypted-${plain}`),
}))

// ---------------------------------------------------------------------------
// Mock oauth-providers module
// ---------------------------------------------------------------------------

const mockGetProvider = vi.fn()

vi.mock('../database/oauth-providers.js', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}))

// ---------------------------------------------------------------------------
// Mock agent tools
// ---------------------------------------------------------------------------

const mockDelegateTool = {
  name: 'delegate',
  description: 'Delegate tasks to sub-agents',
  parameters: { type: 'object' as const, properties: {}, required: [] },
  permissions: [],
  requiresConfirmation: true,
  runsOn: 'server' as const,
  defaultRiskTier: 2 as const,
  execute: vi.fn(),
}

const mockAgentFactoryTool = {
  name: 'create-agent',
  description: 'Create a new sub-agent',
  parameters: { type: 'object' as const, properties: {}, required: [] },
  permissions: [],
  requiresConfirmation: true,
  runsOn: 'server' as const,
  defaultRiskTier: 2 as const,
  execute: vi.fn(),
}

vi.mock('../../../tools/src/delegate-tool.js', () => ({
  createDelegateTool: vi.fn(() => mockDelegateTool),
}))

vi.mock('../../../tools/src/agent-factory.js', () => ({
  createAgentFactoryTool: vi.fn(() => mockAgentFactoryTool),
}))

import { createUserTools } from '../tool-factory.js'
import { decryptToken, encryptToken } from '../database/crypto.js'
import { createDelegateTool } from '../../../tools/src/delegate-tool.js'
import { createAgentFactoryTool } from '../../../tools/src/agent-factory.js'

// ---------------------------------------------------------------------------
// Mock pool
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockPool = { query: mockQuery }

const USER_ID = 'user-123-uuid'

const GOOGLE_PROVIDER = {
  id: 'google',
  displayName: 'Google',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: { gmail: 'https://www.googleapis.com/auth/gmail.modify' },
  iconUrl: null,
  enabled: true,
}

beforeEach(() => {
  mockQuery.mockReset()
  mockGetProvider.mockReset()
  vi.mocked(decryptToken).mockClear()
  vi.mocked(encryptToken).mockClear()

  // Default: no provider configured (Case 1)
  mockGetProvider.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Base tests (Notes + Reminders — always present)
// ---------------------------------------------------------------------------

describe('createUserTools', () => {
  it('returns array with notes and reminders tools', async () => {
    const tools = await createUserTools(USER_ID, mockPool)

    expect(tools.length).toBeGreaterThanOrEqual(2)
    const names = tools.map((t) => t.name)
    expect(names).toContain('notes')
    expect(names).toContain('reminders')
  })

  it('tools have correct metadata', async () => {
    const tools = await createUserTools(USER_ID, mockPool)

    for (const tool of tools) {
      expect(tool.runsOn).toBe('server')
      expect(tool.parameters.type).toBe('object')
      expect(typeof tool.execute).toBe('function')
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('tools are bound to the provided userId', async () => {
    const tools = await createUserTools(USER_ID, mockPool)
    const notesTool = tools.find((t) => t.name === 'notes')!

    // Execute a listNotes action — the first query param should be our userId
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await notesTool.execute({ action: 'listNotes' })

    expect(mockQuery).toHaveBeenCalled()
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe(USER_ID)
  })

  it('different userIds produce isolated tools', async () => {
    const toolsA = await createUserTools('user-a', mockPool)
    const toolsB = await createUserTools('user-b', mockPool)

    const notesA = toolsA.find((t) => t.name === 'notes')!
    const notesB = toolsB.find((t) => t.name === 'notes')!

    // Each tool should pass its own userId
    mockQuery.mockResolvedValue({ rows: [] })

    await notesA.execute({ action: 'listNotes' })
    const paramsA = mockQuery.mock.calls[0]![1] as unknown[]
    expect(paramsA[0]).toBe('user-a')

    await notesB.execute({ action: 'listNotes' })
    const paramsB = mockQuery.mock.calls[1]![1] as unknown[]
    expect(paramsB[0]).toBe('user-b')
  })
})

// ---------------------------------------------------------------------------
// Case 1: Provider not configured → no Gmail, no Calendar, no placeholder
// ---------------------------------------------------------------------------

describe('Case 1: provider not configured', () => {
  it('excludes gmail/calendar/placeholder when getProvider returns null', async () => {
    mockGetProvider.mockResolvedValueOnce(null)

    const tools = await createUserTools(USER_ID, mockPool)
    const names = tools.map((t) => t.name)

    expect(names).not.toContain('gmail')
    expect(names).not.toContain('calendar')
    expect(names).not.toContain('connect-google')
    expect(tools).toHaveLength(2)

    // No DB queries for OAuth tokens
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Case 2: Provider configured + user has OAuth tokens → real tools
// ---------------------------------------------------------------------------

describe('Case 2: provider configured + user has tokens', () => {
  it('includes gmail and calendar when OAuth tokens exist', async () => {
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)

    // getProvider call (internal in loadGoogleOAuth) + user token query
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        access_token_enc: 'enc-access',
        refresh_token_enc: 'enc-refresh',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }],
    })

    const tools = await createUserTools(USER_ID, mockPool)
    const names = tools.map((t) => t.name)

    expect(names).toContain('gmail')
    expect(names).toContain('calendar')
    expect(names).toContain('notes')
    expect(names).toContain('reminders')
    expect(tools).toHaveLength(4)

    expect(decryptToken).toHaveBeenCalledWith('enc-access')
    expect(decryptToken).toHaveBeenCalledWith('enc-refresh')
  })

  it('queries correct table with userId and provider', async () => {
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await createUserTools(USER_ID, mockPool)

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT access_token_enc, refresh_token_enc, expires_at FROM user_oauth_tokens WHERE user_id = $1 AND provider = $2',
      [USER_ID, 'google'],
    )
  })

  it('handles null expires_at gracefully', async () => {
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        access_token_enc: 'enc-access',
        refresh_token_enc: 'enc-refresh',
        expires_at: null,
      }],
    })

    const tools = await createUserTools(USER_ID, mockPool)
    const names = tools.map((t) => t.name)
    expect(names).toContain('gmail')
    expect(names).toContain('calendar')
  })

  it('uses clientId and clientSecret from provider (not ENV)', async () => {
    const customProvider = {
      ...GOOGLE_PROVIDER,
      clientId: 'db-client-id',
      clientSecret: 'db-client-secret',
    }
    mockGetProvider.mockResolvedValueOnce(customProvider)
    mockGetProvider.mockResolvedValueOnce(customProvider)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        access_token_enc: 'enc-access',
        refresh_token_enc: 'enc-refresh',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }],
    })

    // Verify that getProvider was called with 'google'
    await createUserTools(USER_ID, mockPool)

    expect(mockGetProvider).toHaveBeenCalledWith(mockPool, 'google')
  })

  it('onTokenRefreshed writes encrypted token to DB', async () => {
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        access_token_enc: 'enc-access',
        refresh_token_enc: 'enc-refresh',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }],
    })

    const tools = await createUserTools(USER_ID, mockPool)
    const gmailTool = tools.find((t) => t.name === 'gmail')!
    expect(gmailTool).toBeDefined()

    // Stub fetch for the 401 → refresh → retry flow
    const mockFetchFn = vi.fn()
    vi.stubGlobal('fetch', mockFetchFn)

    // First call: 401
    mockFetchFn.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    )
    // Token refresh
    mockFetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600, token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    // Retry — empty inbox
    mockFetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // Mock the UPDATE query for onTokenRefreshed
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await gmailTool.execute({ action: 'readInbox' })

    // Verify UPDATE was called with encrypted token
    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).startsWith('UPDATE'),
    )
    expect(updateCall).toBeDefined()
    expect(encryptToken).toHaveBeenCalledWith('new-token')
    const updateParams = updateCall![1] as unknown[]
    expect(updateParams[0]).toBe('encrypted-new-token')
    expect(updateParams[2]).toBe(USER_ID)
    expect(updateParams[3]).toBe('google')

    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// Case 3: Provider configured + user has NO tokens → placeholder
// ---------------------------------------------------------------------------

describe('Case 3: provider configured + no user tokens', () => {
  it('returns connect-google placeholder when user has no tokens', async () => {
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const tools = await createUserTools(USER_ID, mockPool)
    const names = tools.map((t) => t.name)

    expect(names).toContain('connect-google')
    expect(names).not.toContain('gmail')
    expect(names).not.toContain('calendar')
    expect(tools).toHaveLength(3) // notes + reminders + connect-google
  })

  it('placeholder has correct description and execute response', async () => {
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockGetProvider.mockResolvedValueOnce(GOOGLE_PROVIDER)
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const tools = await createUserTools(USER_ID, mockPool)
    const placeholder = tools.find((t) => t.name === 'connect-google')!

    expect(placeholder).toBeDefined()
    expect(placeholder.description).toContain('Google')
    expect(placeholder.description).toContain('sign-in')
    expect(placeholder.runsOn).toBe('server')
    expect(placeholder.requiresConfirmation).toBe(true)

    const result = await placeholder.execute({})
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.type).toBe('text')
    expect((result.content[0] as { text: string }).text).toContain('Google')
    expect((result.content[0] as { text: string }).text).toContain('connected')
  })
})

// ---------------------------------------------------------------------------
// Case 4: Sub-Agent tools (delegate + agent-factory)
// ---------------------------------------------------------------------------

describe('Case 4: Sub-Agent tools', () => {
  const mockLlmClient = { chat: vi.fn() }

  it('does NOT include delegate/agent-factory without llmClient', async () => {
    const tools = await createUserTools(USER_ID, mockPool)
    const names = tools.map((t) => t.name)

    expect(names).not.toContain('delegate')
    expect(names).not.toContain('create-agent')
    expect(createDelegateTool).not.toHaveBeenCalled()
    expect(createAgentFactoryTool).not.toHaveBeenCalled()
  })

  it('includes delegate and agent-factory when llmClient is provided', async () => {
    const tools = await createUserTools(USER_ID, mockPool, mockLlmClient)
    const names = tools.map((t) => t.name)

    expect(names).toContain('delegate')
    expect(names).toContain('create-agent')
  })

  it('passes correct arguments to createDelegateTool', async () => {
    await createUserTools(USER_ID, mockPool, mockLlmClient)

    expect(createDelegateTool).toHaveBeenCalledWith(USER_ID, mockPool, mockLlmClient)
  })

  it('passes correct arguments to createAgentFactoryTool', async () => {
    await createUserTools(USER_ID, mockPool, mockLlmClient)

    expect(createAgentFactoryTool).toHaveBeenCalledWith(USER_ID, mockPool)
  })

  it('agent tools come after base tools', async () => {
    const tools = await createUserTools(USER_ID, mockPool, mockLlmClient)
    const names = tools.map((t) => t.name)

    expect(names.indexOf('notes')).toBeLessThan(names.indexOf('delegate'))
    expect(names.indexOf('reminders')).toBeLessThan(names.indexOf('delegate'))
  })
})
