import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import { usePairing } from '../contexts/PairingContext'
import { BiometricsService } from '../services/biometrics'
import { PushService } from '../services/push'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation/AppNavigator'

interface Props {
  readonly navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>
}

export function SettingsScreen({ navigation }: Props): React.JSX.Element {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const { data: pairing, unpair } = usePairing()
  const [biometricsEnabled, setBiometricsEnabled] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)

  useEffect(() => {
    void loadSettings()
    async function loadSettings(): Promise<void> {
      const bioEnabled = await BiometricsService.isEnabled()
      setBiometricsEnabled(bioEnabled)

      const { status } = await Notifications.getPermissionsAsync()
      setPushEnabled(status === 'granted')
    }
  }, [])

  const handleToggleBiometrics = useCallback(async (value: boolean) => {
    if (value) {
      const available = await BiometricsService.isAvailable()
      if (!available) {
        Alert.alert('Nicht verfügbar', 'Biometrische Authentifizierung ist auf diesem Gerät nicht eingerichtet.')
        return
      }
      const success = await BiometricsService.authenticate('Biometrie aktivieren')
      if (success) {
        await BiometricsService.setEnabled(true)
        setBiometricsEnabled(true)
      }
    } else {
      await BiometricsService.setEnabled(false)
      setBiometricsEnabled(false)
    }
  }, [])

  const handleTogglePush = useCallback(async (value: boolean) => {
    if (!pairing) return

    if (value) {
      const pushToken = await PushService.registerForPushNotifications()
      if (pushToken) {
        await PushService.registerTokenWithRelay(pairing.relayUrl, pairing.jwt, pairing.deviceId, pushToken)
        setPushEnabled(true)
      } else {
        Alert.alert('Nicht verfügbar', 'Push-Benachrichtigungen konnten nicht aktiviert werden.')
      }
    } else {
      await PushService.unregisterTokenFromRelay(pairing.relayUrl, pairing.jwt, pairing.deviceId)
      setPushEnabled(false)
    }
  }, [pairing])

  const handleUnpair = useCallback(() => {
    Alert.alert(
      'Gerät entkoppeln',
      'Möchtest du die Verbindung zum Desktop wirklich trennen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entkoppeln',
          style: 'destructive',
          onPress: async () => {
            await unpair()
            navigation.reset({ index: 0, routes: [{ name: 'Pairing' }] })
          },
        },
      ],
    )
  }, [unpair, navigation])

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.sectionTitle, isDark && styles.textDark]}>Verbindung</Text>
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.row}>
          <Text style={[styles.label, isDark && styles.textDark]}>Status</Text>
          <Text style={[styles.value, { color: pairing ? '#4caf50' : '#f44336' }]}>
            {pairing ? 'Gekoppelt' : 'Nicht gekoppelt'}
          </Text>
        </View>
        {pairing && (
          <View style={styles.row}>
            <Text style={[styles.label, isDark && styles.textDark]}>Relay</Text>
            <Text style={[styles.value, isDark && styles.valueDark]} numberOfLines={1}>
              {pairing.relayUrl}
            </Text>
          </View>
        )}
      </View>

      <Text style={[styles.sectionTitle, isDark && styles.textDark]}>Sicherheit</Text>
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.row}>
          <Text style={[styles.label, isDark && styles.textDark]}>Biometrie</Text>
          <Switch
            value={biometricsEnabled}
            onValueChange={(v) => void handleToggleBiometrics(v)}
            trackColor={{ true: '#4f8ef7' }}
          />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, isDark && styles.textDark]}>Push-Benachrichtigungen</Text>
          <Switch
            value={pushEnabled}
            onValueChange={(v) => void handleTogglePush(v)}
            trackColor={{ true: '#4f8ef7' }}
          />
        </View>
      </View>

      <Text style={[styles.sectionTitle, isDark && styles.textDark]}>Info</Text>
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.row}>
          <Text style={[styles.label, isDark && styles.textDark]}>Version</Text>
          <Text style={[styles.value, isDark && styles.valueDark]}>0.0.1</Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, isDark && styles.textDark]}>Verschlüsselung</Text>
          <Text style={[styles.value, isDark && styles.valueDark]}>X25519 + XSalsa20-Poly1305</Text>
        </View>
      </View>

      {pairing && (
        <TouchableOpacity style={styles.dangerButton} onPress={handleUnpair}>
          <Text style={styles.dangerButtonText}>Gerät entkoppeln</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  containerDark: {
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardDark: {
    backgroundColor: '#252547',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    fontSize: 16,
    color: '#333',
  },
  value: {
    fontSize: 16,
    color: '#666',
    maxWidth: '60%',
  },
  valueDark: {
    color: '#aaa',
  },
  textDark: {
    color: '#e0e0e0',
  },
  dangerButton: {
    marginTop: 32,
    backgroundColor: '#f44336',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
