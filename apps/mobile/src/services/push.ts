import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'

// Suppress notifications while app is in foreground (Zero Knowledge — no content shown)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export class PushService {
  static async registerForPushNotifications(): Promise<string | null> {
    if (!Device.isDevice) return null

    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') return null

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }

    const tokenData = await Notifications.getExpoPushTokenAsync()
    return tokenData.data
  }

  static async registerTokenWithRelay(
    relayUrl: string,
    jwt: string,
    deviceId: string,
    pushToken: string,
  ): Promise<boolean> {
    try {
      const resp = await fetch(`${relayUrl}/devices/${deviceId}/push-token`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          token: pushToken,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        }),
      })
      return resp.ok
    } catch {
      return false
    }
  }

  static async unregisterTokenFromRelay(
    relayUrl: string,
    jwt: string,
    deviceId: string,
  ): Promise<boolean> {
    try {
      const resp = await fetch(`${relayUrl}/devices/${deviceId}/push-token`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      })
      return resp.ok
    } catch {
      return false
    }
  }

  static setupNotificationResponseHandler(onTap: () => void): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(() => {
      onTap()
    })
  }

  static async clearBadge(): Promise<void> {
    await Notifications.setBadgeCountAsync(0)
  }
}
