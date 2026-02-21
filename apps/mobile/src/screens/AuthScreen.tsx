import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSignIn } from '@clerk/clerk-expo'

interface AuthScreenProps {
  onSkip?: () => void
}

export function AuthScreen({ onSkip }: AuthScreenProps): React.JSX.Element {
  const { signIn, setActive, isLoaded } = useSignIn()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignIn = useCallback(async () => {
    if (!isLoaded || !signIn) return

    setError('')
    setLoading(true)

    try {
      const result = await signIn.create({ identifier: email, password })

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
      } else {
        setError('Anmeldung konnte nicht abgeschlossen werden')
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [isLoaded, signIn, setActive, email, password])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Anmelden</Text>
        <Text style={styles.subtitle}>Melde dich mit deinem Account an</Text>

        <TextInput
          style={styles.input}
          placeholder="E-Mail"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Passwort"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error !== '' && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void handleSignIn()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Anmelden</Text>
          )}
        </Pressable>

        {onSkip != null && (
          <Pressable onPress={onSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Ohne Account starten</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#e0e0e0',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#16213e',
    color: '#e0e0e0',
    padding: 14,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 16,
  },
  error: {
    color: '#ef4444',
    marginBottom: 16,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#4f8ef7',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    color: '#666',
    fontSize: 14,
  },
})
