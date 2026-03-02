import { describe, it, expect } from 'vitest'
import Badge from '../ui/Badge'

describe('Badge', () => {
  it('is a function component', () => {
    expect(typeof Badge).toBe('function')
  })

  it('renders with default variant', () => {
    const result = Badge({ children: 'Tag' })
    const json = JSON.stringify(result)
    expect(json).toContain('Tag')
    expect(json).toContain('text-content-secondary')
    expect(json).toContain('rounded-md')
    expect(json).toContain('text-xs')
    expect(json).toContain('font-medium')
  })

  it('renders success variant', () => {
    const result = Badge({ variant: 'success', children: 'OK' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-success')
  })

  it('renders warning variant', () => {
    const result = Badge({ variant: 'warning', children: 'Warn' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-warning')
  })

  it('renders error variant', () => {
    const result = Badge({ variant: 'error', children: 'Err' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-error')
  })

  it('renders accent variant', () => {
    const result = Badge({ variant: 'accent', children: 'New' })
    const json = JSON.stringify(result)
    expect(json).toContain('text-accent-text')
    expect(json).toContain('bg-accent-muted')
  })

  it('merges custom className', () => {
    const result = Badge({ className: 'ml-2', children: 'Extra' })
    const json = JSON.stringify(result)
    expect(json).toContain('ml-2')
  })
})
