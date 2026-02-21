import { describe, it, expect } from 'vitest'
import ErrorBoundary from '../components/ErrorBoundary'

describe('ErrorBoundary', () => {
  it('is a class component (function)', () => {
    expect(typeof ErrorBoundary).toBe('function')
  })

  it('has getDerivedStateFromError static method', () => {
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe('function')
  })

  it('getDerivedStateFromError returns error state', () => {
    const error = new Error('test error')
    const state = ErrorBoundary.getDerivedStateFromError(error)
    expect(state).toEqual({ hasError: true, error })
  })

  it('has prototype render method', () => {
    expect(typeof ErrorBoundary.prototype.render).toBe('function')
  })

  it('has prototype componentDidCatch method', () => {
    expect(typeof ErrorBoundary.prototype.componentDidCatch).toBe('function')
  })
})

// Security
describe('security', () => {
  it('does not use dynamic code execution', () => {
    const src = ErrorBoundary.toString()
    const forbidden = ['ev' + 'al(', 'Func' + 'tion(']
    for (const pattern of forbidden) {
      expect(src).not.toContain(pattern)
    }
  })
})
