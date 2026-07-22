import { describe, expect, test } from "bun:test"
import { promptInputV2Cursor } from "@opencode-ai/session-ui/v2/prompt-input/cursor"
import type { VoiceStartResult, VoiceState } from "@/context/platform"
import {
  createPromptInputV2AppendTranscription,
  createPromptInputV2DeleteWord,
  createPromptInputV2TranscriptionHandler,
  createPromptInputV2VoiceStart,
  promptInputV2VoiceAvailable,
  promptInputV2VoiceDisabled,
} from "./prompt-input-v2-mobile"
import type { Prompt } from "@/context/prompt"
import { getCursorPosition, getEditorText, setCursorPosition } from "./prompt-input/editor-dom"

describe("createPromptInputV2AppendTranscription", () => {
  test("trims final text, updates the prompt and cursor, then queues scrolling", () => {
    let prompt: Prompt = [{ type: "agent", name: "reviewer", content: "@reviewer", start: 5, end: 14 }]
    const updates: Array<{ prompt: Prompt; cursor: number }> = []
    const scrolls: ScrollToOptions[] = []
    let scroll: (() => void) | undefined
    const editor = {
      scrollHeight: 240,
      scrollTo: (options: ScrollToOptions) => scrolls.push(options),
    }
    const append = createPromptInputV2AppendTranscription({
      current: () => prompt,
      set: (next, cursor) => {
        prompt = next
        updates.push({ prompt: next, cursor })
      },
      editor: () => editor,
      queueScroll: (task) => (scroll = task),
    })

    append("  hello  ")
    scroll?.()

    expect(updates).toEqual([
      {
        prompt: [
          { type: "agent", name: "reviewer", content: "@reviewer", start: 0, end: 9 },
          { type: "text", content: "hello", start: 9, end: 14 },
        ],
        cursor: 14,
      },
    ])
    expect(scrolls).toEqual([{ top: 240 }])
  })

  test("ignores blank text", () => {
    let updates = 0
    let scrolls = 0
    const append = createPromptInputV2AppendTranscription({
      current: () => [],
      set: () => updates++,
      editor: () => undefined,
      queueScroll: () => scrolls++,
    })

    append("   ")

    expect(updates).toBe(0)
    expect(scrolls).toBe(0)
  })
})

describe("createPromptInputV2DeleteWord", () => {
  test("deletes the previous word and dispatches a bubbling input event", () => {
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.textContent = "alpha beta"
    document.body.appendChild(editor)
    editor.focus()
    setCursorPosition(editor, 10)
    const events: InputEvent[] = []
    editor.addEventListener("input", (event) => events.push(event as InputEvent))
    const deleteWord = createPromptInputV2DeleteWord({ editor: () => editor })

    deleteWord()

    expect(getEditorText(editor)).toBe("alpha")
    expect(getCursorPosition(editor)).toBe(5)
    expect(events).toHaveLength(1)
    expect(events[0]?.inputType).toBe("deleteWordBackward")
    expect(events[0]?.bubbles).toBe(true)

    editor.remove()
  })

  test("reconciles the editor cursor after a preceding break", () => {
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.append("foo", document.createElement("br"), "bar baz")
    document.body.appendChild(editor)
    editor.focus()
    setCursorPosition(editor, 11)
    let cursor: number | undefined
    editor.addEventListener("input", () => (cursor = promptInputV2Cursor(editor)))
    const deleteWord = createPromptInputV2DeleteWord({ editor: () => editor })

    deleteWord()

    expect(getEditorText(editor)).toBe("foo\nbar")
    expect(cursor).toBe(7)

    editor.remove()
  })

  test("deletes when the current selection anchor is inside an unfocused editor", () => {
    const editor = document.createElement("div")
    editor.textContent = "alpha beta"
    const button = document.createElement("button")
    document.body.append(editor, button)
    button.focus()
    setCursorPosition(editor, 10)
    const deleteWord = createPromptInputV2DeleteWord({ editor: () => editor })

    deleteWord()

    expect(getEditorText(editor)).toBe("alpha")

    editor.remove()
    button.remove()
  })

  test("does nothing without an active editor or contained selection", () => {
    const editor = document.createElement("div")
    editor.textContent = "alpha beta"
    document.body.appendChild(editor)
    const deleteWord = createPromptInputV2DeleteWord({ editor: () => editor })

    deleteWord()

    expect(getEditorText(editor)).toBe("alpha beta")

    editor.remove()
  })
})

describe("createPromptInputV2TranscriptionHandler", () => {
  test("dispatches final transcription text", () => {
    const values: string[] = []
    const handle = createPromptInputV2TranscriptionHandler((text) => values.push(text))

    handle(new CustomEvent("opencode:transcription", { detail: { text: "hello", isFinal: true } }))

    expect(values).toEqual(["hello"])
  })

  test("ignores absent text and interim transcription", () => {
    const values: string[] = []
    const handle = createPromptInputV2TranscriptionHandler((text) => values.push(text))

    handle(new CustomEvent("opencode:transcription", { detail: { isFinal: true } }))
    handle(new CustomEvent("opencode:transcription", { detail: { text: "draft", isFinal: false } }))
    handle(new Event("opencode:transcription"))

    expect(values).toEqual([])
  })
})

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
