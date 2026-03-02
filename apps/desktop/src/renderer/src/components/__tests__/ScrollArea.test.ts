import { describe, it, expect } from 'vitest'
import ScrollArea from '../ui/ScrollArea'

describe('ScrollArea', () => {
  it('is a function component', () => {
    expect(typeof ScrollArea).toBe('function')
  })

  it('renders with overflow and scrollbar-thin', () => {
    const result = ScrollArea({ children: 'Content' })
    const json = JSON.stringify(result)
    expect(json).toContain('overflow-y-auto')
    expect(json).toContain('scrollbar-thin')
    expect(json).toContain('Content')
  })

  it('merges custom className', () => {
    const result = ScrollArea({ className: 'h-64', children: 'Scroll' })
    const json = JSON.stringify(result)
    expect(json).toContain('h-64')
    expect(json).toContain('scrollbar-thin')
  })
})
