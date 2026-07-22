import { expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { renderToString } from "solid-js/web"
import { createPromptInputV2Controller } from "./interaction"
import type { PromptInputV2PersistedState } from "./types"

test("restoreFocus respects a denied focus policy", () => {
  const store = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })
  let controller!: ReturnType<typeof createPromptInputV2Controller>
  renderToString(() => {
    controller = createPromptInputV2Controller({
      store,
      commands: () => [],
      context: () => [],
      searchContextFiles: () => [],
      canRestoreFocus: () => false,
      view: {
        submit: {
          stopping: () => false,
          onSubmit() {},
          onStop() {},
        },
      },
    })
    return ""
  })
  let focused = false
  let error: unknown
  const editor = {
    focus() {
      focused = true
    },
  } as HTMLElement
  const requestAnimationFrame = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (callback) => {
    try {
      callback(0)
    } catch (cause) {
      error = cause
    }
    return 0
  }

  try {
    controller.setEditor(editor)
    controller.restoreFocus()

    expect(focused).toBeFalse()
    expect(error).toBeUndefined()
  } finally {
    globalThis.requestAnimationFrame = requestAnimationFrame
  }
})
