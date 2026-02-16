import { useState, useCallback, useRef } from 'react'

const ALLOWED_EXTENSIONS = new Set([
  'txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx',
])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function validateFiles(fileList: FileList): { valid: File[]; error: string | null } {
  const valid: File[] = []
  for (const file of Array.from(fileList)) {
    if (!ALLOWED_EXTENSIONS.has(getExtension(file.name))) {
      return { valid: [], error: `Dateityp nicht erlaubt: ${file.name}` }
    }
    if (file.size > MAX_FILE_SIZE) {
      return { valid: [], error: `Datei zu groß (max 10 MB): ${file.name}` }
    }
    valid.push(file)
  }
  return { valid, error: null }
}

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
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-gray-900/70 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-gray-400 px-8 py-6 text-center">
            <p className="text-lg font-medium text-gray-200">Datei hier ablegen</p>
            <p className="mt-1 text-sm text-gray-400">
              .txt, .pdf, .md, .csv, .json, .png, .jpg, .docx
            </p>
          </div>
        </div>
      )}

      {error !== null && (
        <div className="absolute bottom-0 left-0 right-0 z-50 border-t border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}

export { ALLOWED_EXTENSIONS, MAX_FILE_SIZE, validateFiles }
