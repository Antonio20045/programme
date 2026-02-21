import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoEval, assertNoUnauthorizedFetch } from './helpers'
import { whatsappTool, parseArgs, resetClient, setWhatsAppLoader, _resetRateLimit } from '../src/whatsapp'

// ---------------------------------------------------------------------------
// Source code for security tests
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = resolve(currentDir, '../src/whatsapp.ts')
const sourceCode = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Mock WhatsApp client
// ---------------------------------------------------------------------------

const mockSendMessage = vi.fn().mockResolvedValue({ id: 'msg1' })
const mockFetchMessages = vi.fn().mockResolvedValue([
  { body: 'Hello', from: 'user@c.us', to: 'me@c.us', timestamp: 1000, fromMe: false },
])
const mockSearchMessages = vi.fn().mockResolvedValue([
  { body: 'Found it', from: 'user@c.us', to: 'me@c.us', timestamp: 2000, fromMe: false },
])

const mockChats = [
  {
    id: { _serialized: 'chat1@c.us' },
    name: 'Alice',
    isGroup: false,
    unreadCount: 2,
    fetchMessages: mockFetchMessages,
    sendMessage: mockSendMessage,
  },
  {
    id: { _serialized: 'group1@g.us' },
    name: 'Family Group',
    isGroup: true,
    unreadCount: 0,
    fetchMessages: mockFetchMessages,
    sendMessage: mockSendMessage,
  },
]

const mockContacts = [
  { id: { _serialized: 'c1@c.us' }, name: 'Alice', pushname: 'Ali', isMyContact: true, isGroup: false },
  { id: { _serialized: 'c2@c.us' }, name: undefined, pushname: 'Bob', isMyContact: true, isGroup: false },
  { id: { _serialized: 'g1@g.us' }, name: 'Group', pushname: undefined, isMyContact: true, isGroup: true },
  { id: { _serialized: 'c3@c.us' }, name: 'Charlie', pushname: undefined, isMyContact: false, isGroup: false },
]

const mockGetChats = vi.fn().mockResolvedValue(mockChats)
const mockGetContacts = vi.fn().mockResolvedValue(mockContacts)
const mockGetChatById = vi.fn().mockResolvedValue(mockChats[0])
const mockInitialize = vi.fn()
const mockDestroy = vi.fn().mockResolvedValue(undefined)

type EventCallback = (...args: unknown[]) => void
let eventHandlers: Record<string, EventCallback> = {}

function createMockClient(): Record<string, unknown> {
  return {
    on: vi.fn((event: string, cb: EventCallback) => {
      eventHandlers[event] = cb
    }),
    initialize: mockInitialize,
    destroy: mockDestroy,
    getChats: mockGetChats,
    getContacts: mockGetContacts,
    getChatById: mockGetChatById,
    searchMessages: mockSearchMessages,
  }
}

function setupConnectedClient(): void {
  mockInitialize.mockImplementation(async () => {
    // Simulate ready event during initialize
    eventHandlers['ready']?.()
  })

  setWhatsAppLoader(async () => ({
    Client: class {
      constructor() {
        const mock = createMockClient()
        Object.assign(this, mock)
      }
    } as never,
    LocalAuth: class {
      constructor() { /* noop */ }
    } as never,
  }))
}

