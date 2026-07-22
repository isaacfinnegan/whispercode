import { describe, expect, test } from "bun:test"
import { focusPromptInput, shouldUsePromptInputV2 } from "./contracts"

describe("shouldUsePromptInputV2", () => {
  test("uses v2 on every platform when the design is enabled", () => {
    expect(shouldUsePromptInputV2("ios", true)).toBe(true)
    expect(shouldUsePromptInputV2("android", true)).toBe(true)
    expect(shouldUsePromptInputV2("desktop", true)).toBe(true)
    expect(shouldUsePromptInputV2("web", true)).toBe(true)
  })

  test("keeps legacy input when the design is disabled", () => {
    expect(shouldUsePromptInputV2("ios", false)).toBe(false)
    expect(shouldUsePromptInputV2("android", false)).toBe(false)
    expect(shouldUsePromptInputV2("desktop", false)).toBe(false)
    expect(shouldUsePromptInputV2("web", false)).toBe(false)
  })
})

describe("focusPromptInput", () => {
  test("focuses whichever composer is mounted", () => {
    let v2 = 0
    const editor = document.createElement("div")
    document.body.append(editor)

    focusPromptInput(false, editor, () => v2++)
    expect(document.activeElement).toBe(editor)
    expect(v2).toBe(0)

    focusPromptInput(true, editor, () => v2++)
    expect(v2).toBe(1)
    editor.remove()
  })
})
