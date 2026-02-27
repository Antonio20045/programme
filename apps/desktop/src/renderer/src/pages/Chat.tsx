import { useRef, useEffect, useCallback, memo } from 'react'
import { useChat } from '../hooks/useChat'
import type { ChatMessage } from '../hooks/useChat'
import { useGatewayStatus } from '../hooks/useGatewayStatus'
import { useGatewayConfig } from '../hooks/useGatewayConfig'
import { useAgentStatus } from '../hooks/useAgentStatus'
import MarkdownMessage from '../components/MarkdownMessage'
import FileDropZone from '../components/FileDropZone'
import ChatInput from '../components/ChatInput'
import EmptyState from '../components/EmptyState'
import StreamingCursor from '../components/StreamingCursor'
import ToolExecution from '../components/ToolExecution'
import ToolConfirmation from '../components/ToolConfirmation'

interface ChatProps {
  readonly activeSessionId: string | null
  readonly onSessionCreated: (sessionId: string) => void
}

function TypingIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      <span className="h-2 w-2 animate-bounce rounded-full bg-accent/60 [animation-delay:0ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-accent/60 [animation-delay:150ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-accent/60 [animation-delay:300ms]" />
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
  const isUser = message.role === 'user'

  // Tool confirmation pending
  if (
    message.toolConfirmPending === true &&
    message.toolCallId !== undefined &&
    message.toolName !== undefined &&
    message.toolConfirmPreview !== undefined
  ) {
    return (
      <div className="animate-slide-up">
        <ToolConfirmation
          toolName={message.toolName}
          params={message.toolParams ?? {}}
          toolCallId={message.toolCallId}
          preview={message.toolConfirmPreview}
          onConfirm={onConfirmTool}
        />
      </div>
    )
  }

  // Tool execution message
  if (message.toolStartedAt !== undefined && message.toolName !== undefined) {
    return (
      <div className="animate-slide-up">
        <ToolExecution
          toolName={message.toolName}
          params={message.toolParams ?? {}}
          result={message.toolResult}
          startedAt={message.toolStartedAt}
          finishedAt={message.toolFinishedAt}
        />
      </div>
    )
  }

  // Assistant message with markdown
  if (!isUser) {
    return (
      <div className="animate-slide-up">
        <div className="max-w-[720px]">
          <MarkdownMessage content={message.content} />
          {isStreaming && message.content.length > 0 && <StreamingCursor />}
        </div>
      </div>
    )
  }

  // User message
  return (
    <div className="animate-slide-up flex justify-end">
      <div className="max-w-[75%] whitespace-pre-wrap rounded-xl bg-user-bubble px-4 py-2.5 text-sm text-content">
        {message.content}
      </div>
    </div>
  )
})

export default function Chat({ activeSessionId, onSessionCreated }: ChatProps): JSX.Element {
  const { messages, isLoading, error, sendMessage, confirmTool } = useChat({ activeSessionId, onSessionCreated })
  const gatewayStatus = useGatewayStatus()
  const { mode } = useGatewayConfig()
  const agentStatus = useAgentStatus()
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
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.length === 0 && !isLoading && (
              <EmptyState onSuggestionClick={handleSuggestionClick} />
            )}
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={isLoading && idx === messages.length - 1 && msg.role === 'assistant' && msg.toolStartedAt === undefined}
                onConfirmTool={confirmTool}
              />
            ))}
            {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
              <TypingIndicator />
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
