import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../utils/cn'
import AttachmentButton from './AttachmentButton'
import FilePreview from './FilePreview'

interface ChatInputProps {
  readonly onSend: (text: string, files?: File[]) => void
  readonly disabled: boolean
  readonly placeholder?: string
}

export default function ChatInput({
  onSend,
  disabled,
  placeholder = 'Nachricht eingeben...',
}: ChatInputProps): JSX.Element {
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    if (trimmed.length === 0 || disabled) return
    const files = attachedFiles.length > 0 ? attachedFiles : undefined
    onSend(trimmed, files)
    setInput('')
    setAttachedFiles([])
    setFileError(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, disabled, onSend, attachedFiles])

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
    const target = e.target
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 160).toString()}px`
  }, [])

  return (
    <div className="mx-3 mb-3">
      <div className={cn('glass rounded-xl shadow-md')}>
        {/* File error */}
        <AnimatePresence>
          {fileError !== null && (
            <motion.div
              key="file-error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="border-b border-error/30 bg-error/10 px-4 py-1.5 text-xs text-error"
            >
              {fileError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attached files preview */}
        {attachedFiles.length > 0 && (
          <div className="border-b border-edge px-2">
            <FilePreview files={attachedFiles} onRemove={handleRemoveFile} />
          </div>
        )}

        {/* Input row */}
        <div className="p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <AttachmentButton
              onFilesSelected={handleFilesSelected}
              onError={handleFileError}
            />
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder={placeholder}
                rows={1}
                className="w-full resize-none rounded-xl border-0 bg-transparent px-4 py-2.5 pr-12 text-sm text-content placeholder-content-muted transition-colors focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {/* Send button inside textarea */}
              <motion.button
                type="button"
                onClick={handleSend}
                disabled={disabled || input.trim().length === 0}
                whileTap={{ scale: 0.92 }}
                className="absolute bottom-1.5 right-1.5 rounded-lg bg-accent p-1.5 text-surface transition-colors hover:bg-accent-hover disabled:opacity-30"
                aria-label="Senden"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.724 1.053a.5.5 0 0 1 .541-.054l12 6a.5.5 0 0 1 0 .894l-12 6A.5.5 0 0 1 1.5 13.5V9l7-1-7-1V2.5a.5.5 0 0 1 .224-.447z" />
                </svg>
              </motion.button>
            </div>
          </div>
          <p className="mx-auto mt-1 max-w-3xl pl-10 text-[11px] text-content-muted/50">
            Enter zum Senden · Shift+Enter für neue Zeile
          </p>
        </div>
      </div>
    </div>
  )
}

export type { ChatInputProps }
