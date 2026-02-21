import { useEffect, useCallback } from 'react'

interface SlideOverPanelProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: React.ReactNode
}

export default function SlideOverPanel({
  open,
  onClose,
  title,
  children,
}: SlideOverPanelProps): JSX.Element | null {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative flex w-full max-w-md flex-col bg-surface-alt shadow-lg animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 className="text-base font-semibold text-content">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="active-press rounded-md p-1 text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
            aria-label="Schließen"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export type { SlideOverPanelProps }
