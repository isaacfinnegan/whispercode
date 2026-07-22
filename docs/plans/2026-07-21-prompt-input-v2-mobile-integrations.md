# Prompt Input V2 Mobile Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WhisperCode's Android and iOS voice, transcription, native keyboard, focus, and keyboard-dismissal integrations to Prompt Input V2, then enable V2 on native mobile.

**Architecture:** Keep `@opencode-ai/session-ui` platform-neutral. It will expose optional voice UI, swipe, and focus-policy hooks; `packages/app` will adapt `Platform`, browser bridge events, and prompt state into those hooks. The existing `shouldUsePromptInputV2` native exclusion remains in place until all parity behavior and tests are complete, then changes in the final rollout task.

**Tech Stack:** SolidJS, TypeScript, Bun 1.3.10, Happy DOM unit tests, Playwright production benchmarks, Android Tauri/Kotlin bridge, iOS Swift/WebKit bridge.

---

## Preconditions

- Complete and verify the in-progress OpenCode 1.18.4 merge before starting this plan.
- Execute this plan in a new isolated worktree based on the verified `dev` merge result.
- Do not modify `packages/opencode/**`; the native bridges already emit the required events.
- Keep `shouldUsePromptInputV2(...)` returning `false` for Android and iOS until Task 7.
- Task 6 native delete-word support was dropped to keep upstream V2 editor, store, and cursor behavior unchanged.
- Task 8 must not add native delete-word coverage.
- Use Bun 1.3.10 for every command: `rtk npx bun@1.3.10 ...`.
- Run tests from package directories, never the repository root.

## File Map

**Create**

- `packages/session-ui/src/v2/components/prompt-input/swipe.ts` - pure swipe-recognition policy shared by the V2 view and unit tests.
- `packages/session-ui/src/v2/components/prompt-input/swipe.test.ts` - threshold and one-direction gesture tests.
- `packages/session-ui/src/v2/components/prompt-input/interaction.test.ts` - controller focus-policy tests.
- `packages/app/src/components/prompt-input-v2-mobile.test.ts` - native event filtering and mobile voice-state tests.
- `packages/app/e2e/regression/prompt-input-v2-mobile.spec.ts` - rendered V2 mobile parity regression coverage.

**Modify**

- `packages/session-ui/src/v2/components/prompt-input/index.tsx` - optional voice control and editor swipe wiring.
- `packages/session-ui/src/v2/components/prompt-input/interaction.ts` - guarded programmatic focus and editor accessor.
- `packages/app/src/components/prompt-input-v2.tsx` - platform adapter, voice control, native event listeners, and transcription.
- `packages/app/src/components/prompt-input/contracts.ts` - final native V2 rollout gate.
- `packages/app/src/components/prompt-input/contracts.test.ts` - native rollout expectations.
- `packages/app/src/components/prompt-input/editor-dom.ts` - treat V2 `data-mention` spans as atomic editor tokens.
- `packages/app/src/components/prompt-input/editor-dom.test.ts` - V2 file, agent, and reference mention deletion tests.
- `packages/app/src/components/prompt-input/transcription.ts` - normalize offsets when appending transcription.
- `packages/app/src/components/prompt-input/transcription.test.ts` - structured-prompt transcription tests.
- `packages/app/src/pages/session.tsx` - dismiss the native keyboard after V2 submission.
- `packages/app/src/pages/new-session.tsx` - remove the temporary native legacy-composer fallback after parity is enabled.

**Verify, but do not change unless a test exposes a bridge defect**

- `packages/android/src/entry-android.tsx`
- `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`
- `packages/ios/src/entry-ios.tsx`
- `packages/ios/WhisperCode/WhisperCode/Bridge/KeyboardBridge.swift`
- `packages/ios/WhisperCode/WhisperCode/WebView/BridgeController.swift`

### Task 1: Record Baselines and Lock the Rollout Gate

**Files:**

- Test: `packages/app/src/components/prompt-input/contracts.test.ts`
- Benchmark: `packages/app/e2e/performance/timeline/first-navigation-benchmark.spec.ts`

