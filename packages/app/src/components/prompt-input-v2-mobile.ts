import type { PromptInputV2Mode } from "@opencode-ai/session-ui/v2/prompt-input"
import { promptLength } from "@/components/prompt-input/history"
import { appendTranscription } from "@/components/prompt-input/transcription"
import type { PlatformName, VoiceStartResult, VoiceState } from "@/context/platform"
import type { Prompt } from "@/context/prompt"

// Native voice recording is process-global, so only its starter may consume the final event.
let transcriptionOwner: symbol | undefined

export function createPromptInputV2TranscriptionOwner() {
  const id = Symbol()
  let active = true
  const release = () => {
    if (transcriptionOwner === id) transcriptionOwner = undefined
  }
  return {
    claim: () => {
      if (active) transcriptionOwner = id
    },
    owns: () => transcriptionOwner === id,
    release,
    dispose: () => {
      active = false
      release()
    },
  }
}

export function createPromptInputV2AppendTranscription(input: {
  current(): Prompt
  set(prompt: Prompt, cursor: number): void
  editor(): { readonly scrollHeight: number; scrollTo(options: ScrollToOptions): void } | undefined
  queueScroll(task: () => void): void
}): (text: string) => void {
  return (text) => {
    const value = text.trim()
    if (!value) return
    const next = appendTranscription(input.current(), value)
    input.set(next, promptLength(next))
    input.queueScroll(() => {
      const editor = input.editor()
      editor?.scrollTo({ top: editor.scrollHeight })
    })
  }
}

export function createPromptInputV2TranscriptionHandler(
  append: (text: string) => void,
  owner: ReturnType<typeof createPromptInputV2TranscriptionOwner>,
): (event: Event) => void {
  return (event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as { text?: string; isFinal?: boolean } | undefined
    if (!detail?.text || detail.isFinal === false || !owner.owns()) return
    owner.release()
    append(detail.text)
  }
}

export function promptInputV2VoiceAvailable(
  platform: PlatformName,
  mode: PromptInputV2Mode,
  available: boolean,
): boolean {
  return (platform === "ios" || platform === "android") && mode === "normal" && available
}

export function promptInputV2VoiceDisabled(state: VoiceState | undefined, pending = false): boolean {
  return pending || state === "recording" || state === "processing"
}

export function createPromptInputV2VoiceStart(input: {
  disabled(): boolean
  start(): VoiceStartResult | Promise<VoiceStartResult>
  onStart(): void
  onSuccess(): void
  onPending(value: boolean): void
  onFailure(message: string): void
}): () => void {
  let pending = false
  return () => {
    if (pending || input.disabled()) return
    pending = true
    input.onPending(true)
    void Promise.resolve()
      .then(() => {
        input.onStart()
        return input.start()
      })
      .then((result) => {
        if (!result.ok) {
          input.onFailure(result.message ?? "Voice input is unavailable.")
          return
        }
        input.onSuccess()
      })
      .catch((error: unknown) => input.onFailure(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        pending = false
        input.onPending(false)
      })
  }
}
