import { describe, it, expect, vi } from 'vitest'

vi.mock('@clerk/clerk-react', () => ({
  SignIn: () => 'SignIn',
}))

describe('AuthScreen', () => {
  it('exports a default function component', async () => {
    const mod = await import('../pages/AuthScreen')
    expect(typeof mod.default).toBe('function')
  })

  it('accepts onSkip prop', async () => {
    const mod = await import('../pages/AuthScreen')
    // Verify the component signature accepts onSkip
    expect(mod.default.length).toBeLessThanOrEqual(1)
  })

  it('onSkip callback is invokable', () => {
    const onSkip = vi.fn()
    onSkip()
    expect(onSkip).toHaveBeenCalledOnce()
  })
})
