import { DurableObject } from "cloudflare:workers"
import { signJwt } from "./jwt"
import type {
  Env,
  PairedDevices,
  PairingRequest,
  PairingStatusResponse,
  PairInitResponse,
  PairCompleteResponse,
  ErrorResponse,
  DevicePushInfo,
  PushTokenRequest,
} from "./types"

const DEVICE_ID_RE = /^[0-9a-f]{32,64}$/
const PUBLIC_KEY_RE = /^[A-Za-z0-9+/=]{40,100}$/
const EXPO_TOKEN_RE = /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/
const PAIRING_TTL_MS = 5 * 60 * 1000 // 5 minutes
const JWT_EXPIRY_SECONDS = 30 * 24 * 60 * 60 // 30 days

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export class DeviceRegistry extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "POST" && path === "/init-pairing") {
      return this.initPairing(request)
    }
    if (request.method === "POST" && path === "/complete-pairing") {
      return this.completePairing(request)
    }
    if (request.method === "GET" && path.startsWith("/partner/")) {
      const deviceId = path.slice("/partner/".length)
      return this.getPartner(deviceId)
    }
    if (request.method === "GET" && path.startsWith("/pairing-status/")) {
      return this.getPairingStatus(path.slice("/pairing-status/".length))
    }
    if (request.method === "DELETE" && path.startsWith("/pair/")) {
      const deviceId = path.slice("/pair/".length)
      return this.unpair(deviceId)
    }

    // Push token routes
    if (path.startsWith("/push-token/")) {
      const deviceId = path.slice("/push-token/".length)
      if (request.method === "PUT") return this.setPushToken(deviceId, request)
      if (request.method === "DELETE") return this.deletePushToken(deviceId)
      if (request.method === "GET") return this.getPushToken(deviceId)
    }

    return jsonResponse({ error: "Not found", code: "NOT_FOUND" } satisfies ErrorResponse, 404)
  }

  private async initPairing(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON", code: "INVALID_JSON" } satisfies ErrorResponse, 400)
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).deviceId !== "string" ||
      typeof (body as Record<string, unknown>).publicKey !== "string"
    ) {
      return jsonResponse({ error: "Missing deviceId or publicKey", code: "INVALID_BODY" } satisfies ErrorResponse, 400)
    }

    const { deviceId, publicKey } = body as { deviceId: string; publicKey: string }

    if (!DEVICE_ID_RE.test(deviceId)) {
      return jsonResponse({ error: "Invalid deviceId format", code: "INVALID_DEVICE_ID" } satisfies ErrorResponse, 400)
    }
    if (!PUBLIC_KEY_RE.test(publicKey)) {
      return jsonResponse({ error: "Invalid publicKey format", code: "INVALID_PUBLIC_KEY" } satisfies ErrorResponse, 400)
    }

    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const pairingToken = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("")

    const expiresAt = Date.now() + PAIRING_TTL_MS

    const pairingRequest: PairingRequest = {
      pairingToken,
      deviceId,
      publicKey,
      expiresAt,
      used: false,
    }

    await this.ctx.storage.put(`pairing:${pairingToken}`, pairingRequest)

    return jsonResponse({ pairingToken, expiresAt } satisfies PairInitResponse, 201)
  }

  private async completePairing(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON", code: "INVALID_JSON" } satisfies ErrorResponse, 400)
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).pairingToken !== "string" ||
      typeof (body as Record<string, unknown>).deviceId !== "string" ||
      typeof (body as Record<string, unknown>).publicKey !== "string"
    ) {
      return jsonResponse({ error: "Missing fields", code: "INVALID_BODY" } satisfies ErrorResponse, 400)
    }

    const { pairingToken, deviceId, publicKey } = body as {
      pairingToken: string
      deviceId: string
      publicKey: string
    }

    if (!DEVICE_ID_RE.test(deviceId)) {
      return jsonResponse({ error: "Invalid deviceId format", code: "INVALID_DEVICE_ID" } satisfies ErrorResponse, 400)
    }
    if (!PUBLIC_KEY_RE.test(publicKey)) {
      return jsonResponse({ error: "Invalid publicKey format", code: "INVALID_PUBLIC_KEY" } satisfies ErrorResponse, 400)
    }

    const pairingRequest = await this.ctx.storage.get<PairingRequest>(`pairing:${pairingToken}`)

    if (!pairingRequest) {
      return jsonResponse({ error: "Token not found", code: "TOKEN_NOT_FOUND" } satisfies ErrorResponse, 404)
    }

    if (pairingRequest.used) {
      return jsonResponse({ error: "Token already used", code: "TOKEN_USED" } satisfies ErrorResponse, 409)
    }

    if (Date.now() > pairingRequest.expiresAt) {
      return jsonResponse({ error: "Token expired", code: "TOKEN_EXPIRED" } satisfies ErrorResponse, 410)
    }

    if (pairingRequest.deviceId === deviceId) {
      return jsonResponse({ error: "Cannot pair with self", code: "SELF_PAIR" } satisfies ErrorResponse, 400)
    }

    // Mark token as used
    pairingRequest.used = true
    await this.ctx.storage.put(`pairing:${pairingToken}`, pairingRequest)

    // Store pairing bidirectionally
    const paired: PairedDevices = {
      deviceA: pairingRequest.deviceId,
      deviceB: deviceId,
      publicKeyA: pairingRequest.publicKey,
      publicKeyB: publicKey,
      pairedAt: Date.now(),
    }

    await this.ctx.storage.put(`pair:${pairingRequest.deviceId}`, paired)
    await this.ctx.storage.put(`pair:${deviceId}`, paired)

    // Generate JWTs for both devices
    const now = Math.floor(Date.now() / 1000)
    const tokenA = await signJwt(
      { sub: pairingRequest.deviceId, pair: deviceId, iat: now, exp: now + JWT_EXPIRY_SECONDS },
      this.env.JWT_SECRET
    )
    const tokenB = await signJwt(
      { sub: deviceId, pair: pairingRequest.deviceId, iat: now, exp: now + JWT_EXPIRY_SECONDS },
      this.env.JWT_SECRET
    )

    // Store desktop JWT for status polling (one-time retrieval)
    pairingRequest.result = {
      partnerDeviceId: deviceId,
      partnerPublicKey: publicKey,
      jwt: tokenA,
    }
    await this.ctx.storage.put(`pairing:${pairingToken}`, pairingRequest)

    return jsonResponse(
      {
        tokenA,
        tokenB,
        deviceA: pairingRequest.deviceId,
        deviceB: deviceId,
      } satisfies PairCompleteResponse,
      200
    )
  }

  private async getPartner(deviceId: string): Promise<Response> {
    const paired = await this.ctx.storage.get<PairedDevices>(`pair:${deviceId}`)
    if (!paired) {
      return jsonResponse({ error: "Not paired", code: "NOT_PAIRED" } satisfies ErrorResponse, 404)
    }

    const partnerId = paired.deviceA === deviceId ? paired.deviceB : paired.deviceA
    const partnerKey = paired.deviceA === deviceId ? paired.publicKeyB : paired.publicKeyA

    return jsonResponse({ partnerId, partnerKey }, 200)
  }

  private async getPairingStatus(token: string): Promise<Response> {
    const req = await this.ctx.storage.get<PairingRequest>(`pairing:${token}`)
    if (!req) {
      return jsonResponse({ error: "Token not found", code: "TOKEN_NOT_FOUND" } satisfies ErrorResponse, 404)
    }

    if (!req.used && Date.now() > req.expiresAt) {
      return jsonResponse({ error: "Token expired", code: "TOKEN_EXPIRED" } satisfies ErrorResponse, 410)
    }

    if (!req.used || !req.result) {
      return jsonResponse({ paired: false, expiresAt: req.expiresAt } satisfies PairingStatusResponse, 200)
    }

    // One-time retrieval: return result and delete it to prevent replay
    const result = req.result
    delete req.result
    await this.ctx.storage.put(`pairing:${token}`, req)

    return jsonResponse({
      paired: true,
      partnerDeviceId: result.partnerDeviceId,
      partnerPublicKey: result.partnerPublicKey,
      jwt: result.jwt,
    } satisfies PairingStatusResponse, 200)
  }

  private async unpair(deviceId: string): Promise<Response> {
    const paired = await this.ctx.storage.get<PairedDevices>(`pair:${deviceId}`)
    if (!paired) {
      return jsonResponse({ error: "Not paired", code: "NOT_PAIRED" } satisfies ErrorResponse, 404)
    }

    await this.ctx.storage.delete(`pair:${paired.deviceA}`)
    await this.ctx.storage.delete(`pair:${paired.deviceB}`)
    await this.ctx.storage.delete(`push:${paired.deviceA}`)
    await this.ctx.storage.delete(`push:${paired.deviceB}`)

    return jsonResponse({ ok: true }, 200)
  }

  private async setPushToken(deviceId: string, request: Request): Promise<Response> {
    if (!DEVICE_ID_RE.test(deviceId)) {
      return jsonResponse({ error: "Invalid deviceId format", code: "INVALID_DEVICE_ID" } satisfies ErrorResponse, 400)
    }

    const paired = await this.ctx.storage.get<PairedDevices>(`pair:${deviceId}`)
    if (!paired) {
      return jsonResponse({ error: "Not paired", code: "NOT_PAIRED" } satisfies ErrorResponse, 403)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON", code: "INVALID_JSON" } satisfies ErrorResponse, 400)
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).token !== "string" ||
      typeof (body as Record<string, unknown>).platform !== "string"
    ) {
      return jsonResponse({ error: "Missing token or platform", code: "INVALID_BODY" } satisfies ErrorResponse, 400)
    }

    const { token, platform } = body as PushTokenRequest

    if (!EXPO_TOKEN_RE.test(token)) {
      return jsonResponse({ error: "Invalid token format", code: "INVALID_TOKEN" } satisfies ErrorResponse, 400)
    }

    if (platform !== "ios" && platform !== "android") {
      return jsonResponse({ error: "Invalid platform", code: "INVALID_PLATFORM" } satisfies ErrorResponse, 400)
    }

    const pushInfo: DevicePushInfo = { token, platform, registeredAt: Date.now() }
    await this.ctx.storage.put(`push:${deviceId}`, pushInfo)

    return jsonResponse({ ok: true }, 200)
  }

  private async deletePushToken(deviceId: string): Promise<Response> {
    if (!DEVICE_ID_RE.test(deviceId)) {
      return jsonResponse({ error: "Invalid deviceId format", code: "INVALID_DEVICE_ID" } satisfies ErrorResponse, 400)
    }

    await this.ctx.storage.delete(`push:${deviceId}`)
    return jsonResponse({ ok: true }, 200)
  }

  private async getPushToken(deviceId: string): Promise<Response> {
    if (!DEVICE_ID_RE.test(deviceId)) {
      return jsonResponse({ error: "Invalid deviceId format", code: "INVALID_DEVICE_ID" } satisfies ErrorResponse, 400)
    }

    const pushInfo = await this.ctx.storage.get<DevicePushInfo>(`push:${deviceId}`)
    if (!pushInfo) {
      return jsonResponse({ error: "No push token", code: "NOT_FOUND" } satisfies ErrorResponse, 404)
    }

    return jsonResponse(pushInfo, 200)
  }
}