- [ ] **Step 1: Confirm the native fallback is still active**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input/contracts.test.ts
```

Expected: PASS with iOS and Android returning `false` when V2 is enabled.

- [ ] **Step 2: Record the required production benchmark baseline**

Run from `packages/app`:

```bash
PLAYWRIGHT_WORKERS=1 rtk npx bun@1.3.10 x playwright test \
  --config e2e/performance/playwright.config.ts \
  timeline/first-navigation-benchmark.spec.ts \
  2>&1 | tee /var/folders/41/15zw5q7n5x9dh3cy83dr1vcm0000gn/T/opencode/prompt-v2-mobile-baseline.txt
```

Expected: PASS with `BENCHMARK` JSON lines for first navigation and new-session paint, saved outside the repository at `/var/folders/41/15zw5q7n5x9dh3cy83dr1vcm0000gn/T/opencode/prompt-v2-mobile-baseline.txt`.

- [ ] **Step 3: Record the current unit-test baseline**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 run test:unit
```

Expected: all app unit tests pass before implementation begins.

### Task 2: Add Platform-Neutral Voice Hooks to Session UI

**Files:**

- Create: `packages/session-ui/src/v2/components/prompt-input/swipe.ts`
- Create: `packages/session-ui/src/v2/components/prompt-input/swipe.test.ts`
- Modify: `packages/session-ui/src/v2/components/prompt-input/index.tsx:35-44,142-180,192-256`

- [ ] **Step 1: Write the failing swipe-policy tests**

Create `swipe.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { isPromptInputV2VoiceSwipe } from "./swipe"

describe("prompt input v2 voice swipe", () => {
  test("accepts a fast horizontal swipe to the left", () => {
    expect(isPromptInputV2VoiceSwipe({ x: 120, y: 40, time: 100 }, { x: 60, y: 48, time: 320 })).toBe(true)
  })

  test("rejects short, vertical, slow, and rightward gestures", () => {
    const start = { x: 120, y: 40, time: 100 }
    expect(isPromptInputV2VoiceSwipe(start, { x: 80, y: 40, time: 200 })).toBe(false)
    expect(isPromptInputV2VoiceSwipe(start, { x: 60, y: 70, time: 200 })).toBe(false)
    expect(isPromptInputV2VoiceSwipe(start, { x: 60, y: 40, time: 450 })).toBe(false)
    expect(isPromptInputV2VoiceSwipe(start, { x: 180, y: 40, time: 200 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run from `packages/session-ui`:

```bash
rtk npx bun@1.3.10 test src/v2/components/prompt-input/swipe.test.ts
```

Expected: FAIL because `./swipe` does not exist.

- [ ] **Step 3: Implement the swipe policy**

Create `swipe.ts`:

```ts
export type PromptInputV2SwipePoint = {
  x: number
  y: number
  time: number
}

export function isPromptInputV2VoiceSwipe(start: PromptInputV2SwipePoint, end: PromptInputV2SwipePoint) {
  return end.x - start.x < -50 && Math.abs(end.y - start.y) < 25 && end.time - start.time < 300
}
```

- [ ] **Step 4: Add optional view hooks and one-shot touch handling**

Extend `PromptInputV2Props` in `index.tsx`:

```ts
voiceControl?: JSX.Element
onVoiceSwipe?: () => void
```

Inside `PromptInputV2`, keep local gesture state:

```ts
let touchStart: { x: number; y: number; time: number } | undefined
let voiceTriggered = false

const resetVoiceSwipe = () => {
  touchStart = undefined
  voiceTriggered = false
}
```

Attach these handlers only to the contenteditable editor:

```tsx
onTouchStart={(event) => {
  const touch = event.touches[0]
  if (!touch || !props.onVoiceSwipe) return
  touchStart = { x: touch.clientX, y: touch.clientY, time: performance.now() }
  voiceTriggered = false
}}
onTouchMove={(event) => {
  const touch = event.touches[0]
  if (!touchStart || !touch || voiceTriggered || !props.onVoiceSwipe) return
  if (!isPromptInputV2VoiceSwipe(touchStart, { x: touch.clientX, y: touch.clientY, time: performance.now() })) return
  voiceTriggered = true
  props.onVoiceSwipe()
}}
onTouchEnd={resetVoiceSwipe}
onTouchCancel={resetVoiceSwipe}
```

Render the optional control directly before `PromptInputV2SubmitButton`:

```tsx
<Show when={props.voiceControl}>{props.voiceControl}</Show>
```

- [ ] **Step 5: Verify the session-ui package**

Run from `packages/session-ui`:

```bash
rtk npx bun@1.3.10 test src/v2/components/prompt-input/swipe.test.ts
rtk npx bun@1.3.10 run typecheck
```

Expected: swipe tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/session-ui/src/v2/components/prompt-input/index.tsx \
  packages/session-ui/src/v2/components/prompt-input/swipe.ts \
  packages/session-ui/src/v2/components/prompt-input/swipe.test.ts
rtk git commit -m "feat(session-ui): add prompt voice extension hooks"
```

