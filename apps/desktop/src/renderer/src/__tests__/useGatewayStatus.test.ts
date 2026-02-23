import { describe, it, expect } from 'vitest'

// Implementation tests are in GatewayStatusContext.test.ts
// This file verifies the re-export from hooks/ still works

describe('useGatewayStatus (re-export)', () => {
  it('re-exports useGatewayStatus from GatewayStatusContext', async () => {
    const hookModule = await import('../hooks/useGatewayStatus')
    const contextModule = await import('../contexts/GatewayStatusContext')

    expect(hookModule.useGatewayStatus).toBe(contextModule.useGatewayStatus)
  })
})
