import { describe, it, expect } from 'vitest'
import StreamingCursor from '../components/StreamingCursor'

describe('StreamingCursor', () => {
  it('is a function component', () => {
    expect(typeof StreamingCursor).toBe('function')
  })

  it('renders a span element', () => {
    const result = StreamingCursor()
    expect(result.type).toBe('span')
  })

  it('has cursor-blink animation', () => {
    const result = StreamingCursor()
    expect(result.props.className).toContain('animate-cursor-blink')
  })

  it('uses accent color', () => {
    const result = StreamingCursor()
    expect(result.props.className).toContain('bg-accent')
  })

  it('is hidden from screen readers', () => {
    const result = StreamingCursor()
    expect(result.props['aria-hidden']).toBe('true')
  })
})
