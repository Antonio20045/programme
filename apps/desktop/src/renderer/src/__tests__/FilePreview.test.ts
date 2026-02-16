import { describe, it, expect } from 'vitest'
import FilePreview, { formatSize, getExtension, isImage } from '../components/FilePreview'

describe('FilePreview', () => {
  it('is a function component', () => {
    expect(typeof FilePreview).toBe('function')
  })

  it('exports a default function named FilePreview', () => {
    expect(FilePreview.name).toBe('FilePreview')
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

  it('formats exactly 1 KB', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
  })

  it('formats exactly 1 MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
  })
})

describe('getExtension', () => {
  it('extracts extension from filename', () => {
    expect(getExtension('file.txt')).toBe('txt')
  })

  it('returns lowercase extension', () => {
    expect(getExtension('FILE.PDF')).toBe('pdf')
  })

  it('returns empty string for files without extension', () => {
    expect(getExtension('noext')).toBe('')
  })

  it('returns last extension for multiple dots', () => {
    expect(getExtension('archive.tar.gz')).toBe('gz')
  })
})

describe('isImage', () => {
  it('returns true for .png', () => {
    expect(isImage('photo.png')).toBe(true)
  })

  it('returns true for .jpg', () => {
    expect(isImage('photo.jpg')).toBe(true)
  })

  it('returns false for .txt', () => {
    expect(isImage('readme.txt')).toBe(false)
  })

  it('returns false for .pdf', () => {
    expect(isImage('doc.pdf')).toBe(false)
  })
})
