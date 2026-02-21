import { describe, it, expect } from 'vitest'
import Toast from '../components/Toast'

describe('Toast', () => {
  it('is a function component', () => {
    expect(typeof Toast).toBe('function')
  })

  it('returns null when show is false', () => {
    const result = Toast({ message: 'Test', show: false })
    expect(result).toBeNull()
  })

  it('renders message when show is true', () => {
    const result = Toast({ message: 'Gespeichert', show: true })
    expect(result).not.toBeNull()
    const json = JSON.stringify(result)
    expect(json).toContain('Gespeichert')
  })

  it('uses success styling by default', () => {
    const result = Toast({ message: 'OK', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('border-edge')
    expect(json).toContain('text-content-secondary')
  })

  it('uses error styling when type is error', () => {
    const result = Toast({ message: 'Fehler', type: 'error', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('border-error')
    expect(json).toContain('text-error')
  })

  it('has role="status" and aria-live', () => {
    const result = Toast({ message: 'Test', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('"role":"status"')
    expect(json).toContain('"aria-live":"polite"')
  })

  it('uses fixed positioning at bottom center', () => {
    const result = Toast({ message: 'Test', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('fixed')
    expect(json).toContain('bottom-6')
    expect(json).toContain('-translate-x-1/2')
  })

  it('uses animate-fade-in class', () => {
    const result = Toast({ message: 'Test', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-fade-in')
  })
})
