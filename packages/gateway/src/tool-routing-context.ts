/**
 * Tool Routing Context — AsyncLocalStorage bridge between in-app.ts and tool-router.ts.
 *
 * in-app.ts sets the context (userId from Clerk JWT + sessionId) via withToolRouting().
 * tool-router.ts reads it via getToolRoutingContext() as a fallback when the execute
 * wrapper in createConfirmableTools doesn't have userId/sessionId from its closure.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface ToolRoutingContext {
  readonly sessionId: string
  readonly userId: string
}

const store = new AsyncLocalStorage<ToolRoutingContext>()

export function withToolRouting<T>(ctx: ToolRoutingContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn)
}

export function getToolRoutingContext(): ToolRoutingContext | undefined {
  return store.getStore()
}
