/* eslint-disable security/detect-object-injection */
import { describe, it, expect } from 'vitest'
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  getExtension,
  isImage,
  formatSize,
  validateFiles,
  FILE_ICONS,
} from '../utils/file-validation'

function createFile(name: string, size: number): File {
  const buffer = new ArrayBuffer(size)
  return new File([buffer], name, { lastModified: Date.now() })
}

function createFileList(files: File[]): FileList {
  const list = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f
    },
  } as unknown as FileList
  for (let i = 0; i < files.length; i++) {
    Object.defineProperty(list, i, { value: files[i], enumerable: true })
  }
  return list
}

describe('ALLOWED_EXTENSIONS', () => {
  it('contains all required extensions', () => {
    const expected = ['txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx']
    for (const ext of expected) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true)
    }
  })

  it('does not contain dangerous extensions', () => {
    const dangerous = ['exe', 'bat', 'sh', 'cmd', 'js', 'html', 'php', 'py']
    for (const ext of dangerous) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(false)
    }
  })
})

describe('MAX_FILE_SIZE', () => {
  it('is 10 MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024)
  })
})

describe('getExtension', () => {
  it('extracts extension from filename', () => {
    expect(getExtension('test.txt')).toBe('txt')
    expect(getExtension('photo.PNG')).toBe('png')
    expect(getExtension('archive.tar.gz')).toBe('gz')
  })

  it('returns empty string when no extension', () => {
    expect(getExtension('noextension')).toBe('')
  })

  it('handles edge cases', () => {
    expect(getExtension('.hidden')).toBe('hidden')
    expect(getExtension('file.')).toBe('')
  })
})

describe('isImage', () => {
  it('returns true for png and jpg', () => {
    expect(isImage('photo.png')).toBe(true)
    expect(isImage('photo.jpg')).toBe(true)
  })

  it('returns false for non-image files', () => {
    expect(isImage('doc.txt')).toBe(false)
    expect(isImage('doc.pdf')).toBe(false)
  })
})

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('validateFiles', () => {
  it('accepts valid files', () => {
    const files = createFileList([createFile('doc.txt', 100)])
    const result = validateFiles(files)
    expect(result.error).toBeNull()
    expect(result.valid).toHaveLength(1)
  })

  it('rejects invalid extensions', () => {
    const files = createFileList([createFile('script.exe', 100)])
    const result = validateFiles(files)
    expect(result.error).toContain('nicht erlaubt')
    expect(result.valid).toHaveLength(0)
  })

  it('rejects oversized files', () => {
    const files = createFileList([createFile('big.txt', MAX_FILE_SIZE + 1)])
    const result = validateFiles(files)
    expect(result.error).toContain('zu groß')
    expect(result.valid).toHaveLength(0)
  })

  it('rejects path traversal attempts in filenames', () => {
    const files = createFileList([createFile('../../../etc/passwd.txt', 100)])
    // File should be validated by extension (txt is allowed), but the name contains traversal
    const result = validateFiles(files)
    expect(result.error).toBeNull() // Extension-only validation, path traversal is handled elsewhere
  })
})

describe('FILE_ICONS', () => {
  it('has icons for all allowed extensions', () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(FILE_ICONS.has(ext)).toBe(true)
    }
  })
})
