import type { PromptInputV2Mode } from "@opencode-ai/session-ui/v2/prompt-input"
import type { PlatformName, VoiceState } from "@/context/platform"

export function promptInputV2VoiceAvailable(
  platform: PlatformName,
  mode: PromptInputV2Mode,
  available: boolean,
): boolean {
  return (platform === "ios" || platform === "android") && mode === "normal" && available
}

export function promptInputV2VoiceDisabled(state: VoiceState | undefined): boolean {
  return state === "recording" || state === "processing"
}
