import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, View, useColorScheme } from 'react-native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { usePairing } from '../contexts/PairingContext'
import { useAuthContext } from '../contexts/AuthContext'
import { BiometricsService } from '../services/biometrics'
import { PairingScreen } from '../screens/PairingScreen'
import { ChatScreen } from '../screens/ChatScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { LockScreen } from '../screens/LockScreen'
import { AuthScreen } from '../screens/AuthScreen'

export type RootStackParamList = {
  Pairing: undefined
  Chat: undefined
  Settings: undefined
  Lock: undefined
  Auth: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

function getInitialRoute(
  isPaired: boolean,
  showLock: boolean,
  clerkEnabled: boolean,
  isSignedIn: boolean,
): keyof RootStackParamList {
  if (!isPaired) return 'Pairing'
  if (showLock) return 'Lock'
  if (clerkEnabled && !isSignedIn) return 'Auth'
  return 'Chat'
}

export function AppNavigator(): React.JSX.Element {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const { isPaired, isLoading } = usePairing()
  const { isSignedIn, isLoaded: authLoaded, clerkEnabled } = useAuthContext()
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [biometricsRequired, setBiometricsRequired] = useState(false)
  const [biometricsChecked, setBiometricsChecked] = useState(false)

  useEffect(() => {
    void checkBiometrics()
    async function checkBiometrics(): Promise<void> {
      try {
        const enabled = await BiometricsService.isEnabled()
        setBiometricsRequired(enabled)
      } finally {
        setBiometricsChecked(true)
      }
    }
  }, [])

  const handleUnlock = useCallback(() => {
    setIsUnlocked(true)
  }, [])

  if (isLoading || !biometricsChecked || !authLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#1a1a2e' : '#f5f5f5' }}>
        <ActivityIndicator size="large" color="#4f8ef7" />
      </View>
    )
  }

  const showLock = isPaired && biometricsRequired && !isUnlocked

  return (
    <Stack.Navigator
      initialRouteName={getInitialRoute(isPaired, showLock, clerkEnabled, isSignedIn)}
      screenOptions={{
        headerStyle: { backgroundColor: isDark ? '#1a1a2e' : '#f5f5f5' },
        headerTintColor: isDark ? '#e0e0e0' : '#1a1a2e',
        headerShadowVisible: false,
        contentStyle: { backgroundColor: isDark ? '#1a1a2e' : '#f5f5f5' },
      }}
    >
      <Stack.Screen
        name="Pairing"
        component={PairingScreen}
        options={{ title: 'Koppeln', headerShown: false }}
      />
      <Stack.Screen
        name="Lock"
        options={{ title: 'Gesperrt', headerShown: false, gestureEnabled: false }}
      >
        {() => <LockScreen onUnlock={handleUnlock} />}
      </Stack.Screen>
      <Stack.Screen
        name="Auth"
        component={AuthScreen}
        options={{ title: 'Anmelden', headerShown: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          title: 'KI-Assistent',
          headerRight: () => null,
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Einstellungen' }}
      />
    </Stack.Navigator>
  )
}
