// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to persist the fork's relay URL and
// mirror it into the native mobile wrappers without splitting the shared app package.

import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import { DEFAULT_PUSH_RELAY_URL, normalizePushRelayURL } from "@/utils/push-relay-url"

export function legacyPushEnabled(enabled?: boolean) {
  return enabled !== false
}

export const { use: usePushRelay, provider: PushRelayProvider } = createSimpleContext({
  name: "PushRelay",
  gate: false,
  init: (props: { enabled?: boolean }) => {
    const platform = usePlatform()
    const enabled = () => legacyPushEnabled(props.enabled)

    const [store, setStore, , ready] = persisted(
      Persist.global("push.relay", ["push.relay.v1"]),
      createStore({
        url: undefined as string | undefined,
      }),
    )

    const current = createMemo(() => store.url ?? DEFAULT_PUSH_RELAY_URL)
    let last: string | undefined

    createEffect(() => {
      if (!enabled()) {
        last = undefined
        return
      }
      const next = current()
      if (!platform.setPushRelayURL || next === last) return
      last = next
      void platform.setPushRelayURL(next)
    })

    return {
      ready,
      current,
      custom: () => store.url,
      set(value?: string) {
        if (!enabled()) return
        setStore("url", normalizePushRelayURL(value))
      },
      clear() {
        if (!enabled()) return
        setStore("url", undefined)
      },
    }
  },
})
