/**
 * Stripe Webhooks — Stripe-signiert.
 * Events: checkout.session.completed, customer.subscription.deleted, invoice.payment_failed
 *
 * Route: POST /webhooks/stripe
 * Registriert in channels/in-app.ts (handleRequest Dispatcher).
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import Stripe from "stripe"
import { getPool } from "../database/index.js"
import { userCache } from "../database/user-context.js"

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

// ─── Budget Defaults ─────────────────────────────────────────

const PRO_DAILY_LIMIT = 25.0
const PRO_MONTHLY_LIMIT = 200.0
const FREE_DAILY_LIMIT = 5.0
const FREE_MONTHLY_LIMIT = 50.0

// ─── Webhook Handler ─────────────────────────────────────────

export async function handleStripeWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"]
  if (!webhookSecret) {
    sendJson(res, 500, { error: "STRIPE_WEBHOOK_SECRET not configured" })
    return
  }

  const stripeSecretKey = process.env["STRIPE_SECRET_KEY"]
  if (!stripeSecretKey) {
    sendJson(res, 500, { error: "STRIPE_SECRET_KEY not configured" })
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

  // 2. Verify Stripe signature
  const sig = req.headers["stripe-signature"] as string | undefined
  if (!sig) {
    sendJson(res, 400, { error: "Missing stripe-signature header" })
    return
  }

  const stripe = new Stripe(stripeSecretKey)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch {
    sendJson(res, 400, { error: "Invalid webhook signature" })
    return
  }

  // 3. Dispatch by event type
  const pool = getPool()

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const clerkId = session.metadata?.["clerk_id"]
        if (!clerkId) {
          console.warn("[stripe] checkout.session.completed missing clerk_id in metadata")
          break
        }

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id

        // Update user to pro tier
        await pool.query(
          `UPDATE users
           SET tier = 'pro',
               stripe_customer_id = $1,
               stripe_subscription_id = $2,
               updated_at = NOW()
           WHERE clerk_id = $3`,
          [customerId ?? null, subscriptionId ?? null, clerkId],
        )

        // Upsert budget limits with pro defaults
        const { rows } = await pool.query<{ id: string }>(
          "SELECT id FROM users WHERE clerk_id = $1",
          [clerkId],
        )
        if (rows[0]) {
          await pool.query(
            `INSERT INTO user_budget_limits (user_id, daily_limit_usd, monthly_limit_usd)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE
             SET daily_limit_usd = $2, monthly_limit_usd = $3`,
            [rows[0].id, PRO_DAILY_LIMIT, PRO_MONTHLY_LIMIT],
          )
        }

        userCache.invalidate(clerkId)
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id

        if (!customerId) {
          console.warn("[stripe] subscription.deleted missing customer")
          break
        }

        // Find user by stripe_customer_id
        const { rows } = await pool.query<{ id: string; clerk_id: string }>(
          "SELECT id, clerk_id FROM users WHERE stripe_customer_id = $1",
          [customerId],
        )

        if (rows[0]) {
          // Downgrade to free tier
          await pool.query(
            `UPDATE users SET tier = 'free', updated_at = NOW() WHERE id = $1`,
            [rows[0].id],
          )

          // Reset budget limits to free defaults
          await pool.query(
            `UPDATE user_budget_limits
             SET daily_limit_usd = $1, monthly_limit_usd = $2
             WHERE user_id = $3`,
            [FREE_DAILY_LIMIT, FREE_MONTHLY_LIMIT, rows[0].id],
          )

          userCache.invalidate(rows[0].clerk_id)
        }
        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id
        console.warn(
          `[stripe] Payment failed for customer: ${customerId ?? "unknown"}`,
        )
        break
      }

      default:
        // Ignore unknown event types
        break
    }

    sendJson(res, 200, { received: true })
  } catch (err) {
    console.error("[stripe-webhook] Error processing event:", err)
    sendJson(res, 500, { error: "Internal error" })
  }
}
