import { describe, it, expect } from 'vitest'
import AttachmentButton from '../components/AttachmentButton'

describe('AttachmentButton', () => {
  it('is a function component', () => {
    expect(typeof AttachmentButton).toBe('function')
  })

  it('exports a default function named AttachmentButton', () => {
    expect(AttachmentButton.name).toBe('AttachmentButton')
  })
})
