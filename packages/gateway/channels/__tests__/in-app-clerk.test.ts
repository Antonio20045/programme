/**
 * Clerk Auth Guard tests for in-app.ts handleRequest().
 *
 * NOTE: This test is excluded from root `pnpm test` (gateway is excluded
 * in vitest.config.ts). Run standalone:
 *   npx vitest run packages/gateway/channels/__tests__/in-app-clerk.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { InAppChannelAdapter } from '../in-app'

// Mock @clerk/backend
const mockVerifyToken = vi.fn()
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    verifyToken: mockVerifyToken,
  }),
}))

function createMockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: 'GET',
    url: '/api/sessions',
    headers: {},
    ...overrides,
  } as unknown as IncomingMessage
}

function createMockRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 200,
    body: '',
    writableEnded: false,
    writeHead(status: number, headers: Record<string, string>) {
      this.statusCode = status
      void headers
      return this
    },
    end(data?: string) {
      if (data) this.body = data
      this.writableEnded = true
      return this
    },
    write() { return true },
    on() { return this },
  } as unknown as ServerResponse & { statusCode: number; body: string }
  return res
}

describe('In-App Clerk Auth Guard', () => {
  let adapter: InAppChannelAdapter
  const originalEnv = process.env['CLERK_SECRET_KEY']

  beforeEach(() => {
    adapter = new InAppChannelAdapter()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['CLERK_SECRET_KEY'] = originalEnv
    } else {
      delete process.env['CLERK_SECRET_KEY']
    }
  })

  it('passes through when CLERK_SECRET_KEY is not set', async () => {
    delete process.env['CLERK_SECRET_KEY']
    const req = createMockReq()
    const res = createMockRes()

    const handled = await adapter.handleRequest(req, res)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(mockVerifyToken).not.toHaveBeenCalled()
  })

  it('returns 401 when CLERK_SECRET_KEY is set but no X-Clerk-Token header', async () => {
    process.env['CLERK_SECRET_KEY'] = 'sk_test_abc123'
    const req = createMockReq({ headers: {} })
    const res = createMockRes()

    const handled = await adapter.handleRequest(req, res)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
    expect(res.body).toContain('Clerk token required')
  })

  it('returns 401 when CLERK_SECRET_KEY is set and token is invalid', async () => {
    process.env['CLERK_SECRET_KEY'] = 'sk_test_abc123'
    mockVerifyToken.mockRejectedValue(new Error('Invalid token'))

    const req = createMockReq({
      headers: { 'x-clerk-token': 'invalid-jwt' },
    })
    const res = createMockRes()

    const handled = await adapter.handleRequest(req, res)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(401)
    expect(res.body).toContain('Invalid Clerk token')
  })

  it('serves route when CLERK_SECRET_KEY is set and token is valid', async () => {
    process.env['CLERK_SECRET_KEY'] = 'sk_test_abc123'
    mockVerifyToken.mockResolvedValue({ sub: 'user_123' })

    const req = createMockReq({
      headers: { 'x-clerk-token': 'valid-jwt' },
    })
    const res = createMockRes()

    const handled = await adapter.handleRequest(req, res)

    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(mockVerifyToken).toHaveBeenCalledWith('valid-jwt')
  })
})
