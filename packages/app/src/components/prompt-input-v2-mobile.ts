import type { PromptInputV2Mode } from "@opencode-ai/session-ui/v2/prompt-input"
import type { PlatformName, VoiceStartResult, VoiceState } from "@/context/platform"

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
