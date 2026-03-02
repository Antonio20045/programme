import { describe, it, expect } from 'vitest'
import {
  pageVariants,
  pageTransition,
  sessionItemVariants,
  sessionItemTransition,
  staticVariants,
  messageVariants,
  messageTransition,
  staggerContainer,
  staggerItem,
  suggestionHover,
  expandVariants,
  expandTransition,
  overlayVariants,
  overlayTransition,
  paletteVariants,
  paletteTransition,
  notificationVariants,
  notificationTransition,
} from '../utils/motion'

describe('motion constants', () => {
  it('pageVariants has initial, animate, and exit keys', () => {
    expect(pageVariants).toHaveProperty('initial')
    expect(pageVariants).toHaveProperty('animate')
    expect(pageVariants).toHaveProperty('exit')
  })

  it('sessionItemVariants has initial, animate, and exit keys', () => {
    expect(sessionItemVariants).toHaveProperty('initial')
    expect(sessionItemVariants).toHaveProperty('animate')
    expect(sessionItemVariants).toHaveProperty('exit')
  })

  it('pageTransition has duration and ease', () => {
    expect(pageTransition).toHaveProperty('duration')
    expect(pageTransition).toHaveProperty('ease')
  })

  it('sessionItemTransition has duration and ease', () => {
    expect(sessionItemTransition).toHaveProperty('duration')
    expect(sessionItemTransition).toHaveProperty('ease')
  })

  it('staticVariants has empty initial, animate, and exit', () => {
    expect(staticVariants.initial).toEqual({})
    expect(staticVariants.animate).toEqual({})
    expect(staticVariants.exit).toEqual({})
  })

  it('all transition durations are at most 0.2s', () => {
    expect(pageTransition.duration).toBeLessThanOrEqual(0.2)
    expect(sessionItemTransition.duration).toBeLessThanOrEqual(0.2)
  })

  it('messageVariants has initial and animate (no exit)', () => {
    expect(messageVariants).toHaveProperty('initial')
    expect(messageVariants).toHaveProperty('animate')
    expect(messageVariants).not.toHaveProperty('exit')
  })

  it('messageTransition uses spring', () => {
    expect(messageTransition.type).toBe('spring')
  })

  it('staggerContainer orchestrates children', () => {
    const anim = staggerContainer.animate as Record<string, unknown>
    const t = anim.transition as Record<string, unknown>
    expect(t.staggerChildren).toBeGreaterThan(0)
  })

  it('staggerItem has initial and animate', () => {
    expect(staggerItem).toHaveProperty('initial')
    expect(staggerItem).toHaveProperty('animate')
  })

  it('suggestionHover has y and boxShadow', () => {
    expect(suggestionHover).toHaveProperty('y')
    expect(suggestionHover).toHaveProperty('boxShadow')
  })

  it('expandVariants has collapsed and expanded', () => {
    expect(expandVariants).toHaveProperty('collapsed')
    expect(expandVariants).toHaveProperty('expanded')
  })

  it('expandTransition has duration ≤ 0.3s', () => {
    expect(expandTransition.duration).toBeLessThanOrEqual(0.3)
  })

  it('overlayVariants has initial, animate, and exit keys', () => {
    expect(overlayVariants).toHaveProperty('initial')
    expect(overlayVariants).toHaveProperty('animate')
    expect(overlayVariants).toHaveProperty('exit')
  })

  it('overlayTransition has duration ≤ 0.2s', () => {
    expect(overlayTransition.duration).toBeLessThanOrEqual(0.2)
  })

  it('paletteVariants has initial, animate, and exit keys', () => {
    expect(paletteVariants).toHaveProperty('initial')
    expect(paletteVariants).toHaveProperty('animate')
    expect(paletteVariants).toHaveProperty('exit')
  })

  it('paletteVariants initial has scale < 1', () => {
    const initial = paletteVariants.initial as Record<string, number>
    expect(initial.scale).toBeLessThan(1)
  })

  it('paletteTransition uses spring', () => {
    expect(paletteTransition.type).toBe('spring')
  })

  it('notificationVariants has initial, animate, and exit keys', () => {
    expect(notificationVariants).toHaveProperty('initial')
    expect(notificationVariants).toHaveProperty('animate')
    expect(notificationVariants).toHaveProperty('exit')
  })

  it('notificationVariants initial has negative y', () => {
    const initial = notificationVariants.initial as Record<string, number>
    expect(initial.y).toBeLessThan(0)
  })

  it('notificationTransition has duration ≤ 0.3s', () => {
    expect(notificationTransition.duration).toBeLessThanOrEqual(0.3)
  })
})