### Task 3: Guard Programmatic V2 Focus on Native Mobile

**Files:**

- Create: `packages/session-ui/src/v2/components/prompt-input/interaction.test.ts`
- Modify: `packages/session-ui/src/v2/components/prompt-input/interaction.ts:56-71,246-251,292-340`
- Modify: `packages/app/src/components/prompt-input-v2.tsx:149-474`

- [ ] **Step 1: Write a failing controller focus-policy test**

Create `interaction.test.ts` with this controller fixture, then install a synchronous `requestAnimationFrame`, mount an editor, and prove policy denial prevents focus:

```ts
import { expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { createPromptInputV2Controller } from "./interaction"
import type { PromptInputV2PersistedState } from "./types"

function createController(canRestoreFocus: (editor: HTMLElement) => boolean) {
  const [state, setState] = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })
  return createPromptInputV2Controller({
    store: [() => state, setState],
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    canRestoreFocus,
    view: {
      submit: {
        stopping: () => false,
        onSubmit() {},
        onStop() {},
      },
    },
  })
}

test("restoreFocus respects the caller focus policy", () => {
  const original = globalThis.requestAnimationFrame
  try {
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 1
    }
    let focused = false
    const editor = {
      focus() {
        focused = true
      },
    } as HTMLElement

    const controller = createController(() => false)
    controller.setEditor(editor)
    controller.restoreFocus()

    expect(focused).toBe(false)
  } finally {
    globalThis.requestAnimationFrame = original
  }
})
```

This test deliberately uses a structural fake editor so it remains compatible with the package's normal non-DOM `bun test src` suite. Existing controller behavior already covers successful focus restoration; this regression test proves the new denial path without adding a second browser harness to `session-ui`.

- [ ] **Step 2: Run the test and verify RED**

Run from `packages/session-ui`:

```bash
rtk npx bun@1.3.10 test src/v2/components/prompt-input/interaction.test.ts
```

Expected: FAIL because `canRestoreFocus` is not accepted or consulted.

- [ ] **Step 3: Add the generic controller policy**

Extend the controller input type:

```ts
canRestoreFocus?: (editor: HTMLElement) => boolean
```

Guard only the public/programmatic restore path:

```ts
const restoreFocus = (cursor = draft.state.cursor ?? promptLength(draft.state.prompt)) => {
  requestAnimationFrame(() => {
    if (!editor || input.canRestoreFocus?.(editor) === false) return
    editor.focus()
    setEditorCursor(editor, cursor)
  })
}
```

Expose the active editor for app-owned native actions without making it mutable:

```ts
editor() {
  return editor
},
```

- [ ] **Step 4: Supply the native-safe policy from the app adapter**

In `usePromptInputV2Controller`, pass:

```ts
canRestoreFocus: (element) =>
  platform.platform !== "ios" && platform.platform !== "android" || document.activeElement === element,
```

This permits desktop/web restoration and restoration of an already-active native editor, while preventing route load, edit load, or popover closure from summoning the native keyboard.

- [ ] **Step 5: Verify focus behavior**

Run:

```bash
rtk npx bun@1.3.10 test src/v2/components/prompt-input/interaction.test.ts
rtk npx bun@1.3.10 run typecheck
```

from `packages/session-ui`, then from `packages/app`:

```bash
rtk npx bun@1.3.10 run typecheck
```

