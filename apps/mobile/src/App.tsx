import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider } from './contexts/AuthContext'
import { PairingProvider } from './contexts/PairingContext'
import { AppNavigator } from './navigation/AppNavigator'

export function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PairingProvider>
          <NavigationContainer>
            <AppNavigator />
            <StatusBar style="auto" />
          </NavigationContainer>
        </PairingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
