import { describe, it, expect } from 'vitest'
import Chat from '../pages/Chat'

describe('Chat', () => {
  it('is a function component', () => {
    expect(typeof Chat).toBe('function')
  })

  it('exports a default function named Chat', () => {
    expect(Chat.name).toBe('Chat')
  })
})
