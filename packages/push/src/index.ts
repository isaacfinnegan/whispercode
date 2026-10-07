import type { Plugin } from "@opencode-ai/plugin"
import { checkin } from "./checkin.js"
import { record } from "./event.js"
import { publish } from "./relay.js"
import { load, save } from "./state.js"

const DISPOSE_TIMEOUT_MS = 1_000

const plugin: Plugin = async () => {
  const boot = load()
    .then(async (data) => {
      if (data.mode !== "relay" || !data.relay) return
      await checkin(data, "plugin")
    })
    .catch(() => {
      // console.error("whisperopencode-push: init failed")
    })

  let run = Promise.resolve()
  let stopped = false
  let disposal: Promise<void> | undefined

  return {
    event({ event }) {
      if (stopped) return run
      run = run
        .then(async () => {
          await boot
          const data = await load()
          const item = await record(data, event as never)
          if (item && data.mode === "relay" && data.relay) {
            const relay = data.relay
            await publish(data, item)
              .then((res) => {
                data.relay = {
                  ...relay,
                  checked: Date.now(),
                  result: res.suppressed ? "suppressed" : "accepted",
                  reason: res.reason,
                  delivery: res.deliveries?.[0]?.delivery_id,
                  err: undefined,
                }
                // console.info(
                //   `whisperopencode-push: publish ${res.suppressed ? "suppressed" : "accepted"}`,
                //   res.reason ?? (res.device_count ? `${res.device_count} device(s)` : ""),
                // )
              })
              .catch((err: unknown) => {
                data.relay = {
                  ...relay,
                  checked: Date.now(),
                  result: "failed",
                  err: err instanceof Error ? err.message : String(err),
                }
                // console.warn("whisperopencode-push: publish failed", data.relay.err)
              })
          }
          await save(data)
        })
        .catch(() => {
          // console.error("whisperopencode-push: event failed")
        })
      return run
    },
    dispose() {
      if (disposal) return disposal
      stopped = true
      const pending = run
      disposal = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            pending,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, DISPOSE_TIMEOUT_MS)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      })()
      return disposal
    },
  }
}

export default plugin
