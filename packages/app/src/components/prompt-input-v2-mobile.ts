import type { PromptInputV2Mode } from "@opencode-ai/session-ui/v2/prompt-input"
import { promptLength } from "@/components/prompt-input/history"
import { appendTranscription } from "@/components/prompt-input/transcription"
import type { PlatformName, VoiceStartResult, VoiceState } from "@/context/platform"
import type { Prompt } from "@/context/prompt"

export function createPromptInputV2AppendTranscription(input: {
  current(): Prompt
  set(prompt: Prompt, cursor: number): void
  queueScroll(): void
}): (text: string) => void {
  return (text) => {
    const value = text.trim()
    if (!value) return
    const next = appendTranscription(input.current(), value)
    input.set(next, promptLength(next))
    input.queueScroll()
  }
}

export function createPromptInputV2TranscriptionHandler(append: (text: string) => void): (event: Event) => void {
  return (event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as { text?: string; isFinal?: boolean } | undefined
    if (!detail?.text || detail.isFinal === false) return
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
        if (!result.ok) input.onFailure(result.message ?? "Voice input is unavailable.")
      })
      .catch((error: unknown) => input.onFailure(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        pending = false
        input.onPending(false)
      })
  }
}
