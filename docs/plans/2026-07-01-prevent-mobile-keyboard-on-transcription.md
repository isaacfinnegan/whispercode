# Prevent Mobile Keyboard Popup on Voice Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the mobile virtual keyboard from popping up programmatically when inserting voice transcription text, by bypassing input focus on mobile platforms and directly updating the SolidJS state store.

**Architecture:** Create a new modular helper function `appendTranscription` in a new file `packages/app/src/components/prompt-input/transcription.ts`. Update `packages/app/src/components/prompt-input.tsx` to conditionally bypass `.focus()` and DOM selections when `isMobilePlatform(platform)` is true, using direct SolidJS state store updates instead.

**Tech Stack:** TypeScript, SolidJS, Bun Test

---

### Task 1: Create transcription state helper and its tests

**Files:**
- Create: `packages/app/src/components/prompt-input/transcription.ts`
- Create: `packages/app/src/components/prompt-input/transcription.test.ts`

- [ ] **Step 1: Write the transcription helper module**

Write the implementation of `appendTranscription` which purely modifies `Prompt` parts.

Create file `/Users/isaac/Projects/whispercode/packages/app/src/components/prompt-input/transcription.ts`:
```typescript
import type { Prompt, TextPart } from "@/context/prompt"

/**
 * Appends transcription text to the prompt parts array, combining with the last text part if present.
 * UPSTREAM-DIVERGENCE-FILE
 */
export function appendTranscription(currentPrompt: Prompt, text: string): Prompt {
  const lastPartIndex = currentPrompt.length - 1
  const lastPart = currentPrompt[lastPartIndex]

  if (lastPart && lastPart.type === "text") {
    const lastContent = lastPart.content
    const separator = lastContent && !/\s$/.test(lastContent) ? " " : ""
    const updatedLastPart: TextPart = {
      ...lastPart,
      content: lastContent + separator + text,
    }
    return [
      ...currentPrompt.slice(0, lastPartIndex),
      updatedLastPart,
    ]
  }

  return [
    ...currentPrompt,
    { type: "text", content: text, start: 0, end: text.length },
  ]
}
```

- [ ] **Step 2: Write the unit tests for the transcription helper**

Create file `/Users/isaac/Projects/whispercode/packages/app/src/components/prompt-input/transcription.test.ts`:
```typescript
import { describe, expect, test } from "bun:test"
import { appendTranscription } from "./transcription"
import type { Prompt } from "@/context/prompt"

describe("appendTranscription", () => {
  test("appends a new text part when prompt is empty or ends with non-text", () => {
    const emptyPrompt: Prompt = []
    expect(appendTranscription(emptyPrompt, "hello")).toEqual([
      { type: "text", content: "hello", start: 0, end: 5 }
    ])

    const imagePrompt: Prompt = [{ type: "image", id: "1", filename: "image.png", mime: "image/png", dataUrl: "data:..." }]
    expect(appendTranscription(imagePrompt, "hello")).toEqual([
      { type: "image", id: "1", filename: "image.png", mime: "image/png", dataUrl: "data:..." },
      { type: "text", content: "hello", start: 0, end: 5 }
    ])
  })

  test("appends to the last text part, inserting a space if necessary", () => {
    const promptWithText: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 }
    ]
    expect(appendTranscription(promptWithText, "world")).toEqual([
      { type: "text", content: "hello world", start: 0, end: 5 }
    ])

    const promptWithTextAndSpace: Prompt = [
      { type: "text", content: "hello ", start: 0, end: 6 }
    ]
    expect(appendTranscription(promptWithTextAndSpace, "world")).toEqual([
      { type: "text", content: "hello world", start: 0, end: 6 }
    ])
  })
})
```

- [ ] **Step 3: Run the unit tests and verify they pass**

Run: `bun test --preload ./packages/app/happydom.ts ./packages/app/src/components/prompt-input/transcription.test.ts`
Expected output: 2 pass, 0 fail.

- [ ] **Step 4: Commit Task 1 changes**

Run:
```bash
rtk git add packages/app/src/components/prompt-input/transcription.ts packages/app/src/components/prompt-input/transcription.test.ts
rtk git commit -m "feat: add transcription helper and tests"
```

---

### Task 2: Integrate transcription helper into prompt-input component

**Files:**
- Modify: `packages/app/src/components/prompt-input.tsx`

- [ ] **Step 1: Import the new helper**

Add the import line in `packages/app/src/components/prompt-input.tsx`.

Search for imports from `./prompt-input/...` and add:
```typescript
import { appendTranscription } from "./prompt-input/transcription"
```

- [ ] **Step 2: Update the handleTranscription event listener**

Locate the `handleTranscription` effect in `packages/app/src/components/prompt-input.tsx` around line 712:
```typescript
  createEffect(() => {
    const handleTranscription = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { text?: string; isFinal?: boolean } | undefined
      if (!detail?.text) return
      if (detail.isFinal === false) return
      if (!editorRef) return

      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
      addPart({ type: "text", content: detail.text, start: 0, end: 0 })
    }

    window.addEventListener("opencode:transcription", handleTranscription)
    onCleanup(() => window.removeEventListener("opencode:transcription", handleTranscription))
  })
```

Modify it to conditionally handle mobile platforms with direct SolidJS state updates:
```typescript
  createEffect(() => {
    const handleTranscription = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { text?: string; isFinal?: boolean } | undefined
      if (!detail?.text) return
      if (detail.isFinal === false) return
      if (!editorRef) return

      // UPSTREAM-DIVERGENCE
      const isMobile = isMobilePlatform(platform)
      if (isMobile) {
        const nextPrompt = appendTranscription(prompt.current(), detail.text)
        prompt.set(nextPrompt, promptLength(nextPrompt))
        queueScroll()
      } else {
        editorRef.focus()
        setCursorPosition(editorRef, promptLength(prompt.current()))
        addPart({ type: "text", content: detail.text, start: 0, end: 0 })
      }
    }

    window.addEventListener("opencode:transcription", handleTranscription)
    onCleanup(() => window.removeEventListener("opencode:transcription", handleTranscription))
  })
```

- [ ] **Step 3: Run full package unit test suite to verify no regressions**

Run: `bun run --cwd packages/app test:unit`
Expected output: All tests pass.

- [ ] **Step 4: Commit Task 2 changes**

Run:
```bash
rtk git add packages/app/src/components/prompt-input.tsx
rtk git commit -m "feat: bypass editor focus for mobile transcription to prevent keyboard popup"
```
