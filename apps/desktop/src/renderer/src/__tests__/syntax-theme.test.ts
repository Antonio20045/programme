import { describe, it, expect } from 'vitest'
import warmDark from '../utils/syntax-theme'

describe('warmDark syntax theme', () => {
  it('is not empty', () => {
    expect(Object.keys(warmDark).length).toBeGreaterThan(0)
  })

  it('has base selectors', () => {
    expect(warmDark['code[class*="language-"]']).toBeDefined()
    expect(warmDark['pre[class*="language-"]']).toBeDefined()
  })

  it('background is #1c1c24 (not oneDark default #282c34)', () => {
    const pre = warmDark['pre[class*="language-"]']!
    expect(pre.background).toBe('#1c1c24')
    expect(pre.background).not.toBe('#282c34')
  })

  it('base text color is #ececf0', () => {
    const code = warmDark['code[class*="language-"]']!
    expect(code.color).toBe('#ececf0')
  })

  it('has core token keys', () => {
    const requiredTokens = [
      'keyword',
      'string',
      'comment',
      'function',
      'number',
      'boolean',
      'operator',
      'punctuation',
      'property',
      'variable',
    ]
    for (const token of requiredTokens) {
      expect(warmDark[token], `missing token: ${token}`).toBeDefined()
    }
  })

  it('comment is italic', () => {
    expect(warmDark['comment']!.fontStyle).toBe('italic')
  })

  it('keyword color is #F0B060', () => {
    expect(warmDark['keyword']!.color).toBe('#F0B060')
  })

  it('string color is #3ecf8e', () => {
    expect(warmDark['string']!.color).toBe('#3ecf8e')
  })

  it('comment color is #6c6c80', () => {
    expect(warmDark['comment']!.color).toBe('#6c6c80')
  })
})
