import { describe, it, expect } from 'vitest'
import {
  TOOL_ICONS,
  TOOL_ICON_FALLBACK,
  PREVIEW_TYPE_ICONS,
  PREVIEW_TYPE_ICON_FALLBACK,
} from '../utils/tool-icons'

describe('TOOL_ICONS', () => {
  it('has icons for all common tools', () => {
    const expected = [
      'web-search', 'filesystem', 'shell', 'browser', 'gmail',
      'calendar', 'reminders', 'notes', 'calculator', 'clipboard',
      'screenshot', 'image-gen', 'git-tools', 'code-runner',
      'translator', 'weather', 'http-client',
    ]
    for (const tool of expected) {
      expect(TOOL_ICONS.get(tool), `missing icon for ${tool}`).toBeDefined()
    }
  })

  it('returns undefined for unknown tools', () => {
    expect(TOOL_ICONS.get('unknown-tool')).toBeUndefined()
  })

  it('has a fallback constant', () => {
    expect(TOOL_ICON_FALLBACK).toBe('\u{1F527}')
  })
})

describe('PREVIEW_TYPE_ICONS', () => {
  it('has icons for all preview types', () => {
    const expected = ['email', 'calendar', 'shell', 'filesystem', 'notes', 'oauth_connect', 'generic']
    for (const type of expected) {
      expect(PREVIEW_TYPE_ICONS.get(type), `missing icon for ${type}`).toBeDefined()
    }
  })

  it('returns undefined for unknown types', () => {
    expect(PREVIEW_TYPE_ICONS.get('unknown')).toBeUndefined()
  })

  it('has a fallback constant', () => {
    expect(PREVIEW_TYPE_ICON_FALLBACK).toBe('\u2699')
  })
})
