// Mock expo-notifications — must be before import
const mockGetPermissionsAsync = jest.fn()
const mockRequestPermissionsAsync = jest.fn()
const mockGetExpoPushTokenAsync = jest.fn()
const mockSetNotificationChannelAsync = jest.fn()
const mockSetBadgeCountAsync = jest.fn()
const mockAddNotificationResponseReceivedListener = jest.fn()

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  setBadgeCountAsync: (...args: unknown[]) => mockSetBadgeCountAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}))

import { PushService } from '../services/push'

// Mock expo-device with mutable flag
let mockIsDevice = true
jest.mock('expo-device', () => ({
  get isDevice() { return mockIsDevice },
}))

// Mock react-native Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

const RELAY_URL = 'https://relay.example.com'
const JWT = 'test-jwt-token'
const DEVICE_ID = 'aabbccdd00112233aabbccdd00112233'
const PUSH_TOKEN = 'ExponentPushToken[abc123]'

describe('PushService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  describe('registerForPushNotifications', () => {
    it('returns token when permission granted', async () => {
      mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' })
      mockGetExpoPushTokenAsync.mockResolvedValue({ data: PUSH_TOKEN })

      const token = await PushService.registerForPushNotifications()
      expect(token).toBe(PUSH_TOKEN)
    })

    it('requests permission if not granted and returns token', async () => {
      mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' })
      mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' })
      mockGetExpoPushTokenAsync.mockResolvedValue({ data: PUSH_TOKEN })

      const token = await PushService.registerForPushNotifications()
      expect(mockRequestPermissionsAsync).toHaveBeenCalled()
      expect(token).toBe(PUSH_TOKEN)
    })

    it('returns null when permission denied', async () => {
      mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' })
      mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' })

      const token = await PushService.registerForPushNotifications()
      expect(token).toBeNull()
    })

    it('returns null on simulator', async () => {
      mockIsDevice = false

      const token = await PushService.registerForPushNotifications()
      expect(token).toBeNull()

      // Restore
      mockIsDevice = true
    })
  })

  describe('registerTokenWithRelay', () => {
    it('sends PUT request to relay', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true })

      const result = await PushService.registerTokenWithRelay(RELAY_URL, JWT, DEVICE_ID, PUSH_TOKEN)
      expect(result).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        `${RELAY_URL}/devices/${DEVICE_ID}/push-token`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: `Bearer ${JWT}`,
          }),
        }),
      )
    })

    it('returns false on fetch error', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      const result = await PushService.registerTokenWithRelay(RELAY_URL, JWT, DEVICE_ID, PUSH_TOKEN)
      expect(result).toBe(false)
    })
  })

  describe('unregisterTokenFromRelay', () => {
    it('sends DELETE request to relay', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true })

      const result = await PushService.unregisterTokenFromRelay(RELAY_URL, JWT, DEVICE_ID)
      expect(result).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        `${RELAY_URL}/devices/${DEVICE_ID}/push-token`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: `Bearer ${JWT}`,
          }),
        }),
      )
    })

    it('returns false on fetch error', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      const result = await PushService.unregisterTokenFromRelay(RELAY_URL, JWT, DEVICE_ID)
      expect(result).toBe(false)
    })
  })

  describe('clearBadge', () => {
    it('sets badge count to 0', async () => {
      mockSetBadgeCountAsync.mockResolvedValue(undefined)

      await PushService.clearBadge()
      expect(mockSetBadgeCountAsync).toHaveBeenCalledWith(0)
    })
  })

  describe('setupNotificationResponseHandler', () => {
    it('calls onTap when notification is tapped', () => {
      const mockRemove = jest.fn()
      mockAddNotificationResponseReceivedListener.mockReturnValue({ remove: mockRemove })

      const onTap = jest.fn()
      PushService.setupNotificationResponseHandler(onTap)

      expect(mockAddNotificationResponseReceivedListener).toHaveBeenCalledWith(expect.any(Function))

      // Simulate notification tap
      const handler = mockAddNotificationResponseReceivedListener.mock.calls[0][0] as () => void
      handler()
      expect(onTap).toHaveBeenCalled()
    })
  })
})
