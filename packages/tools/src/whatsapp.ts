/**
 * WhatsApp tool — send/receive messages, search chats, list contacts.
 * Uses whatsapp-web.js with puppeteer-core and Playwright's Chromium.
 *
 * Client is lazily initialized on first use.
 * Session persisted in ~/.openclaw/workspace/whatsapp-session/.
 * Rate limit: max 20 messages per minute.
 *
 * No eval. No unauthorized fetch. All network handled by whatsapp-web.js internals.
 */

import * as os from 'node:os'
import * as path from 'node:path'
import type { AgentToolResult, ExtendedAgentTool, JSONSchema } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'whatsapp-session')
const MAX_MESSAGE_LENGTH = 5_000
const MAX_RECENT_MESSAGES = 100
const MAX_MESSAGES_PER_MINUTE = 20
const DEFAULT_RECENT_COUNT = 20
const MAX_CHAT_LIST = 50

// ---------------------------------------------------------------------------
// WhatsApp client interfaces (avoids compile-time dependency)
// ---------------------------------------------------------------------------

interface WAMessage {
  readonly body: string
  readonly from: string
  readonly to: string
  readonly timestamp: number
  readonly fromMe: boolean
}

interface WAChat {
  readonly id: { readonly _serialized: string }
  readonly name: string
  readonly isGroup: boolean
  readonly unreadCount: number
  fetchMessages(options: { limit: number }): Promise<WAMessage[]>
  sendMessage(content: string): Promise<unknown>
}

interface WAContact {
  readonly id: { readonly _serialized: string }
  readonly name: string | undefined
  readonly pushname: string | undefined
  readonly isMyContact: boolean
  readonly isGroup: boolean
}

interface WAClient {
  on(event: string, callback: (...args: unknown[]) => void): void
  initialize(): Promise<void>
  destroy(): Promise<void>
  getChats(): Promise<WAChat[]>
  getContacts(): Promise<WAContact[]>
  getChatById(chatId: string): Promise<WAChat>
  searchMessages(query: string, options?: { chatId?: string; limit?: number }): Promise<WAMessage[]>
}

interface WAClientConstructor {
  new (options: {
    puppeteer?: { executablePath?: string }
    authStrategy?: unknown
    dataPath?: string
  }): WAClient
}

interface WALocalAuthConstructor {
  new (options: { dataPath: string }): unknown
}

interface WhatsAppWebModule {
  Client: WAClientConstructor
  LocalAuth: WALocalAuthConstructor
}

// ---------------------------------------------------------------------------
// Client state
// ---------------------------------------------------------------------------

let whatsappClient: WAClient | null = null
let clientStatus: 'disconnected' | 'qr_pending' | 'connected' = 'disconnected'
let lastQrCode: string | null = null
let waLoader: (() => Promise<WhatsAppWebModule>) | null = null

/** Override for testing — inject a custom whatsapp-web.js loader. */
function setWhatsAppLoader(loader: (() => Promise<WhatsAppWebModule>) | null): void {
  waLoader = loader
}

async function loadWhatsApp(): Promise<WhatsAppWebModule> {
  if (waLoader !== null) {
    return waLoader()
  }
  const moduleName = 'whatsapp-web.js'
  return import(/* webpackIgnore: true */ moduleName) as Promise<WhatsAppWebModule>
}

async function findChromiumPath(): Promise<string | undefined> {
  try {
    const moduleName = 'playwright'
    const pw = await import(/* webpackIgnore: true */ moduleName) as { chromium: { executablePath(): string } }
    return pw.chromium.executablePath()
  } catch {
    return undefined
  }
}

