import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'

jest.mock('@clerk/clerk-expo', () => ({
  useSignIn: () => ({
    signIn: {
      create: jest.fn().mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' }),
    },
    setActive: jest.fn(),
    isLoaded: true,
  }),
}))

import { AuthScreen } from '../screens/AuthScreen'

describe('AuthScreen', () => {
  it('renders email and password fields', () => {
    const { getByPlaceholderText } = render(<AuthScreen />)

    expect(getByPlaceholderText('E-Mail')).toBeTruthy()
    expect(getByPlaceholderText('Passwort')).toBeTruthy()
  })

  it('renders sign-in button', () => {
    const { getByText } = render(<AuthScreen />)

    expect(getByText('Anmelden')).toBeTruthy()
  })

  it('renders skip button when onSkip is provided', () => {
    const onSkip = jest.fn()
    const { getByText } = render(<AuthScreen onSkip={onSkip} />)

    const skipButton = getByText('Ohne Account starten')
    expect(skipButton).toBeTruthy()

    fireEvent.press(skipButton)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('does not render skip button when onSkip is not provided', () => {
    const { queryByText } = render(<AuthScreen />)

    expect(queryByText('Ohne Account starten')).toBeNull()
  })
})
