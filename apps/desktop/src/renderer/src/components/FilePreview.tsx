import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getExtension, isImage, formatSize, FILE_ICONS } from '../utils/file-validation'
import { fileItemVariants } from '../utils/motion'

function FileItem({
  file,
  onRemove,
}: {
  readonly file: File
  readonly onRemove: () => void
}): JSX.Element {
  const ext = getExtension(file.name)
  const icon = FILE_ICONS.get(ext) ?? '\u{1F4CE}'
  const thumbnailUrl = useMemo(() => {
    if (!isImage(file.name)) return null
    return URL.createObjectURL(file)
  }, [file])

  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2">
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
        <p className="truncate text-sm text-content">{file.name}</p>
        <p className="text-xs text-content-muted">{formatSize(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-1 text-content-muted transition-colors hover:bg-surface-hover hover:text-content-secondary"
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
      <AnimatePresence>
        {files.map((file, index) => (
          <motion.div
            key={`${file.name}-${file.size.toString()}`}
            variants={fileItemVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.15 }}
          >
            <FileItem
              file={file}
              onRemove={() => {
                onRemove(index)
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
