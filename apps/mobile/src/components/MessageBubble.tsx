import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MarkdownContent } from './MarkdownContent'
import { ToolExecutionCard } from './ToolExecutionCard'
import type { ChatMessage } from '../types'

interface Props {
  readonly message: ChatMessage
  readonly isDark: boolean
}

export function MessageBubble({ message, isDark }: Props): React.JSX.Element {
  const isUser = message.role === 'user'

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? styles.userBubble
            : [styles.assistantBubble, isDark && styles.assistantBubbleDark],
        ]}
      >
        {isUser ? (
          <Text style={styles.userText}>{message.content}</Text>
        ) : (
          <MarkdownContent content={message.content} isDark={isDark} />
        )}

        {message.toolCalls?.map((tc, i) => (
          <ToolExecutionCard key={`${tc.name}-${i.toString()}`} toolCall={tc} isDark={isDark} />
        ))}
      </View>

      <Text style={[styles.timestamp, isDark && styles.timestampDark]}>
        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
    maxWidth: '85%',
  },
  userContainer: {
    alignSelf: 'flex-end',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    padding: 12,
  },
  userBubble: {
    backgroundColor: '#4f8ef7',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#e8e8e8',
    borderBottomLeftRadius: 4,
  },
  assistantBubbleDark: {
    backgroundColor: '#252547',
  },
  userText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  timestamp: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  timestampDark: {
    color: '#666',
  },
})
