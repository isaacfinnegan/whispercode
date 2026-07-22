import { describe, expect, test } from "bun:test"
import { isPromptInputV2VoiceSwipe, isPromptInputV2VoiceSwipeEnabled, type PromptInputV2SwipePoint } from "./swipe"

describe("isPromptInputV2VoiceSwipe", () => {
  const start: PromptInputV2SwipePoint = { x: 100, y: 100, time: 100 }

  test("accepts a fast left swipe", () => {
    expect(isPromptInputV2VoiceSwipe(start, { x: 40, y: 110, time: 250 })).toBe(true)
  })

  test.each([
    ["short", { x: 60, y: 100, time: 200 }],
    ["vertical", { x: 40, y: 130, time: 200 }],
    ["slow", { x: 40, y: 100, time: 400 }],
    ["rightward", { x: 160, y: 100, time: 200 }],
  ] as const)("rejects a %s gesture", (_name, end) => {
    expect(isPromptInputV2VoiceSwipe(start, end)).toBe(false)
  })
})

describe("isPromptInputV2VoiceSwipeEnabled", () => {
  const onVoiceSwipe = () => {}

  test("enables an editable prompt with a callback", () => {
    expect(isPromptInputV2VoiceSwipeEnabled({ onVoiceSwipe })).toBe(true)
  })

  test.each([
    ["disabled", { disabled: true, onVoiceSwipe }],
    ["read-only", { readOnly: true, onVoiceSwipe }],
    ["callback-free", {}],
  ] as const)("rejects a %s prompt", (_name, props) => {
    expect(isPromptInputV2VoiceSwipeEnabled(props)).toBe(false)
  })
})
