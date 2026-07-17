import { expect, test } from "bun:test"
import { legacyPushEnabled } from "./push-relay"

test("legacy push providers are active by default and passive when explicitly disabled", () => {
  expect(legacyPushEnabled(undefined)).toBe(true)
  expect(legacyPushEnabled(true)).toBe(true)
  expect(legacyPushEnabled(false)).toBe(false)
})
