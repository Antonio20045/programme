import { describe, it, expect } from 'vitest'
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE, validateFiles } from '../components/FileDropZone'
import FileDropZone from '../components/FileDropZone'

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

describe('FileDropZone', () => {
  it('is a function component', () => {
    expect(typeof FileDropZone).toBe('function')
  })

  it('exports a default function named FileDropZone', () => {
    expect(FileDropZone.name).toBe('FileDropZone')
  })
})

describe('ALLOWED_EXTENSIONS', () => {
  it('contains all required extensions', () => {
    const expected = ['txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx']
    for (const ext of expected) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true)
    }
  })

  it('does not allow arbitrary extensions', () => {
    expect(ALLOWED_EXTENSIONS.has('exe')).toBe(false)
    expect(ALLOWED_EXTENSIONS.has('sh')).toBe(false)
    expect(ALLOWED_EXTENSIONS.has('js')).toBe(false)
    expect(ALLOWED_EXTENSIONS.has('html')).toBe(false)
  })
})

describe('MAX_FILE_SIZE', () => {
  it('is 10 MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024)
  })
})

describe('validateFiles', () => {
  it('accepts valid files', () => {
    const files = createFileList([
      createFile('readme.txt', 100),
      createFile('data.json', 200),
    ])
    const { valid, error } = validateFiles(files)
    expect(error).toBeNull()
    expect(valid).toHaveLength(2)
  })

  it('rejects files with disallowed extensions', () => {
    const files = createFileList([createFile('script.exe', 100)])
    const { valid, error } = validateFiles(files)
    expect(error).toContain('Dateityp nicht erlaubt')
    expect(error).toContain('script.exe')
    expect(valid).toHaveLength(0)
  })

  it('rejects files larger than 10 MB', () => {
    const files = createFileList([createFile('big.pdf', MAX_FILE_SIZE + 1)])
    const { valid, error } = validateFiles(files)
    expect(error).toContain('Datei zu groß')
    expect(error).toContain('big.pdf')
    expect(valid).toHaveLength(0)
  })

  it('accepts files exactly at the 10 MB limit', () => {
    const files = createFileList([createFile('exact.pdf', MAX_FILE_SIZE)])
    const { valid, error } = validateFiles(files)
    expect(error).toBeNull()
    expect(valid).toHaveLength(1)
  })

  it('rejects mixed files when one has bad extension', () => {
    const files = createFileList([
      createFile('ok.txt', 100),
      createFile('bad.exe', 100),
    ])
    const { valid, error } = validateFiles(files)
    expect(error).toContain('bad.exe')
    expect(valid).toHaveLength(0)
  })

  it('rejects mixed files when one exceeds size limit', () => {
    const files = createFileList([
      createFile('ok.txt', 100),
      createFile('huge.pdf', MAX_FILE_SIZE + 1),
    ])
    const { valid, error } = validateFiles(files)
    expect(error).toContain('huge.pdf')
    expect(valid).toHaveLength(0)
  })

  it('accepts all allowed extensions', () => {
    const allExtensions = ['txt', 'pdf', 'md', 'csv', 'json', 'png', 'jpg', 'docx']
    for (const ext of allExtensions) {
      const files = createFileList([createFile(`test.${ext}`, 100)])
      const { valid, error } = validateFiles(files)
      expect(error).toBeNull()
      expect(valid).toHaveLength(1)
    }
  })

  it('handles files without extension', () => {
    const files = createFileList([createFile('noext', 100)])
    const { valid, error } = validateFiles(files)
    expect(error).toContain('Dateityp nicht erlaubt')
    expect(valid).toHaveLength(0)
  })
})
