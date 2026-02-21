import type { DevicePushInfo } from "./types"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
const PUSH_TIMEOUT_MS = 5000

export async function sendPushNotification(pushInfo: DevicePushInfo): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS)

  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushInfo.token,
        title: "KI-Assistent",
        body: "Neue Nachricht",
        sound: "default",
        badge: 1,
      }),
      signal: controller.signal,
    })

    return resp.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
