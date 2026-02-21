import { useState, useCallback, useRef } from 'react'
import { ALLOWED_EXTENSIONS, validateFiles } from '../utils/file-validation'

export default function FileDropZone({
  onFilesSelected,
  children,
}: {
  readonly onFilesSelected: (files: File[]) => void
  readonly children: React.ReactNode
}): JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (dragCounter.current === 1) {
      setIsDragOver(true)
      setError(null)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragOver(false)

      const { files } = e.dataTransfer
      if (files.length === 0) return

      const { valid, error: validationError } = validateFiles(files)
      if (validationError) {
        setError(validationError)
        return
      }
      setError(null)
      onFilesSelected(valid)
    },
    [onFilesSelected],
  )

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-surface-alt/70 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-content-secondary px-8 py-6 text-center">
            <p className="text-lg font-medium text-content">Datei hier ablegen</p>
            <p className="mt-1 text-sm text-content-secondary">
              {Array.from(ALLOWED_EXTENSIONS).map((e) => `.${e}`).join(', ')}
            </p>
          </div>
        </div>
      )}

      {error !== null && (
        <div className="absolute bottom-0 left-0 right-0 z-50 border-t border-error/50 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}
    </div>
  )
}
