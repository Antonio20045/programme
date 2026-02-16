import { useMemo } from 'react'

const FILE_ICONS: Record<string, string> = {
  txt: '\u{1F4C4}',
  pdf: '\u{1F4D5}',
  md: '\u{1F4DD}',
  csv: '\u{1F4CA}',
  json: '\u{1F4CB}',
  png: '\u{1F5BC}',
  jpg: '\u{1F5BC}',
  docx: '\u{1F4C3}',
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(name: string): boolean {
  const ext = getExtension(name)
  return ext === 'png' || ext === 'jpg'
}

function FileItem({
  file,
  onRemove,
}: {
  readonly file: File
  readonly onRemove: () => void
}): JSX.Element {
  const ext = getExtension(file.name)
  const icon = FILE_ICONS[ext] ?? '\u{1F4CE}'
  const thumbnailUrl = useMemo(() => {
    if (!isImage(file.name)) return null
    return URL.createObjectURL(file)
  }, [file])

  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2">
      {thumbnailUrl !== null ? (
        <img
          src={thumbnailUrl}
          alt={file.name}
          className="h-8 w-8 rounded object-cover"
        />
      ) : (
        <span className="text-lg">{icon}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-200">{file.name}</p>
        <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-1 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-300"
        aria-label={`${file.name} entfernen`}
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
        </svg>
      </button>
    </div>
  )
}

export default function FilePreview({
  files,
  onRemove,
}: {
  readonly files: File[]
  readonly onRemove: (index: number) => void
}): JSX.Element | null {
  if (files.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {files.map((file, index) => (
        <FileItem
          key={`${file.name}-${file.size.toString()}`}
          file={file}
          onRemove={() => {
            onRemove(index)
          }}
        />
      ))}
    </div>
  )
}

export { formatSize, getExtension, isImage }
