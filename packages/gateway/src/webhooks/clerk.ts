/**
 * Clerk Webhooks — Svix-signiert.
 * Events: user.created, user.updated, user.deleted
 *
 * Route: POST /webhooks/clerk
 * Registriert in channels/in-app.ts (handleRequest Dispatcher).
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { Webhook } from "svix"
import { getPool } from "../database/index.js"
import { userCache } from "../database/user-context.js"

// ─── Types ───────────────────────────────────────────────────

interface ClerkUserEvent {
  readonly data: {
    readonly id: string // Clerk user ID (e.g. "user_xxx")
    readonly email_addresses?: ReadonlyArray<{
      readonly email_address: string
      readonly id: string
    }>
    readonly primary_email_address_id?: string
    readonly first_name?: string | null
    readonly last_name?: string | null
  }
  readonly type: string
}

// ─── Helpers ─────────────────────────────────────────────────

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalLength = 0

    req.on("data", (chunk: Buffer) => {
      totalLength += chunk.length
      if (totalLength > maxBytes) {
        req.destroy()
        reject(new Error("Request body too large"))
        return
      }
      chunks.push(chunk)
    })

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"))
    })

    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  })
  res.end(body)
}

function extractPrimaryEmail(data: ClerkUserEvent["data"]): string | undefined {
  if (!data.email_addresses || data.email_addresses.length === 0) return undefined
  if (data.primary_email_address_id) {
    const primary = data.email_addresses.find(
      (e) => e.id === data.primary_email_address_id,
    )
    if (primary) return primary.email_address
  }
  return data.email_addresses[0]?.email_address
}

function buildName(data: ClerkUserEvent["data"]): string | undefined {
  const parts: string[] = []
  if (data.first_name) parts.push(data.first_name)
  if (data.last_name) parts.push(data.last_name)
  return parts.length > 0 ? parts.join(" ") : undefined
}

// ─── Webhook Handler ─────────────────────────────────────────

export async function handleClerkWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const webhookSecret = process.env["CLERK_WEBHOOK_SECRET"]
  if (!webhookSecret) {
    sendJson(res, 500, { error: "CLERK_WEBHOOK_SECRET not configured" })
    return
  }

  // 1. Read body
  let rawBody: string
  try {
    rawBody = await readBody(req, 1_048_576)
  } catch {
    sendJson(res, 413, { error: "Request body too large" })
    return
  }

  // 2. Verify Svix signature
  const svixId = req.headers["svix-id"] as string | undefined
  const svixTimestamp = req.headers["svix-timestamp"] as string | undefined
  const svixSignature = req.headers["svix-signature"] as string | undefined

  if (!svixId || !svixTimestamp || !svixSignature) {
    sendJson(res, 400, { error: "Missing Svix headers" })
    return
  }

  let event: ClerkUserEvent
  try {
    const wh = new Webhook(webhookSecret)
    event = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkUserEvent
  } catch {
    sendJson(res, 400, { error: "Invalid webhook signature" })
    return
  }

  // 3. Dispatch by event type
  const pool = getPool()
  const clerkId = event.data.id

  try {
    switch (event.type) {
      case "user.created": {
        const email = extractPrimaryEmail(event.data)
        if (!email) {
          sendJson(res, 400, { error: "No email in user.created event" })
          return
        }
        const name = buildName(event.data)

        const client = await pool.connect()
        try {
          await client.query("BEGIN")
          await client.query(
            "INSERT INTO users (clerk_id, email, name, tier) VALUES ($1, $2, $3, $4) ON CONFLICT (clerk_id) DO NOTHING",
            [clerkId, email, name ?? null, "free"],
          )
          // Get the user ID for user_settings insertion
          const { rows } = await client.query<{ id: string }>(
            "SELECT id FROM users WHERE clerk_id = $1",
            [clerkId],
          )
          if (rows[0]) {
            await client.query(
              "INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
              [rows[0].id],
            )
          }
          await client.query("COMMIT")
        } catch (err) {
          await client.query("ROLLBACK")
          throw err
        } finally {
          client.release()
        }
        break
      }

      case "user.updated": {
        const email = extractPrimaryEmail(event.data)
        const name = buildName(event.data)

        await pool.query(
          "UPDATE users SET email = COALESCE($1, email), name = COALESCE($2, name), updated_at = NOW() WHERE clerk_id = $3",
          [email ?? null, name ?? null, clerkId],
        )
        break
      }

      case "user.deleted": {
        // CASCADE deletes all dependent rows
        await pool.query("DELETE FROM users WHERE clerk_id = $1", [clerkId])
        break
      }

      default:
        // Ignore unknown event types
        break
    }

    // 4. Invalidate cache after any user event
    userCache.invalidate(clerkId)

    sendJson(res, 200, { ok: true })
  } catch (err) {
    console.error("[clerk-webhook] Error processing event:", err)
    sendJson(res, 500, { error: "Internal error" })
  }
}
