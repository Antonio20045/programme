import * as LocalAuthentication from 'expo-local-authentication'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'settings:biometricsEnabled'

export class BiometricsService {
  static async isAvailable(): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync()
    if (!hasHardware) return false
    const isEnrolled = await LocalAuthentication.isEnrolledAsync()
    return isEnrolled
  }

  static async isEnabled(): Promise<boolean> {
    const available = await BiometricsService.isAvailable()
    if (!available) return false
    const value = await AsyncStorage.getItem(STORAGE_KEY)
    return value === 'true'
  }

  static async setEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, String(enabled))
  }

  static async authenticate(promptMessage?: string): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage ?? 'Authentifizierung erforderlich',
      fallbackLabel: 'Passcode verwenden',
      disableDeviceFallback: false,
    })
    return result.success
  }
}
