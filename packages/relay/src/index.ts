import { verifyJwt } from "./jwt"
import { RateLimiter } from "./rate-limiter"
import { sendPushNotification } from "./push"
import type { Env, ClientMessage, RelayMessage, JwtPayload, DevicePushInfo } from "./types"

export { DeviceRegistry } from "./device-registry"
export { OfflineQueue } from "./offline-queue"

const MAX_PAYLOAD_SIZE = 64 * 1024 // 64 KB

interface ConnectedDevice {
  ws: WebSocket
  partnerId: string
}

const connectedDevices = new Map<string, ConnectedDevice>()
const rateLimiter = new RateLimiter()

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sendMessage(ws: WebSocket, msg: RelayMessage): void {
  ws.send(JSON.stringify(msg))
}

async function handlePairInit(request: Request, env: Env): Promise<Response> {
  const id = env.DEVICE_REGISTRY.idFromName("global")
  const stub = env.DEVICE_REGISTRY.get(id)
  return stub.fetch(new Request("https://do/init-pairing", {
    method: "POST",
    body: request.body,
    headers: { "Content-Type": "application/json" },
  }))
}

async function handlePairStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  if (!token) {
    return jsonResponse({ error: "Missing token", code: "MISSING_TOKEN" }, 400)
  }
  const id = env.DEVICE_REGISTRY.idFromName("global")
  const stub = env.DEVICE_REGISTRY.get(id)
  return stub.fetch(new Request(`https://do/pairing-status/${token}`, { method: "GET" }))
}

async function handlePairComplete(request: Request, env: Env): Promise<Response> {
  const id = env.DEVICE_REGISTRY.idFromName("global")
  const stub = env.DEVICE_REGISTRY.get(id)
  return stub.fetch(new Request("https://do/complete-pairing", {
    method: "POST",
    body: request.body,
    headers: { "Content-Type": "application/json" },
  }))
}

async function drainOfflineQueue(deviceId: string, ws: WebSocket, env: Env): Promise<void> {
  const queueId = env.OFFLINE_QUEUE.idFromName(deviceId)
  const stub = env.OFFLINE_QUEUE.get(queueId)
  const resp = await stub.fetch(new Request("https://do/drain", { method: "GET" }))
  const data = (await resp.json()) as { messages: Array<{ from: string; payload: string }>; count: number }

  if (data.count > 0) {
    sendMessage(ws, {
      type: "queued_messages",
      messages: data.messages,
      count: data.count,
    })
  }
}

async function enqueueOfflineMessage(
  targetDeviceId: string,
  from: string,
  payload: string,
  env: Env
): Promise<Response> {
  const queueId = env.OFFLINE_QUEUE.idFromName(targetDeviceId)
  const stub = env.OFFLINE_QUEUE.get(queueId)
  return stub.fetch(new Request("https://do/enqueue", {
    method: "POST",
    body: JSON.stringify({ from, payload }),
    headers: { "Content-Type": "application/json" },
  }))
}

async function authenticateRequest(request: Request, env: Env): Promise<JwtPayload | null> {
  const auth = request.headers.get("Authorization")
  if (!auth?.startsWith("Bearer ")) return null
  const token = auth.slice(7)
  try {
    return await verifyJwt(token, env.JWT_SECRET)
  } catch {
    return null
  }
}

async function handlePushTokenPut(request: Request, env: Env, deviceId: string): Promise<Response> {
  const claims = await authenticateRequest(request, env)
  if (!claims || claims.sub !== deviceId) {
    return jsonResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
  }

  const id = env.DEVICE_REGISTRY.idFromName("global")
  const stub = env.DEVICE_REGISTRY.get(id)
  return stub.fetch(new Request(`https://do/push-token/${deviceId}`, {
    method: "PUT",
    body: request.body,
    headers: { "Content-Type": "application/json" },
  }))
}

async function handlePushTokenDelete(request: Request, env: Env, deviceId: string): Promise<Response> {
  const claims = await authenticateRequest(request, env)
  if (!claims || claims.sub !== deviceId) {
    return jsonResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
  }

  const id = env.DEVICE_REGISTRY.idFromName("global")
  const stub = env.DEVICE_REGISTRY.get(id)
  return stub.fetch(new Request(`https://do/push-token/${deviceId}`, { method: "DELETE" }))
}

