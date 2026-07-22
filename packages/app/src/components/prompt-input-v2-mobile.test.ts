import { describe, expect, test } from "bun:test"
import type { VoiceStartResult, VoiceState } from "@/context/platform"
import {
  createPromptInputV2VoiceStart,
  promptInputV2VoiceAvailable,
  promptInputV2VoiceDisabled,
} from "./prompt-input-v2-mobile"

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
    [undefined, false, false],
    ["ready", false, false],
    ["recording", false, true],
    ["processing", false, true],
    ["ready", true, true],
  ] satisfies ReadonlyArray<readonly [VoiceState | undefined, boolean, boolean]>)(
    "voice state %s with pending %s returns %s",
    (state, pending, expected) => {
      expect(promptInputV2VoiceDisabled(state, pending)).toBe(expected)
    },
  )
})

describe("createPromptInputV2VoiceStart", () => {
  test("does not start while disabled", async () => {
    let starts = 0
    const pending: boolean[] = []
    const startVoice = createPromptInputV2VoiceStart({
      disabled: () => true,
      start: () => {
        starts++
        return { ok: true }
      },
      onStart: () => {},
      onPending: (value) => pending.push(value),
      onFailure: () => {},
    })

    startVoice()
    await Promise.resolve()

    expect(starts).toBe(0)
    expect(pending).toEqual([])
  })

  test("coalesces starts while the first call is unresolved", async () => {
    let resolveStart!: (value: VoiceStartResult) => void
    let resolveSettled!: () => void
    const result = new Promise<VoiceStartResult>((resolve) => (resolveStart = resolve))
    const settled = new Promise<void>((resolve) => (resolveSettled = resolve))
    const pending: boolean[] = []
    let starts = 0
    let haptics = 0
    const startVoice = createPromptInputV2VoiceStart({
      disabled: () => false,
      start: () => {
        starts++
        return result
      },
      onStart: () => haptics++,
      onPending: (value) => {
        pending.push(value)
        if (!value) resolveSettled()
      },
      onFailure: () => {},
    })

    startVoice()
    startVoice()
    await Promise.resolve()

    expect(starts).toBe(1)
    expect(haptics).toBe(1)
    expect(pending).toEqual([true])

    resolveStart({ ok: true })
    await settled

    expect(pending).toEqual([true, false])
  })

  test.each([
    [() => ({ ok: false, message: "Permission denied" }), "Permission denied"],
    [() => Promise.reject(new Error("Bridge unavailable")), "Bridge unavailable"],
  ] satisfies ReadonlyArray<readonly [() => VoiceStartResult | Promise<VoiceStartResult>, string]>)(
    "reports unsuccessful and rejected starts",
    async (start, message) => {
      let resolveSettled!: () => void
      const settled = new Promise<void>((resolve) => (resolveSettled = resolve))
      const failures: string[] = []
      const startVoice = createPromptInputV2VoiceStart({
        disabled: () => false,
        start,
        onStart: () => {},
        onPending: (value) => {
          if (!value) resolveSettled()
        },
        onFailure: (failure) => failures.push(failure),
      })

      startVoice()
      await settled

      expect(failures).toEqual([message])
    },
  )
})
