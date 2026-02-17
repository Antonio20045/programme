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
    expect(json).toContain('border-gray-700')
    expect(json).toContain('text-gray-300')
  })

  it('uses error styling when type is error', () => {
    const result = Toast({ message: 'Fehler', type: 'error', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('border-red-700')
    expect(json).toContain('text-red-300')
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
    expect(json).toContain('bottom-8')
    expect(json).toContain('-translate-x-1/2')
  })

  it('uses animate-fade-in class', () => {
    const result = Toast({ message: 'Test', show: true })
    const json = JSON.stringify(result)
    expect(json).toContain('animate-fade-in')
  })
})
