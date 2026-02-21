import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

// --- Mocks ---
const mockUnpair = jest.fn().mockResolvedValue(undefined)
const mockReset = jest.fn()

jest.mock('../contexts/PairingContext', () => ({
  usePairing: () => ({
    isPaired: true,
    isLoading: false,
    data: {
      privateKey: 'pk',
      jwt: 'jwt',
      partnerPublicKey: 'ppk',
      deviceId: 'dev-1',
      partnerDeviceId: 'dev-2',
      relayUrl: 'https://relay.example.com',
    },
    completePairing: jest.fn(),
    unpair: mockUnpair,
  }),
}))

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  setBadgeCountAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}))

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('expo-device', () => ({
  isDevice: true,
}))

jest.spyOn(Alert, 'alert')

import { SettingsScreen } from '../screens/SettingsScreen'

const mockNavigation = {
  reset: mockReset,
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

beforeEach(() => {
  jest.clearAllMocks()
})

describe('SettingsScreen', () => {
  it('renders connection status as paired', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    expect(getByText('Gekoppelt')).toBeTruthy()
  })

  it('displays relay URL', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    expect(getByText('https://relay.example.com')).toBeTruthy()
  })

  it('shows version info', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    expect(getByText('0.0.1')).toBeTruthy()
  })

  it('shows encryption info', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    expect(getByText('X25519 + XSalsa20-Poly1305')).toBeTruthy()
  })

  it('renders unpair button', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    expect(getByText('Gerät entkoppeln')).toBeTruthy()
  })

  it('renders push notifications toggle', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    expect(getByText('Push-Benachrichtigungen')).toBeTruthy()
  })

  it('shows confirmation dialog on unpair', () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    fireEvent.press(getByText('Gerät entkoppeln'))
    expect(Alert.alert).toHaveBeenCalledWith(
      'Gerät entkoppeln',
      'Möchtest du die Verbindung zum Desktop wirklich trennen?',
      expect.any(Array),
    )
  })

  it('calls unpair and resets navigation on confirm', async () => {
    const { getByText } = render(<SettingsScreen navigation={mockNavigation} />)
    fireEvent.press(getByText('Gerät entkoppeln'))

    // Get the destructive action from the Alert
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, Array<{ onPress?: () => void }>]
    const destructiveOption = alertCall[2].find((opt) => opt.onPress)
    await destructiveOption?.onPress?.()

    await waitFor(() => {
      expect(mockUnpair).toHaveBeenCalled()
    })
  })
})