Expected: both package typechecks and focus-policy tests pass.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/session-ui/src/v2/components/prompt-input/interaction.ts \
  packages/session-ui/src/v2/components/prompt-input/interaction.test.ts \
  packages/app/src/components/prompt-input-v2.tsx
rtk git commit -m "fix(app): guard prompt v2 focus on mobile"
```

### Task 4: Add the Native Voice Control to V2

**Files:**

- Create: `packages/app/src/components/prompt-input-v2-mobile.test.ts`
- Modify: `packages/app/src/components/prompt-input-v2.tsx:1-83`

- [ ] **Step 1: Write failing voice-availability tests**

Create a pure exported policy in the test's wished-for API:

```ts
import { describe, expect, test } from "bun:test"
import { promptInputV2VoiceAvailable, promptInputV2VoiceDisabled } from "./prompt-input-v2"

describe("prompt input v2 mobile voice", () => {
  test("offers voice only in normal mode on a native platform with a bridge", () => {
    expect(promptInputV2VoiceAvailable("ios", "normal", true)).toBe(true)
    expect(promptInputV2VoiceAvailable("android", "normal", true)).toBe(true)
    expect(promptInputV2VoiceAvailable("web", "normal", true)).toBe(false)
    expect(promptInputV2VoiceAvailable("ios", "shell", true)).toBe(false)
    expect(promptInputV2VoiceAvailable("ios", "normal", false)).toBe(false)
  })

  test("disables voice while recording or processing", () => {
    expect(promptInputV2VoiceDisabled(undefined)).toBe(false)
    expect(promptInputV2VoiceDisabled("ready")).toBe(false)
    expect(promptInputV2VoiceDisabled("recording")).toBe(true)
    expect(promptInputV2VoiceDisabled("processing")).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input-v2-mobile.test.ts
```

Expected: FAIL because both policy exports are missing.

- [ ] **Step 3: Implement policy functions and the V2 voice adapter**

Import `VoiceState` as a type from `@/context/platform`, then add the pure policy functions:

```ts
export const promptInputV2VoiceAvailable = (
  platform: ReturnType<typeof usePlatform>["platform"],
  mode: "normal" | "shell",
  available: boolean,
) => (platform === "ios" || platform === "android") && mode === "normal" && available

export const promptInputV2VoiceDisabled = (state: VoiceState | undefined) =>
  state === "recording" || state === "processing"
```

In `PromptInputV2Composer`, obtain `const platform = usePlatform()` and define one start action:

```ts
const startVoice = () => {
  if (!platform.startVoiceInput) return
  void platform.haptic?.("light")
  void platform.startVoiceInput()
}
```

Pass to `PromptInputV2`:

```tsx
onVoiceSwipe={
  promptInputV2VoiceAvailable(platform.platform, props.controller.state.mode, !!platform.startVoiceInput)
    ? startVoice
    : undefined
}
voiceControl={
  <Show when={promptInputV2VoiceAvailable(platform.platform, props.controller.state.mode, !!platform.startVoiceInput)}>
    <TooltipV2 value="Voice input" placement="top">
      <IconButtonV2
        data-action="prompt-voice"
        icon="microphone"
        variant="ghost-muted"
        aria-label="Voice input"
        disabled={promptInputV2VoiceDisabled(platform.voiceStatus?.().state)}
        onClick={startVoice}
      />
    </TooltipV2>
  </Show>
}
```

This deliberately matches the legacy composer's existing `Voice input` label. Localization can be handled separately for both composers.

- [ ] **Step 4: Verify voice policy and package typechecks**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input-v2-mobile.test.ts
rtk npx bun@1.3.10 run typecheck
```

Run from `packages/session-ui`:

```bash
rtk npx bun@1.3.10 run typecheck
```

Expected: tests and both typechecks pass.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/app/src/components/prompt-input-v2.tsx \
  packages/app/src/components/prompt-input-v2-mobile.test.ts
rtk git commit -m "feat(app): add native voice controls to prompt v2"
```

### Task 5: Port Transcription to the V2 Prompt Store

**Files:**

- Modify: `packages/app/src/components/prompt-input/transcription.ts`
- Modify: `packages/app/src/components/prompt-input/transcription.test.ts`
- Modify: `packages/app/src/components/prompt-input-v2.tsx:45-47,49-83,149-474`

- [ ] **Step 1: Add failing structured-prompt transcription tests**

Add tests proving transcription appends after mentions/images and recomputes offsets:

```ts
test("appends after a structured mention and normalizes offsets", () => {
  const prompt = [
    { type: "text" as const, content: "Review ", start: 0, end: 7 },
    { type: "file" as const, path: "src/app.ts", content: "@src/app.ts", start: 7, end: 18 },
  ]

  expect(appendTranscription(prompt, "please")).toEqual([
    prompt[0],
    prompt[1],
    { type: "text", content: "please", start: 18, end: 24 },
  ])
})

test("extends the trailing text part with normalized offsets", () => {
  expect(appendTranscription([{ type: "text", content: "hello", start: 0, end: 1 }], "world")).toEqual([
    { type: "text", content: "hello world", start: 0, end: 11 },
  ])
})
```

- [ ] **Step 2: Run and verify RED**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input/transcription.test.ts
```

Expected: at least the stale-offset assertion fails.

- [ ] **Step 3: Normalize appended prompt offsets**

Keep the current spacing behavior, then map content-bearing parts through a running offset so every `start` and `end` reflects the new prompt. Preserve image parts unchanged.

```ts
let offset = 0
return next.map((part) => {
  if (!("content" in part)) return part
  const start = offset
  offset += part.content.length
  return { ...part, start, end: offset }
})
```

- [ ] **Step 4: Add a controller transcription action**

Extend `PromptInputV2ComposerController`:

```ts
appendTranscription(text: string): void
```

After creating the base controller, define an action that ignores blank text, updates the shared prompt without focusing, and moves the cursor to the end:

```ts
const appendNativeTranscription = (text: string) => {
  const value = text.trim()
  if (!value) return
  const next = appendTranscription(prompt.current(), value)
  prompt.set(next, promptLength(next))
  requestAnimationFrame(() => {
    const editor = controller.editor()
    editor?.scrollTo({ top: editor.scrollHeight })
  })
}
```

Keep the current reactive `model` getter, then extend the controller with the native action:

```ts
Object.defineProperty(controller, "model", { get: () => props.controls.model })
return Object.assign(controller, {
  appendTranscription: appendNativeTranscription,
}) as PromptInputV2ComposerController
```

- [ ] **Step 5: Register the native event only while the V2 composer is mounted**

In `PromptInputV2Composer`, register and clean up:

```ts
const onTranscription = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; isFinal?: boolean }>).detail
  if (!detail?.text || detail.isFinal === false) return
  props.controller.appendTranscription(detail.text)
}

window.addEventListener("opencode:transcription", onTranscription)
onCleanup(() => window.removeEventListener("opencode:transcription", onTranscription))
```

Do not register this listener inside `usePromptInputV2Controller`; new-session can construct a controller while the legacy composer is mounted, which would duplicate event consumption.

- [ ] **Step 6: Verify transcription tests and typecheck**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input/transcription.test.ts
rtk npx bun@1.3.10 run typecheck
```

Expected: transcription tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/app/src/components/prompt-input/transcription.ts \
  packages/app/src/components/prompt-input/transcription.test.ts \
  packages/app/src/components/prompt-input-v2.tsx
rtk git commit -m "feat(app): handle native transcription in prompt v2"
```

### Task 6: Port Native Delete-Word to V2 (Dropped)

This task was intentionally dropped. Do not execute the steps below or modify upstream V2 editor, store, or cursor behavior.

**Files:**

- Modify: `packages/app/src/components/prompt-input/editor-dom.ts`
- Modify: `packages/app/src/components/prompt-input/editor-dom.test.ts`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`

- [ ] **Step 1: Write failing atomic V2 mention tests**

Extend the existing pill-deletion test for each V2 marker:

```ts
for (const mention of ["file", "agent", "reference"] as const) {
  test(`deletes a v2 ${mention} mention atomically`, () => {
    const container = document.createElement("div")
    const pill = document.createElement("span")
    pill.dataset.mention = mention
    pill.contentEditable = "false"
    pill.textContent = "@target"
    container.append("foo ", pill, " bar")
    document.body.appendChild(container)

    const text = getEditorText(container)
    const span = getDeleteWordRange(text, { start: 11, end: 11 })!
    const range = document.createRange()
    setSelectionRange(container, range, span.start, span.end)
    range.deleteContents()
    setCursorPosition(container, span.start)

    expect(getEditorText(container)).toBe("foo bar")
    container.remove()
  })
}
```

- [ ] **Step 2: Run and verify RED**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input/editor-dom.test.ts
```

Expected: one or more V2 mention cases fail because helpers only recognize legacy `data-type` pills.

- [ ] **Step 3: Treat V2 mentions as atomic tokens**

In `editor-dom.ts`, update the existing pill predicate to return true for either legacy `data-type="file|agent"` or V2 `data-mention="file|agent|reference"`. Keep this logic in the existing predicate; do not duplicate traversal code.

- [ ] **Step 4: Add the V2 delete-word action**

Extend `PromptInputV2ComposerController`:

```ts
deleteWord(): void
```

Implement the action near controller creation:

```ts
const deleteWord = () => {
  if (!editor) return
  const active = document.activeElement === editor || editor.contains(window.getSelection()?.anchorNode ?? null)
  if (!active) return
  const text = getEditorText(editor)
  const selection = getSelectionRange(editor)
  const deletion = getDeleteWordRange(text, selection)
  if (!deletion) return
  const range = document.createRange()
  setSelectionRange(editor, range, deletion.start, deletion.end)
  const current = window.getSelection()
  current?.removeAllRanges()
  current?.addRange(range)
  range.deleteContents()
  setCursorPosition(editor, deletion.start)
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteWordBackward" }))
}
```

Update the Task 5 return to include `deleteWord` while preserving the reactive model getter:

```ts
Object.defineProperty(controller, "model", { get: () => props.controls.model })
return Object.assign(controller, {
  appendTranscription: appendNativeTranscription,
  deleteWord,
}) as PromptInputV2ComposerController
```

- [ ] **Step 5: Register and clean up the native event in the mounted composer**

```ts
const onDeleteWord = () => props.controller.deleteWord()
window.addEventListener("opencode:keyboard-delete-word", onDeleteWord)
onCleanup(() => window.removeEventListener("opencode:keyboard-delete-word", onDeleteWord))
```

- [ ] **Step 6: Verify editor tests and app typecheck**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input/editor-dom.test.ts
rtk npx bun@1.3.10 run typecheck
```

Expected: all editor tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/app/src/components/prompt-input/editor-dom.ts \
  packages/app/src/components/prompt-input/editor-dom.test.ts \
  packages/app/src/components/prompt-input-v2.tsx
rtk git commit -m "feat(app): handle native delete word in prompt v2"
```

### Task 7: Enable V2 on Android and iOS

**Files:**

- Modify: `packages/app/src/components/prompt-input/contracts.test.ts`
- Modify: `packages/app/src/components/prompt-input/contracts.ts:9-10`
- Modify: `packages/app/src/pages/new-session.tsx:170-220`
- Modify: `packages/app/src/pages/session.tsx:2370-2430`

- [ ] **Step 1: Change the rollout test first**

Update `contracts.test.ts`:

```ts
test("uses v2 on every platform when the design is enabled", () => {
  expect(shouldUsePromptInputV2("ios", true)).toBe(true)
  expect(shouldUsePromptInputV2("android", true)).toBe(true)
  expect(shouldUsePromptInputV2("desktop", true)).toBe(true)
  expect(shouldUsePromptInputV2("web", true)).toBe(true)
})

test("keeps legacy input when the design is disabled", () => {
  expect(shouldUsePromptInputV2("ios", false)).toBe(false)
  expect(shouldUsePromptInputV2("android", false)).toBe(false)
})
```

- [ ] **Step 2: Run and verify RED**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts ./src/components/prompt-input/contracts.test.ts
```

Expected: iOS and Android enabled assertions fail.

- [ ] **Step 3: Remove the platform exclusion**

Change the implementation to:

```ts
export const shouldUsePromptInputV2 = (_platform: ReturnType<typeof usePlatform>["platform"], enabled: boolean) =>
  enabled
```

Keep the platform parameter for caller stability until a later upstream cleanup.

- [ ] **Step 4: Route explicit focus to the mounted composer in new-session**

Keep the existing `focusPromptInput(...)` router and legacy ref. Native platforms now select V2 when the design is enabled, while every platform can still mount legacy `PromptInput` when the design is disabled.

Pass the updated `shouldUsePromptInputV2(...)` result into `focusPromptInput(...)` for the input command and project/workspace selector completion. This sends explicit focus to the composer that is actually mounted. The controller focus policy from Task 3 still decides whether V2 native focus is safe.

- [ ] **Step 5: Dismiss the keyboard after V2 session submission**

Change the V2 `onSubmit` callback in `session.tsx` to match the legacy branch:

```tsx
onSubmit={() => {
  comments.clear()
  resumeScroll()
  if (mobilePlatform()) scroller?.focus()
}}
```

- [ ] **Step 6: Run focused rollout tests and typecheck**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 test --preload ./happydom.ts \
  ./src/components/prompt-input/contracts.test.ts \
  ./src/components/prompt-input-v2-mobile.test.ts \
  ./src/components/prompt-input/transcription.test.ts \
  ./src/components/prompt-input/editor-dom.test.ts
rtk npx bun@1.3.10 run typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/app/src/components/prompt-input/contracts.ts \
  packages/app/src/components/prompt-input/contracts.test.ts \
  packages/app/src/pages/new-session.tsx \
  packages/app/src/pages/session.tsx
rtk git commit -m "feat(app): enable prompt input v2 on mobile"
```

### Task 8: Add Rendered Mobile-Web Regression Coverage

**Files:**

- Create: `packages/app/e2e/regression/prompt-input-v2-mobile.spec.ts`
- Reuse: `packages/app/e2e/fixtures.ts`

- [ ] **Step 1: Add the rendered mobile-web regression test**

Create the test with a narrow touch viewport. Mobile web intentionally has no native voice control, but it exercises the same mounted V2 editor and browser events without fabricating a native `PlatformProvider`:

```ts
import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2Mobile"
const projectID = "proj_prompt_input_v2_mobile"

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

async function openComposer(page: Parameters<typeof mockOpenCodeServer>[0]) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-input-v2-mobile",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  return composer.locator('[data-component="prompt-input"]')
}

test("does not autofocus the mobile v2 composer", async ({ page }) => {
  const input = await openComposer(page)
  await expect(input).not.toBeFocused()
})

test("handles final transcription once and ignores partial transcription", async ({ page }) => {
  const input = await openComposer(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("opencode:transcription", { detail: { text: "partial", isFinal: false } }))
    window.dispatchEvent(new CustomEvent("opencode:transcription", { detail: { text: "final words", isFinal: true } }))
  })
  await expect(input).toHaveText("final words")
})
```

Voice-button visibility, recording-state disablement, and swipe invocation remain covered by pure unit tests plus native smoke tests because web e2e does not mount the Android/iOS platform adapters.

- [ ] **Step 2: Run the regression test and fix only parity defects**

Run from `packages/app`:

```bash
rtk npx bun@1.3.10 x playwright test e2e/regression/prompt-input-v2-mobile.spec.ts
```

Expected: all mobile V2 regressions pass.

- [ ] **Step 3: Run the existing command-draft regression**

```bash
rtk npx bun@1.3.10 x playwright test e2e/regression/prompt-input-v2-command-draft.spec.ts
```

Expected: PASS, proving mobile hooks did not regress upstream V2 command handling.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/app/e2e/regression/prompt-input-v2-mobile.spec.ts
rtk git commit -m "test(app): cover prompt v2 mobile integrations"
```

### Task 9: Full Verification and Native Smoke Tests

**Files:**

- Verify all modified files.
- Do not commit generated Android permission files, `mobile-bridge/Cargo.lock`, copied Firebase files, or `node_modules` artifacts.

- [ ] **Step 1: Run package unit tests**

From `packages/session-ui`:

```bash
rtk npx bun@1.3.10 run test
rtk npx bun@1.3.10 run typecheck
```

From `packages/app`:

```bash
rtk npx bun@1.3.10 run test:unit
rtk npx bun@1.3.10 run typecheck
```

Expected: all tests and typechecks pass.

- [ ] **Step 2: Build app and mobile packages**

From repository root:

```bash
rtk npx bun@1.3.10 run --cwd packages/app build
rtk npx bun@1.3.10 run --cwd packages/android typecheck
rtk npx bun@1.3.10 run --cwd packages/android build
rtk npx bun@1.3.10 run --cwd packages/ios typecheck
rtk npx bun@1.3.10 run --cwd packages/ios build
```

Expected: all builds and typechecks exit zero.

- [ ] **Step 3: Repeat the production benchmark**

Run from `packages/app`:

```bash
PLAYWRIGHT_WORKERS=1 rtk npx bun@1.3.10 x playwright test \
  --config e2e/performance/playwright.config.ts \
  timeline/first-navigation-benchmark.spec.ts
```

Expected: PASS with complete `BENCHMARK` records. Compare scenario durations and paint completion against the Task 1 baseline; investigate a consistent regression before proceeding. Do not add machine-dependent pass/fail thresholds.

- [ ] **Step 4: Android device smoke test**

Build and transfer with the repository script:

```bash
rtk ./packages/android/build-and-install.sh
```

On the device verify: no initial keyboard popup, voice button and swipe start recording, final transcription appends once, attachments still work, submit dismisses the keyboard, and returning from model/project selectors does not unexpectedly open it.

- [ ] **Step 5: iOS device smoke test**

Run the iOS development target without uploading a release. Verify the Android scenarios.

- [ ] **Step 6: Inspect changes and graph impact before the final commit**

```bash
rtk git status --short
rtk git diff --check
rtk git diff --stat dev...HEAD
```

Run GitNexus:

```text
detect_changes(scope="compare", base_ref="dev", worktree="/Users/isaac/Projects/whispercode/.worktrees/prompt-input-v2-mobile")
```

Expected: affected flows are limited to prompt composition, new-session/session submission, and native mobile editor interactions. Treat any unrelated process as a review blocker.

- [ ] **Step 7: Final commit if verification required follow-up changes**

```bash
rtk git add packages/session-ui/src/v2/components/prompt-input \
  packages/app/src/components/prompt-input-v2.tsx \
  packages/app/src/components/prompt-input-v2-mobile.test.ts \
  packages/app/src/components/prompt-input/contracts.ts \
  packages/app/src/components/prompt-input/contracts.test.ts \
  packages/app/src/components/prompt-input/editor-dom.ts \
  packages/app/src/components/prompt-input/editor-dom.test.ts \
  packages/app/src/components/prompt-input/transcription.ts \
  packages/app/src/components/prompt-input/transcription.test.ts \
  packages/app/src/pages/new-session.tsx \
  packages/app/src/pages/session.tsx \
  packages/app/e2e/regression/prompt-input-v2-mobile.spec.ts
rtk git commit -m "fix(app): complete prompt v2 mobile parity"
```

Do not push without explicit user authorization.

## Acceptance Criteria

- Android and iOS render Prompt Input V2 whenever the V2 design is enabled.
- Opening a new session does not automatically summon the native keyboard.
- Voice button and fast left swipe start the existing native recording flow exactly once.
- Recording and processing states disable the voice button.
- Final transcription appends exactly once without focusing the editor; partial transcription is ignored.
- Successful submission dismisses the native keyboard.
- Attachments, history, shell mode, command menu, model/agent/variant selection, comments, and populated command drafts retain upstream V2 behavior.
- Session/new-session production benchmark scenarios complete without a consistent regression.
- Unit tests, typechecks, builds, rendered regressions, Android smoke tests, and iOS smoke tests pass.

## Deferred Cleanup

- Do not delete the legacy `PromptInput` in this work. It remains the non-V2 design implementation and a rollback path.
- Do not move app-native voice concepts into `packages/session-ui`; retain optional generic hooks.
- Do not change Android or iOS native bridge APIs unless smoke testing proves the existing event contract is defective.
- Native delete-word parity is out of scope; keep upstream V2 editor, store, and cursor behavior unchanged.
