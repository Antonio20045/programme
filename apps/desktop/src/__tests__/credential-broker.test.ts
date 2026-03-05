import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockShowMessageBox = vi.fn()

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: (...args: unknown[]) => mockShowMessageBox(...args),
  },
}))

function createMockVault(credentials: Array<{ id: string; domain: string; username: string; label: string | null }> = [], resolvedPassword: string | null = 'secret') {
  return {
    findByDomain: vi.fn(() => credentials),
    resolve: vi.fn(() => resolvedPassword),
    store: vi.fn(),
    delete: vi.fn(),
    listAll: vi.fn(() => []),
    generateSecurePassword: vi.fn(() => 'generated'),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialBroker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  async function importBroker() {
    vi.resetModules()
    const mod = await import('../main/credential-broker')
    return mod.default
  }

  it('resolves credential after user approval', async () => {
    const BrokerClass = await importBroker()
    const vault = createMockVault(
      [{ id: 'cred-1', domain: 'example.com', username: 'user1', label: null }],
      'mypassword',
    )
    const broker = new BrokerClass(vault as never, null)
    mockShowMessageBox.mockResolvedValue({ response: 0 })

    const result = await broker.resolveForUrl('https://example.com/login')

    expect(vault.findByDomain).toHaveBeenCalledWith('example.com')
    expect(vault.resolve).toHaveBeenCalledWith('cred-1')
    expect(result).toBe('mypassword')
    broker.destroy()
  })

  it('throws when user denies credential access', async () => {
    const BrokerClass = await importBroker()
    const vault = createMockVault(
      [{ id: 'cred-1', domain: 'example.com', username: 'user1', label: null }],
    )
    const broker = new BrokerClass(vault as never, null)
    mockShowMessageBox.mockResolvedValue({ response: 1 })

    await expect(broker.resolveForUrl('https://example.com/login'))
      .rejects.toThrow('abgelehnt')

    expect(vault.resolve).not.toHaveBeenCalled()
    broker.destroy()
  })

  it('throws when no credentials found for domain', async () => {
    const BrokerClass = await importBroker()
    const vault = createMockVault([])
    const broker = new BrokerClass(vault as never, null)

    await expect(broker.resolveForUrl('https://unknown.com/page'))
      .rejects.toThrow('Keine Credentials')

    expect(mockShowMessageBox).not.toHaveBeenCalled()
    broker.destroy()
  })

  it('throws on invalid URL', async () => {
    const BrokerClass = await importBroker()
    const vault = createMockVault()
    const broker = new BrokerClass(vault as never, null)

    await expect(broker.resolveForUrl('not-a-url'))
      .rejects.toThrow('Ungültige URL')
    broker.destroy()
  })

  it('throws when vault.resolve returns null', async () => {
    const BrokerClass = await importBroker()
    const vault = createMockVault(
      [{ id: 'cred-1', domain: 'example.com', username: 'user1', label: null }],
      null,
    )
    const broker = new BrokerClass(vault as never, null)
    mockShowMessageBox.mockResolvedValue({ response: 0 })

    await expect(broker.resolveForUrl('https://example.com/login'))
      .rejects.toThrow('nicht entschlüsselt')
    broker.destroy()
  })

  it('SECURITY: dialog is shown before resolving password', async () => {
    const BrokerClass = await importBroker()
    const callOrder: string[] = []
    const vault = createMockVault(
      [{ id: 'cred-1', domain: 'example.com', username: 'user1', label: null }],
      'secret',
    )
    vault.resolve = vi.fn(() => {
      callOrder.push('resolve')
      return 'secret'
    })
    mockShowMessageBox.mockImplementation(() => {
      callOrder.push('dialog')
      return Promise.resolve({ response: 0 })
    })

    const broker = new BrokerClass(vault as never, null)
    await broker.resolveForUrl('https://example.com/login')

    expect(callOrder).toEqual(['dialog', 'resolve'])
    broker.destroy()
  })

  it('destroy cleans up interval', async () => {
    const BrokerClass = await importBroker()
    const vault = createMockVault()
    const broker = new BrokerClass(vault as never, null)

    // Should not throw
    broker.destroy()
  })
})
