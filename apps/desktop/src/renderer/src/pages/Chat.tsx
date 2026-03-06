import { useRef, useEffect, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChat } from '../hooks/useChat'
import type { ChatMessage } from '../hooks/useChat'
import { useGatewayStatus } from '../hooks/useGatewayStatus'
import { useGatewayConfig } from '../hooks/useGatewayConfig'
import { useAgentStatus } from '../hooks/useAgentStatus'
import { useNotifications } from '../hooks/useNotifications'
import { useReducedMotion } from '../hooks/useReducedMotion'
import MarkdownMessage from '../components/MarkdownMessage'
import FileDropZone from '../components/FileDropZone'
import ChatInput from '../components/ChatInput'
import EmptyState from '../components/EmptyState'
import StreamingCursor from '../components/StreamingCursor'
import ToolExecution from '../components/ToolExecution'
import ToolConfirmation from '../components/ToolConfirmation'
import NotificationBanner from '../components/NotificationBanner'
import { typingDotVariants, typingDotTransition, messageVariants, messageTransition, staticVariants } from '../utils/motion'

interface ChatProps {
  readonly activeSessionId: string | null
  readonly onSessionCreated: (sessionId: string) => void
  readonly onTitleUpdate: (sessionId: string, title: string) => void
}

function TypingIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-2 w-2 rounded-full bg-accent/60"
          variants={typingDotVariants}
          initial="initial"
          animate="animate"
          transition={typingDotTransition(i)}
        />
      ))}
    </div>
  )
}

function ActionIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <motion.div
        className="h-2 w-2 rounded-full bg-accent"
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="text-sm text-muted-foreground">Arbeitet...</span>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  onConfirmTool,
}: {
  readonly message: ChatMessage
  readonly isStreaming: boolean
  readonly onConfirmTool: (
    toolCallId: string,
    decision: 'execute' | 'reject',
    modifiedParams?: Record<string, unknown>,
    oauthTokens?: { accessToken: string; refreshToken: string; expiresAt: number },
  ) => void
}): JSX.Element {
  const reduced = useReducedMotion()
  const v = reduced ? staticVariants : messageVariants
  const t = reduced ? undefined : messageTransition
  const isUser = message.role === 'user'

  // Tool confirmation pending
  if (
    message.toolConfirmPending === true &&
    message.toolCallId !== undefined &&
    message.toolName !== undefined &&
    message.toolConfirmPreview !== undefined
  ) {
    return (
      <motion.div variants={v} initial="initial" animate="animate" transition={t}>
        <ToolConfirmation
          toolName={message.toolName}
          params={message.toolParams ?? {}}
          toolCallId={message.toolCallId}
          preview={message.toolConfirmPreview}
          onConfirm={onConfirmTool}
        />
      </motion.div>
    )
  }

  // Tool execution message
  if (message.toolStartedAt !== undefined && message.toolName !== undefined) {
    return (
      <motion.div variants={v} initial="initial" animate="animate" transition={t}>
        <ToolExecution
          toolName={message.toolName}
          params={message.toolParams ?? {}}
          result={message.toolResult}
          startedAt={message.toolStartedAt}
          finishedAt={message.toolFinishedAt}
        />
      </motion.div>
    )
  }

  // Assistant message with markdown
  if (!isUser) {
    return (
      <motion.div variants={v} initial="initial" animate="animate" transition={t}>
        <div className="flex gap-3">
          <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
          <div className="max-w-[720px]">
            <MarkdownMessage content={message.content} />
            {isStreaming && message.content.length > 0 && <StreamingCursor />}
          </div>
        </div>
      </motion.div>
    )
  }

  // User message
  return (
    <motion.div variants={v} initial="initial" animate="animate" transition={t} className="flex justify-end">
      <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl border border-edge/50 bg-user-bubble px-4 py-2.5 text-sm text-content shadow-sm">
        {message.content}
      </div>
    </motion.div>
  )
})

export default function Chat({ activeSessionId, onSessionCreated, onTitleUpdate }: ChatProps): JSX.Element {
  const { messages, isLoading, error, responseMode, sendMessage, confirmTool } = useChat({ activeSessionId, onSessionCreated, onTitleUpdate })
  const gatewayStatus = useGatewayStatus()
  const { mode } = useGatewayConfig()
  const agentStatus = useAgentStatus()
  const { notifications, acknowledge, acknowledgeAll } = useNotifications()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isOffline = gatewayStatus !== 'online' && gatewayStatus !== 'starting'
  const agentOffline = mode === 'server' && agentStatus === 'disconnected'

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSend = useCallback(
    (text: string, files?: File[]) => {
      sendMessage(text, files)
    },
    [sendMessage],
  )

  const handleSuggestionClick = useCallback(
    (text: string) => {
      sendMessage(text)
    },
    [sendMessage],
  )

  return (
    <FileDropZone onFilesSelected={(files) => { handleSend('', files) }}>
      <div className="flex h-full flex-col">
        {/* Notification banners from proactive sub-agents */}
        <NotificationBanner
          notifications={notifications}
          onAcknowledge={acknowledge}
          onAcknowledgeAll={acknowledgeAll}
        />

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.length === 0 && !isLoading && (
              <EmptyState onSuggestionClick={handleSuggestionClick} />
            )}
            <AnimatePresence initial={false}>
              {messages.map((msg, idx) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={isLoading && idx === messages.length - 1 && msg.role === 'assistant' && msg.toolStartedAt === undefined}
                  onConfirmTool={confirmTool}
                />
              ))}
            </AnimatePresence>
            {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
              responseMode === 'action' ? <ActionIndicator /> : <TypingIndicator />
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Status banners */}
        {error !== null && (
          <div className="border-t border-error/50 bg-error/10 px-4 py-2 text-sm text-error">
            {error}
          </div>
        )}
        {isOffline && (
          <div className="border-t border-warning/50 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
            Gateway nicht erreichbar
          </div>
        )}
        {agentOffline && !isOffline && (
          <div className="border-t border-warning/50 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
            Desktop-Agent nicht verbunden — lokale Tools nicht verfügbar
          </div>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          disabled={isOffline}
          placeholder={isOffline ? 'Gateway offline...' : 'Nachricht eingeben...'}
        />
      </div>
    </FileDropZone>
  )
}

export type { ChatProps }
