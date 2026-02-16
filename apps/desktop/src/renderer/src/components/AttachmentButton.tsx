import { useCallback } from 'react'

const ALLOWED_EXTENSIONS = new Set([
  'txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx',
])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export default function AttachmentButton({
  onFilesSelected,
  onError,
}: {
  readonly onFilesSelected: (files: File[]) => void
  readonly onError: (message: string) => void
}): JSX.Element {
  const handleClick = useCallback(async () => {
    const result = await window.api.openFileDialog()
    if (result === null) return

    const files: File[] = []
    for (const entry of result) {
      if (!ALLOWED_EXTENSIONS.has(getExtension(entry.name))) {
        onError(`Dateityp nicht erlaubt: ${entry.name}`)
        return
      }
      if (entry.size > MAX_FILE_SIZE) {
        onError(`Datei zu groß (max 10 MB): ${entry.name}`)
        return
      }
      const binary = atob(entry.buffer)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      files.push(new File([bytes], entry.name, { lastModified: Date.now() }))
    }
    onFilesSelected(files)
  }, [onFilesSelected, onError])

  return (
    <button
      type="button"
      onClick={() => {
        void handleClick()
      }}
      className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
      aria-label="Datei anhängen"
      title="Datei anhängen"
    >
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243l5.657-5.657a1 1 0 1 1 1.414 1.414l-5.657 5.657a5 5 0 0 1-7.07-7.071l7-7a3 3 0 0 1 4.241 0 3 3 0 0 1 0 4.242l-6.364 6.364a1 1 0 0 1-1.414-1.414l6.364-6.364a1 1 0 0 0 0-1.414z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  )
}