async function getClient(): Promise<WAClient> {
  if (whatsappClient !== null && clientStatus === 'connected') {
    return whatsappClient
  }

  if (whatsappClient !== null && clientStatus === 'qr_pending') {
    throw new Error('WhatsApp: QR code scan pending — use action "getQr" to retrieve the QR code')
  }

  // Initialize new client
  const wa = await loadWhatsApp()
  const chromiumPath = await findChromiumPath()

  const authStrategy = new wa.LocalAuth({ dataPath: SESSION_DIR })
  const client = new wa.Client({
    puppeteer: chromiumPath ? { executablePath: chromiumPath } : undefined,
    authStrategy,
    dataPath: SESSION_DIR,
  })

  client.on('qr', (qr: unknown) => {
    clientStatus = 'qr_pending'
    lastQrCode = typeof qr === 'string' ? qr : null
  })

  client.on('ready', () => {
    clientStatus = 'connected'
    lastQrCode = null
  })

  client.on('disconnected', () => {
    clientStatus = 'disconnected'
    whatsappClient = null
    lastQrCode = null
  })

  whatsappClient = client
  clientStatus = 'disconnected'

  await client.initialize()

  // Re-read status — event handlers may have changed it during initialize()
  const currentStatus: string = clientStatus
  if (currentStatus !== 'connected') {
    throw new Error(
      currentStatus === 'qr_pending'
        ? 'WhatsApp: QR code scan required — use action "getQr" to retrieve the QR code'
        : 'WhatsApp: Connection failed',
    )
  }

  return client
}

