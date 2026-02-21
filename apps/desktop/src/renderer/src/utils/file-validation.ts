/**
 * Shared file validation utilities.
 * Single source of truth for allowed extensions, max file size, and validation logic.
 */

export const ALLOWED_EXTENSIONS = new Set([
  'txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx',
])

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isImage(name: string): boolean {
  const ext = getExtension(name)
  return ext === 'png' || ext === 'jpg'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateFiles(fileList: FileList): { valid: File[]; error: string | null } {
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

/** Map of file extension to display icon */
export const FILE_ICONS = new Map<string, string>([
  ['txt', '\u{1F4C4}'],
  ['pdf', '\u{1F4D5}'],
  ['md', '\u{1F4DD}'],
  ['csv', '\u{1F4CA}'],
  ['json', '\u{1F4CB}'],
  ['png', '\u{1F5BC}'],
  ['jpg', '\u{1F5BC}'],
  ['docx', '\u{1F4C3}'],
])
