import { describe, expect, test } from "bun:test"
import type { VoiceState } from "@/context/platform"
import { promptInputV2VoiceAvailable, promptInputV2VoiceDisabled } from "./prompt-input-v2"

describe("promptInputV2VoiceAvailable", () => {
  test.each([
    ["ios", "normal", true, true],
    ["android", "normal", true, true],
    ["web", "normal", true, false],
    ["desktop", "normal", true, false],
    ["ios", "shell", true, false],
    ["android", "normal", false, false],
  ] as const)("%s/%s with bridge availability %s returns %s", (platform, mode, available, expected) => {
    expect(promptInputV2VoiceAvailable(platform, mode, available)).toBe(expected)
  })
})

describe("promptInputV2VoiceDisabled", () => {
  test.each([
    [undefined, false],
    ["ready", false],
    ["recording", true],
    ["processing", true],
  ] satisfies ReadonlyArray<readonly [VoiceState | undefined, boolean]>)(
    "voice state %s returns %s",
    (state, expected) => {
      expect(promptInputV2VoiceDisabled(state)).toBe(expected)
    },
  )
})
