import { describe, expect, test } from "bun:test"
import type { VoiceStartResult, VoiceState } from "@/context/platform"
import {
  createPromptInputV2AppendTranscription,
  createPromptInputV2TranscriptionOwner,
  createPromptInputV2TranscriptionHandler,
  createPromptInputV2VoiceStart,
  createPromptInputV2VoiceStateObserver,
  promptInputV2VoiceAvailable,
  promptInputV2VoiceDisabled,
} from "./prompt-input-v2-mobile"
import type { Prompt } from "@/context/prompt"

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

describe("createPromptInputV2TranscriptionHandler", () => {
  test("only the composer that successfully started recording consumes the final transcription", async () => {
    const firstValues: string[] = []
    const secondValues: string[] = []
    const first = createPromptInputV2TranscriptionOwner()
    const second = createPromptInputV2TranscriptionOwner()
    const firstHandle = createPromptInputV2TranscriptionHandler((text) => firstValues.push(text), first)
    const secondHandle = createPromptInputV2TranscriptionHandler((text) => secondValues.push(text), second)
    const startVoice = createPromptInputV2VoiceStart({
      disabled: () => false,
      acquire: first.claim,
      release: first.release,
      start: () => ({ ok: true }),
      onStart: () => {},
      onPending: () => {},
      onFailure: () => {},
    })

    startVoice()
    await Promise.resolve()
    await Promise.resolve()

    const event = new CustomEvent("opencode:transcription", { detail: { text: "private draft", isFinal: true } })
    secondHandle(event)
    firstHandle(event)

    expect(firstValues).toEqual(["private draft"])
    expect(secondValues).toEqual([])
    expect(first.owns()).toBe(false)
  })

  test("does not deliver a released recording to either its old or a newly mounted composer", () => {
    const oldValues: string[] = []
    const newValues: string[] = []
    const oldOwner = createPromptInputV2TranscriptionOwner()
    oldOwner.claim()
    const oldHandle = createPromptInputV2TranscriptionHandler((text) => oldValues.push(text), oldOwner)
    oldOwner.dispose()
    const newOwner = createPromptInputV2TranscriptionOwner()
    const newHandle = createPromptInputV2TranscriptionHandler((text) => newValues.push(text), newOwner)

    const event = new CustomEvent("opencode:transcription", { detail: { text: "private draft", isFinal: true } })
    oldHandle(event)
    newHandle(event)

    expect(oldValues).toEqual([])
    expect(newValues).toEqual([])
  })

  test("ignores absent and interim transcription while retaining ownership for the final event", () => {
    const values: string[] = []
    const owner = createPromptInputV2TranscriptionOwner()
    owner.claim()
    const handle = createPromptInputV2TranscriptionHandler((text) => values.push(text), owner)

    handle(new CustomEvent("opencode:transcription", { detail: { isFinal: true } }))
    handle(new CustomEvent("opencode:transcription", { detail: { text: "draft", isFinal: false } }))
    handle(new Event("opencode:transcription"))

    expect(values).toEqual([])
    expect(owner.owns()).toBe(true)

    handle(new CustomEvent("opencode:transcription", { detail: { text: "final", isFinal: true } }))

    expect(values).toEqual(["final"])
    expect(owner.owns()).toBe(false)
  })
})

describe("createPromptInputV2VoiceStateObserver", () => {
  test("releases an active recording after ready when no final transcription arrives", () => {
    const owner = createPromptInputV2TranscriptionOwner()
    const queued: Array<() => void> = []
    owner.claim()
    const observe = createPromptInputV2VoiceStateObserver(owner, (task) => queued.push(task))

    observe("recording")
    observe("processing")
    observe("ready")

    expect(owner.owns()).toBe(true)
    expect(queued).toHaveLength(1)

    queued[0]?.()

    expect(owner.owns()).toBe(false)
  })

  test("lets a synchronous final transcription consume ownership before deferred ready cleanup", () => {
    const values: string[] = []
    const owner = createPromptInputV2TranscriptionOwner()
    const queued: Array<() => void> = []
    owner.claim()
    const observe = createPromptInputV2VoiceStateObserver(owner, (task) => queued.push(task))
    const handle = createPromptInputV2TranscriptionHandler((text) => values.push(text), owner)

    observe("recording")
    observe("ready")

    expect(queued).toHaveLength(1)

    handle(new CustomEvent("opencode:transcription", { detail: { text: "final", isFinal: true } }))

    expect(values).toEqual(["final"])
    expect(owner.owns()).toBe(false)

    queued[0]?.()

    expect(values).toEqual(["final"])
  })

  test("releases ownership immediately on error", () => {
    const owner = createPromptInputV2TranscriptionOwner()
    const queued: Array<() => void> = []
    owner.claim()
    const observe = createPromptInputV2VoiceStateObserver(owner, (task) => queued.push(task))

    observe("recording")
    observe("error")

    expect(owner.owns()).toBe(false)
    expect(queued).toEqual([])
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
      acquire: () => true,
      release: () => {},
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

  test("reserves the global recorder before simultaneous composers can start", async () => {
    const first = createPromptInputV2TranscriptionOwner()
    const second = createPromptInputV2TranscriptionOwner()
    const starts: string[] = []
    const createStart = (name: string, owner: typeof first) =>
      createPromptInputV2VoiceStart({
        disabled: () => false,
        acquire: owner.claim,
        release: owner.release,
        start: () => {
          starts.push(name)
          return { ok: true }
        },
        onStart: () => {},
        onPending: () => {},
        onFailure: () => {},
      })

    const startFirst = createStart("first", first)
    const startSecond = createStart("second", second)
    startFirst()
    startSecond()

    expect(first.owns()).toBe(true)
    expect(second.owns()).toBe(false)

    await Promise.resolve()
    await Promise.resolve()

    expect(starts).toEqual(["first"])
    expect(first.owns()).toBe(true)
    first.release()
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
      acquire: () => true,
      release: () => {},
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
      const owner = createPromptInputV2TranscriptionOwner()
      const startVoice = createPromptInputV2VoiceStart({
        disabled: () => false,
        acquire: owner.claim,
        release: owner.release,
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
      expect(owner.owns()).toBe(false)
    },
  )
})