async function triggerPushForDevice(deviceId: string, env: Env): Promise<void> {
  const id = env.DEVICE_REGISTRY.idFromName("global")
  const stub = env.DEVICE_REGISTRY.get(id)
  const resp = await stub.fetch(new Request(`https://do/push-token/${deviceId}`, { method: "GET" }))
  if (!resp.ok) return
  const pushInfo = (await resp.json()) as DevicePushInfo
  await sendPushNotification(pushInfo)
}

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  const upgradeHeader = request.headers.get("Upgrade")
  if (upgradeHeader !== "websocket") {
    return jsonResponse({ error: "Expected WebSocket", code: "UPGRADE_REQUIRED" }, 426)
  }

  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  if (!token) {
    return jsonResponse({ error: "Missing token", code: "UNAUTHORIZED" }, 401)
  }

  let claims: JwtPayload | null
  try {
    claims = await verifyJwt(token, env.JWT_SECRET)
  } catch {
    claims = null
  }

  if (!claims) {
    return jsonResponse({ error: "Invalid token", code: "UNAUTHORIZED" }, 401)
  }

  const deviceId = claims.sub
  const partnerId = claims.pair

  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]

  server.accept()

  // Close existing connection for same device
  const existing = connectedDevices.get(deviceId)
  if (existing) {
    try {
      existing.ws.close(4000, "Replaced by new connection")
    } catch {
      // Already closed
    }
    connectedDevices.delete(deviceId)
  }

  // Register device
  connectedDevices.set(deviceId, { ws: server, partnerId })

  // Notify partner if online
  const partner = connectedDevices.get(partnerId)
  if (partner) {
    sendMessage(server, { type: "partner_online" })
    sendMessage(partner.ws, { type: "partner_online" })
  }

  // Drain offline queue
  drainOfflineQueue(deviceId, server, env).catch(() => {
    // Queue drain failure is non-fatal
  })

  server.addEventListener("message", (event) => {
    handleMessage(deviceId, partnerId, server, event, env).catch(() => {
      sendMessage(server, { type: "error", code: "INTERNAL", message: "Internal error" })
    })
  })

  server.addEventListener("close", () => {
    connectedDevices.delete(deviceId)
    rateLimiter.remove(deviceId)

    const partnerConn = connectedDevices.get(partnerId)
    if (partnerConn) {
      sendMessage(partnerConn.ws, { type: "partner_offline" })
    }
  })

  return new Response(null, { status: 101, webSocket: client })
}

async function handleMessage(
  deviceId: string,
  partnerId: string,
  ws: WebSocket,
  event: MessageEvent,
  env: Env
): Promise<void> {
  // Rate limit
  const rateResult = rateLimiter.check(deviceId)
  if (!rateResult.allowed) {
    sendMessage(ws, {
      type: "error",
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryAfter: rateResult.retryAfter,
    })
    return
  }

  // Parse message
  let msg: ClientMessage
  try {
    msg = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)) as ClientMessage
  } catch {
    sendMessage(ws, { type: "error", code: "INVALID_JSON", message: "Invalid JSON" })
    return
  }

  if (msg.type === "ping") {
    sendMessage(ws, { type: "pong" })
    return
  }

  if (msg.type === "message") {
    if (typeof msg.payload !== "string" || msg.payload.length === 0) {
      sendMessage(ws, { type: "error", code: "INVALID_PAYLOAD", message: "Payload must be a non-empty string" })
      return
    }

    if (msg.payload.length > MAX_PAYLOAD_SIZE) {
      sendMessage(ws, { type: "error", code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds 64KB limit" })
      return
    }

    // Forward or queue
    const partnerConn = connectedDevices.get(partnerId)
    if (partnerConn) {
      sendMessage(partnerConn.ws, { type: "message", from: deviceId, payload: msg.payload })
    } else {
      await enqueueOfflineMessage(partnerId, deviceId, msg.payload, env)
      triggerPushForDevice(partnerId, env).catch(() => {})
    }
    return
  }

  sendMessage(ws, { type: "error", code: "UNKNOWN_TYPE", message: "Unknown message type" })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "GET" && path === "/health") {
      return jsonResponse({ status: "ok" }, 200)
    }

    if (request.method === "POST" && path === "/pair/init") {
      return handlePairInit(request, env)
    }

    if (request.method === "POST" && path === "/pair") {
      return handlePairComplete(request, env)
    }

    if (request.method === "GET" && path === "/pair/status") {
      return handlePairStatus(request, env)
    }

    // Push token routes: /devices/:deviceId/push-token
    const pushMatch = path.match(/^\/devices\/([0-9a-f]{32,64})\/push-token$/)
    if (pushMatch) {
      const deviceId = pushMatch[1]!
      if (request.method === "PUT") return handlePushTokenPut(request, env, deviceId)
      if (request.method === "DELETE") return handlePushTokenDelete(request, env, deviceId)
    }

    if (request.method === "GET" && path === "/ws") {
      return handleWebSocket(request, env)
    }

    return jsonResponse({ error: "Not found", code: "NOT_FOUND" }, 404)
  },
}
