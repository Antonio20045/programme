// --- Worker Environment ---

export interface Env {
  DEVICE_REGISTRY: DurableObjectNamespace
  OFFLINE_QUEUE: DurableObjectNamespace
  JWT_SECRET: string
}

// --- JWT ---

export interface JwtPayload {
  sub: string // deviceId
  pair: string // partnerId
  iat: number
  exp: number
}

// --- Pairing ---

export interface PairedDevices {
  deviceA: string
  deviceB: string
  publicKeyA: string
  publicKeyB: string
  pairedAt: number
}

export interface PairingRequest {
  pairingToken: string
  deviceId: string
  publicKey: string
  expiresAt: number
  used: boolean
  result?: {
    partnerDeviceId: string
    partnerPublicKey: string
    jwt: string
  }
}

export interface PairingStatusResponse {
  paired: boolean
  expiresAt?: number
  partnerDeviceId?: string
  partnerPublicKey?: string
  jwt?: string
}

// --- Offline Queue ---

export interface QueuedMessage {
  from: string
  payload: string // opaque Base64
  storedAt: number
  size: number
}

// --- WebSocket Protocol ---

export type ClientMessage =
  | { type: "message"; payload: string }
  | { type: "ping" }

export type RelayMessage =
  | { type: "message"; from: string; payload: string }
  | { type: "pong" }
  | { type: "partner_online" }
  | { type: "partner_offline" }
  | { type: "queued_messages"; messages: Array<{ from: string; payload: string }>; count: number }
  | { type: "error"; code: string; message: string; retryAfter?: number }

// --- Rate Limiting ---

export interface RateLimitResult {
  allowed: boolean
  retryAfter?: number
}

// --- HTTP Responses ---

export interface PairInitResponse {
  pairingToken: string
  expiresAt: number
}

export interface PairCompleteResponse {
  tokenA: string
  tokenB: string
  deviceA: string
  deviceB: string
}

export interface ErrorResponse {
  error: string
  code: string
}

// --- Push Notifications ---

export interface DevicePushInfo {
  token: string
  platform: "ios" | "android"
  registeredAt: number
}

export interface PushTokenRequest {
  token: string
  platform: "ios" | "android"
}
