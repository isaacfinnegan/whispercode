import { expect, test } from "bun:test"
import {
  createLegacyPushOperation,
  legacyPushEnabled,
  restoreDefaultPushRelay,
  settleLegacyPushOperation,
} from "./push-relay"
import { DEFAULT_PUSH_RELAY_URL } from "@/utils/push-relay-url"

test("legacy push providers are active by default and passive when explicitly disabled", () => {
  expect(legacyPushEnabled(undefined)).toBe(true)
  expect(legacyPushEnabled(true)).toBe(true)
  expect(legacyPushEnabled(false)).toBe(false)
})

test("legacy operation completion becomes stale after passive transition", () => {
  let enabled = true
  const operation = createLegacyPushOperation(() => enabled)
  const first = operation.begin()
  expect(first()).toBe(true)

  enabled = false
  operation.cancel()
  expect(first()).toBe(false)

  enabled = true
  const second = operation.begin()
  expect(first()).toBe(false)
  expect(second()).toBe(true)
})

test("stale native completion performs caught compensating cleanup", async () => {
  let enabled = true
  let clears = 0
  let discards = 0
  const operation = createLegacyPushOperation(() => enabled)
  const active = operation.begin()
  enabled = false
  operation.cancel()

  expect(
    await settleLegacyPushOperation(
      active,
      async () => {
        clears++
        throw new Error("cleanup failed")
      },
      () => {
        discards++
      },
    ),
  ).toBe(false)
  expect(clears).toBe(1)
  expect(discards).toBe(1)
})

test("stale relay completion restores the default relay and clears pairing", async () => {
  let enabled = true
  let release!: () => void
  const calls: string[] = []
  const operation = createLegacyPushOperation(() => enabled)
  const active = operation.begin()
  const write = new Promise<void>((resolve) => (release = resolve))
  const completion = write.then(() =>
    settleLegacyPushOperation(active, () =>
      restoreDefaultPushRelay(
        async (url) => {
          calls.push(url)
          throw new Error("relay restore failed")
        },
        async () => {
          calls.push("clear")
          throw new Error("pair clear failed")
        },
      ),
    ),
  )

  enabled = false
  operation.cancel()
  release()

  expect(await completion).toBe(false)
  expect(calls).toEqual([DEFAULT_PUSH_RELAY_URL, "clear"])
})
