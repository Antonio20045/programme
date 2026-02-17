import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '../hooks/useChat'
import type { ChatMessage } from '../hooks/useChat'
import { useGatewayStatus } from '../hooks/useGatewayStatus'
import { useGatewayConfig } from '../hooks/useGatewayConfig'
import MarkdownMessage from '../components/MarkdownMessage'
import FileDropZone from '../components/FileDropZone'
import FilePreview from '../components/FilePreview'
import AttachmentButton from '../components/AttachmentButton'
import ToolExecution from '../components/ToolExecution'
import ToolConfirmation from '../components/ToolConfirmation'

interface ChatProps {
  readonly activeSessionId: string | null
  readonly onSessionCreated: (sessionId: string) => void
}

function TypingIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
    </div>
  )
}

function MessageBubble({
  message,
  onConfirmTool,
}: {
  readonly message: ChatMessage
  readonly onConfirmTool: (
    toolCallId: string,
    decision: 'execute' | 'reject',
    modifiedParams?: Record<string, unknown>,
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
      <ToolConfirmation
        toolName={message.toolName}
        params={message.toolParams ?? {}}
        toolCallId={message.toolCallId}
        preview={message.toolConfirmPreview}
        onConfirm={onConfirmTool}
      />
    )
  }

  // Tool execution message
  if (message.toolStartedAt !== undefined && message.toolName !== undefined) {
    return (
      <ToolExecution
        toolName={message.toolName}
        params={message.toolParams ?? {}}
        result={message.toolResult}
        startedAt={message.toolStartedAt}
        finishedAt={message.toolFinishedAt}
      />
    )
  }

  // Assistant message with markdown
  if (!isUser) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[75%] rounded-lg bg-gray-800 px-4 py-2">
          <MarkdownMessage content={message.content} />
        </div>
      </div>
    )
  }

  // User message
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-gray-600 px-4 py-2 text-sm text-gray-100">
        {message.content}
      </div>
    </div>
  )
}

export default function Chat({ activeSessionId, onSessionCreated }: ChatProps): JSX.Element {
  const { messages, isLoading, error, sendMessage, confirmTool } = useChat({ activeSessionId, onSessionCreated })
  const gatewayStatus = useGatewayStatus()
  const { mode } = useGatewayConfig()
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<string>('local')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOffline = gatewayStatus !== 'online' && gatewayStatus !== 'starting'
  const agentOffline = mode === 'server' && agentStatus === 'disconnected'

  useEffect(() => {
    if (mode !== 'server') return
    void window.api.agentStatus().then((s) => {
      setAgentStatus(typeof s === 'string' ? s : 'local')
    })
    const unsubscribe = window.api.onAgentStatus((s) => {
      setAgentStatus(typeof s === 'string' ? s : 'local')
    })
    return unsubscribe
  }, [mode])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleFilesSelected = useCallback((files: File[]) => {
    setAttachedFiles((prev) => [...prev, ...files])
    setFileError(null)
  }, [])

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleFileError = useCallback((message: string) => {
    setFileError(message)
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (trimmed.length === 0 || isOffline) return
    const files = attachedFiles.length > 0 ? attachedFiles : undefined
    sendMessage(trimmed, files)
    setInput('')
    setAttachedFiles([])
    setFileError(null)
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isOffline, sendMessage, attachedFiles])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-resize textarea
    const target = e.target
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 160).toString()}px`
  }, [])

  return (
    <FileDropZone onFilesSelected={handleFilesSelected}>
      <div className="flex h-full flex-col">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.length === 0 && (
              <p className="mt-8 text-center text-sm text-gray-500">
                Sende eine Nachricht um zu starten.
              </p>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onConfirmTool={confirmTool} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Error bar */}
        {error !== null && (
          <div className="border-t border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* File error bar */}
        {fileError !== null && (
          <div className="border-t border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
            {fileError}
          </div>
        )}

        {/* Offline banner */}
        {isOffline && (
          <div className="border-t border-amber-800 bg-amber-950 px-4 py-2 text-center text-sm text-amber-300">
            Gateway nicht erreichbar
          </div>
        )}

        {/* Agent offline banner (server mode only) */}
        {agentOffline && !isOffline && (
          <div className="border-t border-amber-800 bg-amber-950 px-4 py-2 text-center text-sm text-amber-300">
            Desktop-Agent nicht verbunden — lokale Tools nicht verf&uuml;gbar
          </div>
        )}

        {/* File preview */}
        <FilePreview files={attachedFiles} onRemove={handleRemoveFile} />

        {/* Input area */}
        <div className="border-t border-gray-800 p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <AttachmentButton
              onFilesSelected={handleFilesSelected}
              onError={handleFileError}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={isOffline}
              placeholder={isOffline ? 'Gateway offline...' : 'Nachricht eingeben...'}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-gray-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isOffline || input.trim().length === 0}
              className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Senden
            </button>
          </div>
        </div>
      </div>
    </FileDropZone>
  )
}

export type { ChatProps }
