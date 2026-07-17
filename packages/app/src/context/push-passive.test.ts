import { expect, test } from "bun:test"
import { createLegacyPushOperation, legacyPushEnabled } from "./push-relay"

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
