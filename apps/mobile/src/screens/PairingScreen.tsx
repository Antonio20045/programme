import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ExpoCrypto from 'expo-crypto'
import { generateKeyPair, toBase64 } from '@ki-assistent/shared'
import { usePairing } from '../contexts/PairingContext'
import type { QRPayload } from '../types'

function isValidQRPayload(data: unknown): data is QRPayload {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj['pairingToken'] === 'string' &&
    typeof obj['relayUrl'] === 'string' &&
    typeof obj['publicKey'] === 'string' &&
    typeof obj['deviceId'] === 'string' &&
    typeof obj['relayUrl'] === 'string' &&
    (obj['relayUrl'] as string).startsWith('https://')
  )
}

export function PairingScreen(): React.JSX.Element {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const { completePairing } = usePairing()
  const [permission, requestPermission] = useCameraPermissions()
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusText, setStatusText] = useState('Scanne den QR-Code auf deinem Desktop')

  useEffect(() => {
    if (!permission?.granted) {
      void requestPermission()
    }
  }, [permission, requestPermission])

  const handleBarCodeScanned = useCallback(
    async (data: string) => {
      if (isProcessing) return
      setIsProcessing(true)
      setStatusText('Verbinde...')

      try {
        const parsed: unknown = JSON.parse(data)
        if (!isValidQRPayload(parsed)) {
          throw new Error('Ungültiger QR-Code')
        }

        const keyPair = generateKeyPair()
        const deviceId = ExpoCrypto.randomUUID()

        const response = await fetch(`${parsed.relayUrl}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingToken: parsed.pairingToken,
            deviceId,
            publicKey: toBase64(keyPair.publicKey),
          }),
        })

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
          throw new Error(
            typeof errorBody['error'] === 'string' ? errorBody['error'] : 'Pairing fehlgeschlagen',
          )
        }

        const result = (await response.json()) as Record<string, unknown>
        const jwt = result['tokenB']
        const partnerDeviceId = result['deviceA']

        if (typeof jwt !== 'string' || typeof partnerDeviceId !== 'string') {
          throw new Error('Ungültige Server-Antwort')
        }

        await completePairing({
          privateKey: toBase64(keyPair.secretKey),
          jwt,
          partnerPublicKey: parsed.publicKey,
          deviceId,
          partnerDeviceId,
          relayUrl: parsed.relayUrl,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
        Alert.alert('Pairing fehlgeschlagen', message)
        setStatusText('Scanne den QR-Code auf deinem Desktop')
        setIsProcessing(false)
      }
    },
    [isProcessing, completePairing],
  )

  if (!permission?.granted) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <Text style={[styles.statusText, isDark && styles.textDark]}>
          Kamera-Berechtigung wird benötigt
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <Text style={[styles.title, isDark && styles.textDark]}>Gerät koppeln</Text>

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={
            isProcessing
              ? undefined
              : (result) => {
                  void handleBarCodeScanned(result.data)
                }
          }
        />
        <View style={styles.overlay}>
          <View style={styles.scanFrame} />
        </View>
      </View>

      <Text style={[styles.statusText, isDark && styles.textDark]}>{statusText}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  containerDark: {
    backgroundColor: '#1a1a2e',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 24,
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 200,
    height: 200,
    borderWidth: 2,
    borderColor: '#4f8ef7',
    borderRadius: 12,
  },
  statusText: {
    fontSize: 16,
    color: '#666',
    marginTop: 24,
    textAlign: 'center',
  },
  textDark: {
    color: '#e0e0e0',
  },
})
