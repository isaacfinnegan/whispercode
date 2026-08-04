import { describe, expect, test } from "bun:test"
import { sendPushTest } from "./push-test"

describe("push test", () => {
  test("uses the optional native test path", async () => {
    const calls: Array<string | undefined> = []
    const ok = await sendPushTest({
      platform: {
        testPush: async (href) => {
          calls.push(href)
          return true
        },
      },
      href: "/session/one",
    })

    expect(ok).toBe(true)
    expect(calls).toEqual(["/session/one"])
  })

  test("returns false when native test push is unavailable", async () => {
    await expect(sendPushTest({ platform: {} })).resolves.toBe(false)
  })
})
