import { BiometricsService } from '../services/biometrics'

const mockHasHardwareAsync = jest.fn()
const mockIsEnrolledAsync = jest.fn()
const mockAuthenticateAsync = jest.fn()

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: (...args: unknown[]) => mockHasHardwareAsync(...args),
  isEnrolledAsync: (...args: unknown[]) => mockIsEnrolledAsync(...args),
  authenticateAsync: (...args: unknown[]) => mockAuthenticateAsync(...args),
}))

const mockGetItem = jest.fn()
const mockSetItem = jest.fn()

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
    setItem: (...args: unknown[]) => mockSetItem(...args),
  },
}))

describe('BiometricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('isAvailable', () => {
    it('returns true when hardware and enrollment present', async () => {
      mockHasHardwareAsync.mockResolvedValue(true)
      mockIsEnrolledAsync.mockResolvedValue(true)

      const result = await BiometricsService.isAvailable()
      expect(result).toBe(true)
    })

    it('returns false when no hardware', async () => {
      mockHasHardwareAsync.mockResolvedValue(false)

      const result = await BiometricsService.isAvailable()
      expect(result).toBe(false)
      expect(mockIsEnrolledAsync).not.toHaveBeenCalled()
    })

    it('returns false when hardware but not enrolled', async () => {
      mockHasHardwareAsync.mockResolvedValue(true)
      mockIsEnrolledAsync.mockResolvedValue(false)

      const result = await BiometricsService.isAvailable()
      expect(result).toBe(false)
    })
  })

  describe('isEnabled', () => {
    it('returns true when AsyncStorage is "true" and hardware available', async () => {
      mockHasHardwareAsync.mockResolvedValue(true)
      mockIsEnrolledAsync.mockResolvedValue(true)
      mockGetItem.mockResolvedValue('true')

      const result = await BiometricsService.isEnabled()
      expect(result).toBe(true)
    })

    it('returns false when AsyncStorage is "true" but hardware unavailable', async () => {
      mockHasHardwareAsync.mockResolvedValue(false)
      mockGetItem.mockResolvedValue('true')

      const result = await BiometricsService.isEnabled()
      expect(result).toBe(false)
    })

    it('returns false when AsyncStorage is null', async () => {
      mockHasHardwareAsync.mockResolvedValue(true)
      mockIsEnrolledAsync.mockResolvedValue(true)
      mockGetItem.mockResolvedValue(null)

      const result = await BiometricsService.isEnabled()
      expect(result).toBe(false)
    })
  })

  describe('setEnabled', () => {
    it('stores "true" in AsyncStorage', async () => {
      mockSetItem.mockResolvedValue(undefined)

      await BiometricsService.setEnabled(true)
      expect(mockSetItem).toHaveBeenCalledWith('settings:biometricsEnabled', 'true')
    })

    it('stores "false" in AsyncStorage', async () => {
      mockSetItem.mockResolvedValue(undefined)

      await BiometricsService.setEnabled(false)
      expect(mockSetItem).toHaveBeenCalledWith('settings:biometricsEnabled', 'false')
    })
  })

  describe('authenticate', () => {
    it('returns true on success', async () => {
      mockAuthenticateAsync.mockResolvedValue({ success: true })

      const result = await BiometricsService.authenticate()
      expect(result).toBe(true)
    })

    it('returns false on failure', async () => {
      mockAuthenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' })

      const result = await BiometricsService.authenticate()
      expect(result).toBe(false)
    })

    it('passes custom prompt message', async () => {
      mockAuthenticateAsync.mockResolvedValue({ success: true })

      await BiometricsService.authenticate('Custom prompt')
      expect(mockAuthenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Custom prompt' }),
      )
    })
  })
})
