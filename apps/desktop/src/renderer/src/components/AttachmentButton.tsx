import { useCallback } from 'react'
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE, getExtension } from '../utils/file-validation'

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
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
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
      className="active-press rounded-lg p-2 text-content-secondary transition-colors hover:bg-surface-hover hover:text-content"
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