// Helper
function getTextContent(result: import('../src/types').AgentToolResult): string {
  const first = result.content[0]
  if (first === undefined || first.type !== 'text') {
    throw new Error('Expected text content')
  }
  return first.text
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('whatsapp tool', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    _resetRateLimit()
    eventHandlers = {}
    await resetClient()
    setupConnectedClient()
  })

  afterEach(async () => {
    await resetClient()
    setWhatsAppLoader(null)
  })

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe('metadata', () => {
    it('has correct name', () => {
      expect(whatsappTool.name).toBe('whatsapp')
    })

    it('runs on server', () => {
      expect(whatsappTool.runsOn).toBe('server')
    })

    it('requires confirmation', () => {
      expect(whatsappTool.requiresConfirmation).toBe(true)
    })

    it('has correct permissions', () => {
      expect(whatsappTool.permissions).toContain('net:http')
      expect(whatsappTool.permissions).toContain('whatsapp:send')
      expect(whatsappTool.permissions).toContain('whatsapp:read')
    })

    it('has action enum in parameters', () => {
      const actionProp = whatsappTool.parameters.properties['action']
      expect(actionProp?.enum).toEqual([
        'send', 'search', 'recent', 'chats', 'contacts', 'status', 'getQr',
      ])
    })
  })

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  describe('parseArgs()', () => {
    it('rejects null args', () => {
      expect(() => parseArgs(null)).toThrow('Arguments must be an object')
    })

    it('rejects unknown action', () => {
      expect(() => parseArgs({ action: 'hack' })).toThrow('action must be')
    })

    it('parses send action', () => {
      const result = parseArgs({ action: 'send', chatName: 'Alice', message: 'Hi!' })
      expect(result).toEqual({ action: 'send', chatName: 'Alice', message: 'Hi!' })
    })

    it('rejects send without chatName', () => {
      expect(() => parseArgs({ action: 'send', message: 'Hi' })).toThrow('chatName')
    })

    it('rejects send without message', () => {
      expect(() => parseArgs({ action: 'send', chatName: 'Alice' })).toThrow('message')
    })

    it('rejects message exceeding max length', () => {
      expect(() => parseArgs({ action: 'send', chatName: 'Alice', message: 'x'.repeat(5001) }))
        .toThrow('too long')
    })

    it('parses search action', () => {
      const result = parseArgs({ action: 'search', query: 'hello' })
      expect(result).toEqual({ action: 'search', query: 'hello', chatName: undefined })
    })

    it('parses search with chatName', () => {
      const result = parseArgs({ action: 'search', query: 'hello', chatName: 'Alice' })
      expect(result).toEqual({ action: 'search', query: 'hello', chatName: 'Alice' })
    })

    it('rejects search without query', () => {
      expect(() => parseArgs({ action: 'search' })).toThrow('query')
    })

    it('parses recent action', () => {
      const result = parseArgs({ action: 'recent', chatName: 'Alice' })
      expect(result).toEqual({ action: 'recent', chatName: 'Alice', count: 20 })
    })

    it('caps recent count at 100', () => {
      const result = parseArgs({ action: 'recent', chatName: 'Alice', count: 200 })
      expect(result).toEqual({ action: 'recent', chatName: 'Alice', count: 100 })
    })

    it('rejects recent with invalid count', () => {
      expect(() => parseArgs({ action: 'recent', chatName: 'Alice', count: -1 }))
        .toThrow('positive integer')
    })

    it('parses chats action', () => {
      expect(parseArgs({ action: 'chats' })).toEqual({ action: 'chats' })
    })

    it('parses contacts action', () => {
      expect(parseArgs({ action: 'contacts' })).toEqual({ action: 'contacts' })
    })

    it('parses status action', () => {
      expect(parseArgs({ action: 'status' })).toEqual({ action: 'status' })
    })

    it('parses getQr action', () => {
      expect(parseArgs({ action: 'getQr' })).toEqual({ action: 'getQr' })
    })
  })

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  describe('status', () => {
    it('returns disconnected initially', async () => {
      await resetClient()
      const result = await whatsappTool.execute({ action: 'status' })
      const parsed = JSON.parse(getTextContent(result)) as { status: string }
      expect(parsed.status).toBe('disconnected')
    })
  })

  // -------------------------------------------------------------------------
  // getQr
  // -------------------------------------------------------------------------

  describe('getQr', () => {
    it('returns null qr when no QR pending', async () => {
      await resetClient()
      const result = await whatsappTool.execute({ action: 'getQr' })
      const parsed = JSON.parse(getTextContent(result)) as { qr: string | null; status: string }
      expect(parsed.qr).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // send
  // -------------------------------------------------------------------------

  describe('send', () => {
    it('sends a message to a chat', async () => {
      const result = await whatsappTool.execute({ action: 'send', chatName: 'Alice', message: 'Hello!' })
      const parsed = JSON.parse(getTextContent(result)) as { sent: boolean; chatName: string }
      expect(parsed.sent).toBe(true)
      expect(parsed.chatName).toBe('Alice')
    })

    it('throws when chat not found', async () => {
      await expect(
        whatsappTool.execute({ action: 'send', chatName: 'NonExistent', message: 'Hi' }),
      ).rejects.toThrow('Chat not found')
    })
  })

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('searches messages', async () => {
      const result = await whatsappTool.execute({ action: 'search', query: 'hello' })
      const parsed = JSON.parse(getTextContent(result)) as { results: unknown[]; count: number }
      expect(parsed.count).toBe(1)
      expect(mockSearchMessages).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // recent
  // -------------------------------------------------------------------------

  describe('recent', () => {
    it('fetches recent messages from a chat', async () => {
      const result = await whatsappTool.execute({ action: 'recent', chatName: 'Alice' })
      const parsed = JSON.parse(getTextContent(result)) as { messages: unknown[]; count: number }
      expect(parsed.count).toBe(1)
      expect(mockFetchMessages).toHaveBeenCalledWith({ limit: 20 })
    })
  })

  // -------------------------------------------------------------------------
  // chats
  // -------------------------------------------------------------------------

  describe('chats', () => {
    it('lists chats', async () => {
      const result = await whatsappTool.execute({ action: 'chats' })
      const parsed = JSON.parse(getTextContent(result)) as { chats: unknown[]; count: number }
      expect(parsed.count).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // contacts
  // -------------------------------------------------------------------------

  describe('contacts', () => {
    it('lists contacts (filtered: isMyContact + not group)', async () => {
      const result = await whatsappTool.execute({ action: 'contacts' })
      const parsed = JSON.parse(getTextContent(result)) as { contacts: Array<{ name: string }>; count: number }
      // Only Alice and Bob (isMyContact, not group)
      expect(parsed.count).toBe(2)
      expect(parsed.contacts[0]?.name).toBe('Alice')
      expect(parsed.contacts[1]?.name).toBe('Bob') // falls back to pushname
    })
  })

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('enforces max 20 messages per minute', async () => {
      for (let i = 0; i < 20; i++) {
        await whatsappTool.execute({ action: 'send', chatName: 'Alice', message: `msg ${String(i)}` })
      }

      await expect(
        whatsappTool.execute({ action: 'send', chatName: 'Alice', message: 'one more' }),
      ).rejects.toThrow('Rate limit')
    })
  })

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe('security', () => {
    it('contains no code-execution patterns', () => {
      assertNoEval(sourceCode)
    })

    it('contains no unauthorized fetch URLs', () => {
      assertNoUnauthorizedFetch(sourceCode, [])
    })

    it('enforces message length limit', () => {
      expect(sourceCode).toContain('MAX_MESSAGE_LENGTH')
    })

    it('has rate limiting', () => {
      expect(sourceCode).toContain('MAX_MESSAGES_PER_MINUTE')
      expect(sourceCode).toContain('checkMessageRateLimit')
    })

    it('uses hardcoded session path', () => {
      expect(sourceCode).toContain('.openclaw')
      expect(sourceCode).toContain('whatsapp-session')
    })
  })
})
