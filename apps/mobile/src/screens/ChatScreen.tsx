import React, { useCallback, useRef } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  useColorScheme,
} from 'react-native'
import { useChat } from '../hooks/useChat'
import { useAppState } from '../hooks/useAppState'
import { MessageBubble } from '../components/MessageBubble'
import { ChatInput } from '../components/ChatInput'
import { ConnectionBanner } from '../components/ConnectionBanner'
import { LoadingDots } from '../components/LoadingDots'
import type { ChatMessage } from '../types'

export function ChatScreen(): React.JSX.Element {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const { messages, isStreaming, connectionStatus, sendMessage } = useChat()
  const flatListRef = useRef<FlatList<ChatMessage>>(null)

  useAppState({})


  const handleSend = useCallback(
    (text: string) => {
      sendMessage(text)
      // Scroll to bottom after sending
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 100)
    },
    [sendMessage],
  )

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => <MessageBubble message={item} isDark={isDark} />,
    [isDark],
  )

  const keyExtractor = useCallback((item: ChatMessage) => item.id, [])

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDark && styles.containerDark]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {connectionStatus !== 'connected' && (
        <ConnectionBanner status={connectionStatus} isDark={isDark} />
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => {
          flatListRef.current?.scrollToEnd({ animated: true })
        }}
      />

      {isStreaming && (
        <View style={styles.loadingContainer}>
          <LoadingDots isDark={isDark} />
        </View>
      )}

      <ChatInput onSend={handleSend} disabled={connectionStatus !== 'connected'} isDark={isDark} />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  containerDark: {
    backgroundColor: '#1a1a2e',
  },
  listContent: {
    padding: 16,
    paddingBottom: 8,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
})
