import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react-native'
import { LockScreen } from '../screens/LockScreen'

const mockAuthenticate = jest.fn()

jest.mock('../services/biometrics', () => ({
  BiometricsService: {
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  },
}))

describe('LockScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('attempts authentication on mount', async () => {
    mockAuthenticate.mockResolvedValue(true)
    const onUnlock = jest.fn()

    render(<LockScreen onUnlock={onUnlock} />)

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledWith('App entsperren')
    })
  })

  it('calls onUnlock on successful authentication', async () => {
    mockAuthenticate.mockResolvedValue(true)
    const onUnlock = jest.fn()

    render(<LockScreen onUnlock={onUnlock} />)

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalled()
    })
  })

  it('shows retry button and attempt counter on failure', async () => {
    mockAuthenticate.mockResolvedValue(false)
    const onUnlock = jest.fn()

    const { getByText } = render(<LockScreen onUnlock={onUnlock} />)

    await waitFor(() => {
      expect(getByText(/1\/3/)).toBeTruthy()
    })

    expect(getByText('Erneut versuchen')).toBeTruthy()
    expect(onUnlock).not.toHaveBeenCalled()
  })

  it('shows restart message after 3 failed attempts', async () => {
    mockAuthenticate.mockResolvedValue(false)
    const onUnlock = jest.fn()

    const { getByText } = render(<LockScreen onUnlock={onUnlock} />)

    // Wait for initial auto-attempt (1/3)
    await waitFor(() => {
      expect(getByText(/1\/3/)).toBeTruthy()
    })

    // Retry twice more
    fireEvent.press(getByText('Erneut versuchen'))
    await waitFor(() => {
      expect(getByText(/2\/3/)).toBeTruthy()
    })

    fireEvent.press(getByText('Erneut versuchen'))
    await waitFor(() => {
      expect(getByText(/starte die App neu/)).toBeTruthy()
    })
  })

  it('retry button triggers new authentication attempt', async () => {
    mockAuthenticate
      .mockResolvedValueOnce(false) // initial mount
      .mockResolvedValueOnce(true)  // retry succeeds

    const onUnlock = jest.fn()

    const { getByText } = render(<LockScreen onUnlock={onUnlock} />)

    await waitFor(() => {
      expect(getByText('Erneut versuchen')).toBeTruthy()
    })

    fireEvent.press(getByText('Erneut versuchen'))

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalled()
    })

    expect(mockAuthenticate).toHaveBeenCalledTimes(2)
  })
})
