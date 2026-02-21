import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native'
import { BiometricsService } from '../services/biometrics'

interface Props {
  readonly onUnlock: () => void
}

const MAX_ATTEMPTS = 3

export function LockScreen({ onUnlock }: Props): React.JSX.Element {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const [attempts, setAttempts] = useState(0)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const locked = attempts >= MAX_ATTEMPTS

  const tryAuthenticate = useCallback(async () => {
    if (isAuthenticating || locked) return
    setIsAuthenticating(true)
    try {
      const success = await BiometricsService.authenticate('App entsperren')
      if (success) {
        onUnlock()
      } else {
        setAttempts((prev) => prev + 1)
      }
    } finally {
      setIsAuthenticating(false)
    }
  }, [isAuthenticating, locked, onUnlock])

  useEffect(() => {
    void tryAuthenticate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.container, isDark ? styles.containerDark : styles.containerLight]}>
      <Text style={[styles.icon]}>🔒</Text>
      <Text style={[styles.title, isDark && styles.textDark]}>App gesperrt</Text>

      {locked ? (
        <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
          Zu viele Fehlversuche. Bitte starte die App neu.
        </Text>
      ) : (
        <>
          {attempts > 0 && (
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
              Authentifizierung fehlgeschlagen ({attempts}/{MAX_ATTEMPTS})
            </Text>
          )}
          <TouchableOpacity
            style={[styles.button, isAuthenticating && styles.buttonDisabled]}
            onPress={() => void tryAuthenticate()}
            disabled={isAuthenticating}
          >
            <Text style={styles.buttonText}>
              {isAuthenticating ? 'Prüfe...' : 'Erneut versuchen'}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  containerLight: {
    backgroundColor: '#f5f5f5',
  },
  containerDark: {
    backgroundColor: '#1a1a2e',
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 8,
  },
  textDark: {
    color: '#e0e0e0',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  subtitleDark: {
    color: '#aaa',
  },
  button: {
    backgroundColor: '#4f8ef7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
