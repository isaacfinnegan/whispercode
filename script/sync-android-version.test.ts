import { expect, test } from "bun:test"
import { expectedAndroidVersion } from "./sync-android-version"

test("preserves the shared app version including its fork build suffix", () => {
  expect(expectedAndroidVersion("1.18.12-whispercode-371-20260804")).toBe("1.18.12-whispercode-371-20260804")
})

test("adds a fork suffix only for an upstream app version", () => {
  expect(expectedAndroidVersion("1.18.12", 371, "20260804")).toBe("1.18.12-whispercode-371-20260804")
})