/** Reset client state — exported for testing. */
async function resetClient(): Promise<void> {
  if (whatsappClient !== null) {
    try { await whatsappClient.destroy() } catch { /* ignore */ }
  }
  whatsappClient = null
  clientStatus = 'disconnected'
  lastQrCode = null
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const messageTimestamps: number[] = []

function checkMessageRateLimit(): void {
  const now = Date.now()
  while (messageTimestamps.length > 0 && (messageTimestamps[0] as number) < now - 60_000) {
    messageTimestamps.shift()
  }
  if (messageTimestamps.length >= MAX_MESSAGES_PER_MINUTE) {
    throw new Error(`Rate limit: max ${String(MAX_MESSAGES_PER_MINUTE)} messages per minute`)
  }
  messageTimestamps.push(now)
}

function _resetRateLimit(): void {
  messageTimestamps.length = 0
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SendArgs {
  readonly action: 'send'
  readonly chatName: string
  readonly message: string
}

interface SearchArgs {
  readonly action: 'search'
  readonly query: string
  readonly chatName?: string
}

interface RecentArgs {
  readonly action: 'recent'
  readonly chatName: string
  readonly count: number
}

interface ChatsArgs {
  readonly action: 'chats'
}

interface ContactsArgs {
  readonly action: 'contacts'
}

interface StatusArgs {
  readonly action: 'status'
}

interface GetQrArgs {
  readonly action: 'getQr'
}

type WhatsAppArgs = SendArgs | SearchArgs | RecentArgs | ChatsArgs | ContactsArgs | StatusArgs | GetQrArgs

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: unknown): WhatsAppArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Arguments must be an object')
  }

  const obj = args as Record<string, unknown>
  const action = obj['action']

  if (action === 'send') {
    const chatName = obj['chatName']
    if (typeof chatName !== 'string' || chatName.trim() === '') {
      throw new Error('send requires a non-empty "chatName" string')
    }
    const message = obj['message']
    if (typeof message !== 'string' || message.trim() === '') {
      throw new Error('send requires a non-empty "message" string')
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long (max ${String(MAX_MESSAGE_LENGTH)} characters)`)
    }
    return { action: 'send', chatName: chatName.trim(), message: message.trim() }
  }

  if (action === 'search') {
    const query = obj['query']
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('search requires a non-empty "query" string')
    }
    const chatName = obj['chatName']
    return {
      action: 'search',
      query: query.trim(),
      chatName: typeof chatName === 'string' && chatName.trim() !== '' ? chatName.trim() : undefined,
    }
  }

  if (action === 'recent') {
    const chatName = obj['chatName']
    if (typeof chatName !== 'string' || chatName.trim() === '') {
      throw new Error('recent requires a non-empty "chatName" string')
    }
    let count = DEFAULT_RECENT_COUNT
    if (obj['count'] !== undefined) {
      if (typeof obj['count'] !== 'number' || !Number.isInteger(obj['count']) || obj['count'] < 1) {
        throw new Error('count must be a positive integer')
      }
      count = Math.min(obj['count'], MAX_RECENT_MESSAGES)
    }
    return { action: 'recent', chatName: chatName.trim(), count }
  }

  if (action === 'chats') {
    return { action: 'chats' }
  }

  if (action === 'contacts') {
    return { action: 'contacts' }
  }

  if (action === 'status') {
    return { action: 'status' }
  }

  if (action === 'getQr') {
    return { action: 'getQr' }
  }

  throw new Error(
    'action must be "send", "search", "recent", "chats", "contacts", "status", or "getQr"',
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }] }
}

async function findChatByName(client: WAClient, chatName: string): Promise<WAChat> {
  const chats = await client.getChats()
  const lower = chatName.toLowerCase()
  const found = chats.find((c) => c.name.toLowerCase() === lower)
  if (!found) {
    throw new Error(`Chat not found: "${chatName}"`)
  }
  return found
}

function formatMessage(msg: WAMessage): Record<string, unknown> {
  return {
    body: msg.body,
    from: msg.from,
    to: msg.to,
    timestamp: msg.timestamp,
    fromMe: msg.fromMe,
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const parameters: JSONSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'Action to perform',
      enum: ['send', 'search', 'recent', 'chats', 'contacts', 'status', 'getQr'],
    },
    chatName: {
      type: 'string',
      description: 'Chat name to target (send, recent, search)',
    },
    message: {
      type: 'string',
      description: 'Message text to send (send, max 5000 chars)',
    },
    query: {
      type: 'string',
      description: 'Search query (search)',
    },
    count: {
      type: 'integer',
      description: 'Number of recent messages (recent, default 20, max 100)',
    },
  },
  required: ['action'],
}

export const whatsappTool: ExtendedAgentTool = {
  name: 'whatsapp',
  description:
    'WhatsApp messaging. Actions: send(chatName, message) sends a message; search(query, chatName?) searches messages; recent(chatName, count?) gets recent messages; chats() lists chats; contacts() lists contacts; status() returns connection status; getQr() returns QR code for pairing.',
  parameters,
  permissions: ['net:http', 'whatsapp:send', 'whatsapp:read'],
  requiresConfirmation: true,
  runsOn: 'server',
  execute: async (args: unknown): Promise<AgentToolResult> => {
    const parsed = parseArgs(args)

    // Status and getQr don't need a connected client
    if (parsed.action === 'status') {
      return textResult(JSON.stringify({ status: clientStatus }))
    }

    if (parsed.action === 'getQr') {
      if (lastQrCode === null) {
        return textResult(JSON.stringify({
          qr: null,
          status: clientStatus,
          message: clientStatus === 'connected'
            ? 'Already connected'
            : 'No QR code available — try initializing first',
        }))
      }
      return textResult(JSON.stringify({ qr: lastQrCode, status: clientStatus }))
    }

    const client = await getClient()

    switch (parsed.action) {
      case 'send': {
        checkMessageRateLimit()
        const chat = await findChatByName(client, parsed.chatName)
        await chat.sendMessage(parsed.message)
        return textResult(JSON.stringify({ sent: true, chatName: parsed.chatName }))
      }

      case 'search': {
        const options: { chatId?: string; limit?: number } = { limit: 50 }
        if (parsed.chatName) {
          const chat = await findChatByName(client, parsed.chatName)
          options.chatId = chat.id._serialized
        }
        const messages = await client.searchMessages(parsed.query, options)
        return textResult(JSON.stringify({
          results: messages.map(formatMessage),
          count: messages.length,
        }))
      }

      case 'recent': {
        const chat = await findChatByName(client, parsed.chatName)
        const messages = await chat.fetchMessages({ limit: parsed.count })
        return textResult(JSON.stringify({
          messages: messages.map(formatMessage),
          count: messages.length,
          chatName: parsed.chatName,
        }))
      }

      case 'chats': {
        const chats = await client.getChats()
        const chatList = chats.slice(0, MAX_CHAT_LIST).map((c) => ({
          id: c.id._serialized,
          name: c.name,
          isGroup: c.isGroup,
          unreadCount: c.unreadCount,
        }))
        return textResult(JSON.stringify({ chats: chatList, count: chatList.length }))
      }

      case 'contacts': {
        const contacts = await client.getContacts()
        const contactList = contacts
          .filter((c) => c.isMyContact && !c.isGroup)
          .map((c) => ({
            id: c.id._serialized,
            name: c.name ?? c.pushname ?? 'Unknown',
          }))
        return textResult(JSON.stringify({ contacts: contactList, count: contactList.length }))
      }
    }

    throw new Error(`Unknown action: ${String((parsed as Record<string, unknown>).action)}`)
  },
}

export { parseArgs, resetClient, setWhatsAppLoader, _resetRateLimit }
