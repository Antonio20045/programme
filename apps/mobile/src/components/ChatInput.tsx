import React, { useCallback, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import * as Haptics from 'expo-haptics'

interface Props {
  readonly onSend: (text: string) => void
  readonly disabled: boolean
  readonly isDark: boolean
}

export function ChatInput({ onSend, disabled, isDark }: Props): React.JSX.Element {
  const [text, setText] = useState('')

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onSend(trimmed)
    setText('')
  }, [text, disabled, onSend])

  const canSend = text.trim().length > 0 && !disabled

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        value={text}
        onChangeText={setText}
        placeholder="Nachricht eingeben..."
        placeholderTextColor={isDark ? '#666' : '#999'}
        multiline
        maxLength={4000}
        editable={!disabled}
        onSubmitEditing={handleSend}
        blurOnSubmit={false}
      />
      <TouchableOpacity
        style={[styles.sendButton, canSend && styles.sendButtonActive]}
        onPress={handleSend}
        disabled={!canSend}
      >
        <SendIcon color={canSend ? '#fff' : isDark ? '#444' : '#ccc'} />
      </TouchableOpacity>
    </View>
  )
}

function SendIcon({ color }: { readonly color: string }): React.JSX.Element {
  // Simple arrow-up icon using text
  return (
    <View style={styles.iconContainer}>
      <View
        style={[
          styles.arrowUp,
          { borderBottomColor: color },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 24,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  containerDark: {
    backgroundColor: '#16162e',
    borderTopColor: '#333',
  },
  input: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    color: '#333',
  },
  inputDark: {
    backgroundColor: '#252547',
    color: '#e0e0e0',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendButtonActive: {
    backgroundColor: '#4f8ef7',
  },
  iconContainer: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowUp: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
})
