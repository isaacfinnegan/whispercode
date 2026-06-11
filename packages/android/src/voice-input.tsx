import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"

type VoiceOverlayState = "hidden" | "recording" | "processing"

export function VoiceInputOverlay(props: { state: () => VoiceOverlayState; onStop: () => void }) {
  const processing = () => props.state() === "processing"

  return (
    <Show when={props.state() !== "hidden"}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div class="flex flex-col items-center gap-4 min-w-[280px] rounded-xl bg-background-base p-6 shadow-lg">
          <div class="text-16-medium text-foreground-base">{processing() ? "Processing..." : "Listening..."}</div>
          <Button
            type="button"
            variant="primary"
            class="h-11 px-5 w-full text-14-medium"
            onClick={() => props.onStop()}
            disabled={processing()}
          >
            <div class="flex items-center gap-2">
              <Icon name="stop" class="size-5" />
              <span>{processing() ? "Processing" : "Stop"}</span>
            </div>
          </Button>
        </div>
      </div>
    </Show>
  )
}
