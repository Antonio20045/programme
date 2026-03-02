import { describe, it, expect } from 'vitest'
import { cn } from '../utils/cn'

describe('cn', () => {
  it('is a function', () => {
    expect(typeof cn).toBe('function')
  })

  it('merges multiple class strings', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1')
  })

  it('resolves Tailwind conflicts (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles conditional classes via clsx', () => {
    expect(cn('base', false && 'hidden', 'end')).toBe('base end')
  })

  it('handles object syntax', () => {
    expect(cn({ 'text-red-500': true, 'text-blue-500': false })).toBe('text-red-500')
  })

  it('handles array syntax', () => {
    expect(cn(['px-2', 'py-1'])).toBe('px-2 py-1')
  })

  it('removes duplicate classes', () => {
    expect(cn('px-2', 'px-2')).toBe('px-2')
  })

  it('passes through custom utility classes', () => {
    expect(cn('glass', 'glow-accent')).toBe('glass glow-accent')
  })

  it('returns empty string for no input', () => {
    expect(cn()).toBe('')
  })

  it('handles undefined and null values', () => {
    expect(cn('px-2', undefined, null, 'py-1')).toBe('px-2 py-1')
  })
})
