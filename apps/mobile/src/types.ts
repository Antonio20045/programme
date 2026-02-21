/** Inner protocol — after decryption from relay */
export interface DecryptedMessage {
  type:
    | 'message'
    | 'stream_start'
    | 'stream_token'
    | 'stream_end'
    | 'tool_call'
    | 'tool_result'
    | 'tool_confirm'
    | 'error'
  content?: string
  toolCall?: { name: string; args: unknown }
  toolResult?: { name: string; result: unknown; status: string }
  toolCallId?: string
  sessionId?: string
  message?: string
  code?: string
  clerkToken?: string
}

/** Chat UI message */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: ToolCallInfo[]
  pending?: boolean
}

export interface ToolCallInfo {
  name: string
  args: unknown
  result?: unknown
  status: 'running' | 'done' | 'error'
}

/** Pairing state stored in SecureStore */
export interface PairingData {
  privateKey: string
  jwt: string
  partnerPublicKey: string
  deviceId: string
  partnerDeviceId: string
  relayUrl: string
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/** QR code payload from desktop */
export interface QRPayload {
  pairingToken: string
  relayUrl: string
  publicKey: string
  deviceId: string
}
