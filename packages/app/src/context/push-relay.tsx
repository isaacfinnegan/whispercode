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

export function createLegacyPushOperation(enabled: () => boolean) {
  let generation = 0
  return {
    begin() {
      const current = ++generation
      return () => enabled() && current === generation
    },
    cancel() {
      generation++
    },
  }
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
    const operation = createLegacyPushOperation(enabled)
    let last: string | undefined

    createEffect(() => {
      if (!enabled()) {
        operation.cancel()
        last = undefined
        return
      }
      const next = current()
      if (!platform.setPushRelayURL || next === last) return
      const active = operation.begin()
      void platform
        .setPushRelayURL(next)
        .then(() => {
          if (active()) last = next
        })
        .catch(() => undefined)
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
