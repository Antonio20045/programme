import { describe, it, expect, vi } from 'vitest'

// Mock framer-motion — motion.button renders as a regular button
vi.mock('framer-motion', () => ({
  motion: {
    button: (props: Record<string, unknown>) => ({ type: 'button', props }),
  },
}))

// Mock useReducedMotion
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}))

import Button from '../ui/Button'

describe('Button', () => {
  it('is a function component', () => {
    expect(typeof Button).toBe('function')
  })

  it('renders with primary variant by default', () => {
    const result = Button({ children: 'Click' })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-accent')
    expect(json).toContain('Click')
  })

  it('renders ghost variant', () => {
    const result = Button({ variant: 'ghost', children: 'Ghost' })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-transparent')
    expect(json).toContain('Ghost')
  })

  it('renders danger variant', () => {
    const result = Button({ variant: 'danger', children: 'Delete' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-error')
    expect(json).toContain('Delete')
  })

  it('renders sm size', () => {
    const result = Button({ size: 'sm', children: 'Small' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-xs')
  })

  it('renders md size by default', () => {
    const result = Button({ children: 'Medium' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-sm')
  })

  it('defaults type to button', () => {
    const result = Button({ children: 'Click' })
    const json = JSON.stringify(result)
    expect(json).toContain('"type":"button"')
  })

  it('applies disabled styling', () => {
    const result = Button({ disabled: true, children: 'Off' })
    const json = JSON.stringify(result)
    expect(json).toContain('opacity-50')
    expect(json).toContain('cursor-not-allowed')
  })

  it('merges custom className', () => {
    const result = Button({ className: 'mt-4', children: 'Styled' })
    const json = JSON.stringify(result)
    expect(json).toContain('mt-4')
  })

  it('has whileTap animation', () => {
    const result = Button({ children: 'Tap' })
    const json = JSON.stringify(result)
    expect(json).toContain('whileTap')
    expect(json).toContain('0.97')
  })

  it('disables whileTap when disabled', () => {
    const result = Button({ disabled: true, children: 'Off' })
    const json = JSON.stringify(result)
    // whileTap should not have the scale value
    expect(json).not.toContain('0.97')
  })

  it('renders success variant', () => {
    const result = Button({ variant: 'success', children: 'Done' })
    const json = JSON.stringify(result)
    expect(json).toContain('bg-success')
  })
})
