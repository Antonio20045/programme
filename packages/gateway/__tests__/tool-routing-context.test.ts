import { describe, expect, it } from "vitest"
import { withToolRouting, getToolRoutingContext } from "../src/tool-routing-context.js"

describe("withToolRouting", () => {
  it("provides context inside the callback", async () => {
    const ctx = { sessionId: "sess-1", userId: "user-1" }
    let captured: ReturnType<typeof getToolRoutingContext>

    await withToolRouting(ctx, async () => {
      captured = getToolRoutingContext()
    })

    expect(captured!).toEqual(ctx)
  })

  it("returns undefined outside of a routing context", () => {
    expect(getToolRoutingContext()).toBeUndefined()
  })

  it("propagates the return value of the callback", async () => {
    const result = await withToolRouting(
      { sessionId: "s", userId: "u" },
      async () => 42,
    )
    expect(result).toBe(42)
  })

  it("nests correctly — inner context wins", async () => {
    const outer = { sessionId: "outer-sess", userId: "outer-user" }
    const inner = { sessionId: "inner-sess", userId: "inner-user" }

    await withToolRouting(outer, async () => {
      expect(getToolRoutingContext()).toEqual(outer)

      await withToolRouting(inner, async () => {
        expect(getToolRoutingContext()).toEqual(inner)
      })

      // Outer restored after inner exits
      expect(getToolRoutingContext()).toEqual(outer)
    })
  })

  it("propagates errors from the callback", async () => {
    await expect(
      withToolRouting({ sessionId: "s", userId: "u" }, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    // Context is cleaned up after error
    expect(getToolRoutingContext()).toBeUndefined()
  })
})
