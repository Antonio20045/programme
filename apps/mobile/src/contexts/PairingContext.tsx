import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import { PushService } from '../services/push'
import type { PairingData } from '../types'

interface PairingState {
  isPaired: boolean
  isLoading: boolean
  data: PairingData | null
  completePairing: (data: PairingData) => Promise<void>
  unpair: () => Promise<void>
}

const PairingContext = createContext<PairingState | null>(null)

const KEYS = [
  'pairing:privateKey',
  'pairing:jwt',
  'pairing:partnerPublicKey',
  'pairing:deviceId',
  'pairing:partnerDeviceId',
  'pairing:relayUrl',
] as const

type SecureStoreKey = (typeof KEYS)[number]

const KEY_MAP: Record<keyof PairingData, SecureStoreKey> = {
  privateKey: 'pairing:privateKey',
  jwt: 'pairing:jwt',
  partnerPublicKey: 'pairing:partnerPublicKey',
  deviceId: 'pairing:deviceId',
  partnerDeviceId: 'pairing:partnerDeviceId',
  relayUrl: 'pairing:relayUrl',
}

export function PairingProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [data, setData] = useState<PairingData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void loadPairing()
  }, [])

  async function loadPairing(): Promise<void> {
    try {
      const values = await Promise.all(KEYS.map((key) => SecureStore.getItemAsync(key)))

      const [privateKey, jwt, partnerPublicKey, deviceId, partnerDeviceId, relayUrl] = values

      if (privateKey && jwt && partnerPublicKey && deviceId && partnerDeviceId && relayUrl) {
        setData({ privateKey, jwt, partnerPublicKey, deviceId, partnerDeviceId, relayUrl })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const completePairing = useCallback(async (pairingData: PairingData): Promise<void> => {
    const entries = Object.entries(KEY_MAP) as Array<[keyof PairingData, SecureStoreKey]>
    await Promise.all(
      entries.map(([field, storeKey]) => SecureStore.setItemAsync(storeKey, pairingData[field])),
    )
    setData(pairingData)

    // Fire-and-forget: register push token with relay
    void (async () => {
      try {
        const pushToken = await PushService.registerForPushNotifications()
        if (pushToken) {
          await PushService.registerTokenWithRelay(
            pairingData.relayUrl,
            pairingData.jwt,
            pairingData.deviceId,
            pushToken,
          )
        }
      } catch {
        // Non-fatal — push is best-effort
      }
    })()
  }, [])

  const unpair = useCallback(async (): Promise<void> => {
    // Try to unregister push token before clearing credentials
    if (data) {
      try {
        await PushService.unregisterTokenFromRelay(data.relayUrl, data.jwt, data.deviceId)
      } catch {
        // Non-fatal — relay deletes token on unpair anyway
      }
    }
    await Promise.all(KEYS.map((key) => SecureStore.deleteItemAsync(key)))
    setData(null)
  }, [data])

  return (
    <PairingContext.Provider
      value={{
        isPaired: data !== null,
        isLoading,
        data,
        completePairing,
        unpair,
      }}
    >
      {children}
    </PairingContext.Provider>
  )
}

export function usePairing(): PairingState {
  const ctx = useContext(PairingContext)
  if (!ctx) {
    throw new Error('usePairing must be used within PairingProvider')
  }
  return ctx
}
