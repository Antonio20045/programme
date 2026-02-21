import type { JwtPayload } from "./types"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64urlEncode(data: Uint8Array): string {
  const binString = Array.from(data, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binString).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/")
  const pad = padded.length % 4
  const finalStr = pad ? padded + "=".repeat(4 - pad) : padded
  const binString = atob(finalStr)
  return Uint8Array.from(binString, (c) => c.charCodeAt(0))
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = base64urlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)))
  const signingInput = `${header}.${body}`

  const key = await importKey(secret)
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput))
  )

  return `${signingInput}.${base64urlEncode(signature)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [header, body, sig] = parts as [string, string, string]
  const signingInput = `${header}.${body}`

  const key = await importKey(secret)
  const signatureBytes = base64urlDecode(sig)
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(signingInput))
  if (!valid) return null

  let payload: unknown
  try {
    payload = JSON.parse(decoder.decode(base64urlDecode(body)))
  } catch {
    return null
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as JwtPayload).sub !== "string" ||
    typeof (payload as JwtPayload).pair !== "string" ||
    typeof (payload as JwtPayload).iat !== "number" ||
    typeof (payload as JwtPayload).exp !== "number"
  ) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if ((payload as JwtPayload).exp <= now) return null

  return payload as JwtPayload
}
