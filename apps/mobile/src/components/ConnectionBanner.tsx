import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ConnectionStatus } from '../types'

interface Props {
  readonly status: ConnectionStatus
  readonly isDark: boolean
}

const STATUS_CONFIG: Record<Exclude<ConnectionStatus, 'connected'>, { text: string; color: string }> = {
  connecting: { text: 'Verbinde...', color: '#ff9800' },
  disconnected: { text: 'Keine Verbindung', color: '#f44336' },
}

export function ConnectionBanner({ status, isDark }: Props): React.JSX.Element | null {
  if (status === 'connected') return null

  const config = STATUS_CONFIG[status]

  return (
    <View style={[styles.banner, { backgroundColor: config.color }, isDark && styles.bannerDark]}>
      <Text style={styles.text}>{config.text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  bannerDark: {
    opacity: 0.9,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
})
