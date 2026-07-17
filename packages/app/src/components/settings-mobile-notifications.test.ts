// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to cover the fork's mobile push
// settings diagnostics and toast behavior.

import { describe, expect, test } from "bun:test"
import { createComponent, type Component } from "solid-js"
import h from "solid-js/h"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { isServer, render } from "solid-js/web"
import { dict } from "../i18n/en"
import { pushHostProviderMode } from "../context/push-host"
import { PushFail } from "../utils/push-pair"
import { shouldToastPairErr } from "./settings-mobile-notifications-helpers"
import { diagRows, hostSummary } from "./settings-mobile-notifications-data"

const renderedTest = isServer ? test.skip : test

type RenderState = {
  status: "pending" | "registering" | "active" | "error" | "unregistering"
  retryAt?: number
  lastError?: { code: string; message: string }
}

type ViewProps = {
  summary: ReturnType<typeof hostSummary>
  state?: RenderState
  busy: boolean
  prefs: { agent: boolean; permissions: boolean; errors: boolean }
  labels: { agent: string; permissions: string; errors: string; retry: string; unregister: string }
  setAgent(value: boolean): void
  setPermissions(value: boolean): void
  setErrors(value: boolean): void
  retry(): void
  unregister(): void
}

function summary(input: {
  server?: string
  status?: RenderState["status"]
  retryAt?: number
  code?: string
  enabled: boolean
  available: boolean
}) {
  return hostSummary(
    input as Parameters<typeof hostSummary>[0] & {
      enabled: boolean
      available: boolean
    },
  )
}

async function renderHostView(
  initial?: Partial<{ server: string; state: RenderState; enabled: boolean; available: boolean }>,
) {
  type Factory = (...input: never[]) => unknown
  const runtime = globalThis as unknown as { React?: { createElement: Factory } }
  const previous = runtime.React
  runtime.React = { createElement: h as unknown as Factory }
  const module = await import("./settings-mobile-notifications")
  const View = (module as typeof module & { AndroidHostDeliveryView?: Component<ViewProps> }).AndroidHostDeliveryView
  expect(View).toBeFunction()
  if (!View) throw new Error("AndroidHostDeliveryView unavailable")

  const [store, setStore] = createStore({
    server: initial?.server ?? "Backend One",
    state: initial?.state as RenderState | undefined,
    enabled: initial?.enabled ?? true,
    available: initial?.available ?? true,
    prefs: { agent: true, permissions: true, errors: true },
  })
  const calls = { retry: 0, unregister: 0 }
  const container = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(View, {
        get summary() {
          return summary({
            server: store.server,
            status: store.state?.status,
            retryAt: store.state?.retryAt,
            code: store.state?.lastError?.code,
            enabled: store.enabled,
            available: store.available,
          })
        },
        get state() {
          return store.state
        },
        busy: false,
        get prefs() {
          return store.prefs
        },
        labels: {
          agent: "Agent",
          permissions: "Permissions",
          errors: "Errors",
          retry: "Retry",
          unregister: "Unregister",
        },
        setAgent: (value) => setStore("prefs", "agent", value),
        setPermissions: (value) => setStore("prefs", "permissions", value),
        setErrors: (value) => setStore("prefs", "errors", value),
        retry: () => calls.retry++,
        unregister: () => calls.unregister++,
      }),
    container,
  )
  return {
    container,
    dispose() {
      dispose()
      runtime.React = previous
    },
    store,
    setStore: setStore as SetStoreFunction<typeof store>,
    calls,
  }
}

describe("settings mobile notifications", () => {
  test("suppresses structured pairing failure toasts", () => {
    expect(
      shouldToastPairErr(
        new PushFail({
          code: "pair_claim_timeout",
          message: "still syncing",
          action: "retry",
        }),
      ),
    ).toBe(false)
    expect(shouldToastPairErr(new Error("boom"))).toBe(true)
  })

  test("keeps relay diagnostics when push diag omits relay", () => {
    const rows = diagRows({
      push: {
        supported: true,
        permission: "authorized",
        allowed: true,
        registered: true,
        paired: true,
        generic: true,
        channel: "chan-123",
      },
      info: {
        token: true,
        tokenPending: false,
        pairID: "pair-123",
        pairStatus: "active",
        pairExpires: "2026-03-16T00:00:00.000Z",
        device: "dev-123",
        lastCode: "repair_needed",
      },
      pair: {
        id: "pair-123",
        status: "active",
        channel: "chan-123",
        device: "dev-123",
      },
      paired: true,
      run: false,
      phase: undefined,
      relay: "https://relay.test",
      fallback: "https://whisper.clankercontext.com",
    })

    expect(rows).toContain("relay: https://relay.test")
    expect(rows).toContain("last_code: repair_needed")
    expect(rows.some((item) => item.startsWith("last_error:"))).toBe(true)
  })

  test("removes redundant host and relay actions from the shared mobile settings view", async () => {
    const file = Bun.file(new URL("./settings-mobile-notifications.tsx", import.meta.url))
    const text = await file.text()

    expect(text.includes('data-action="settings-push-relay"')).toBe(false)
    expect(text.includes('data-action="settings-push-host"')).toBe(false)
    expect(text.includes('data-action="settings-push-diagnostics"')).toBe(true)
  })

  test("uses provider-neutral mobile push settings copy", () => {
    const copy = Object.entries(dict)
      .filter(([key]) => key.startsWith("settings.general.notifications.push."))
      .map(([, value]) => value)
      .join("\n")

    expect(copy).not.toMatch(/\b(?:Apple|APNs|iPhone)\b/i)
  })

  test("shows the selected backend registration status without exposing failures", () => {
    expect(hostSummary({ server: "Backend One", status: "active" })).toEqual({
      variant: "success",
      title: "Active",
      body: "Backend One",
    })
    expect(hostSummary({ server: "Backend One", status: "registering" }).title).toBe("Registering")
    expect(hostSummary({ server: "Backend One", status: "error", retryAt: 1_000 }).title).toBe("Retrying")
    expect(
      hostSummary({
        server: "Backend One",
        status: "error",
        code: "fcm_unconfigured",
        message: "service account secret and raw PTY output",
      }),
    ).toEqual({
      variant: "warning",
      title: "Backend missing FCM credentials",
      body: "Backend One",
    })
    expect(
      JSON.stringify(
        hostSummary({
          server: "Backend One",
          status: "error",
          code: "push_host_failed",
          message: "token secret and raw stack",
        }),
      ),
    ).toBe('{"variant":"error","title":"Push delivery failed","body":"Backend One"}')
  })

  test("distinguishes absent, disabled, unavailable, and registering host states", () => {
    expect(summary({ server: "Backend One", enabled: true, available: true }).title).toBe("Unregistered")
    expect(summary({ server: "Backend One", enabled: false, available: true }).title).toBe("Push delivery disabled")
    expect(summary({ server: "Backend One", enabled: true, available: false }).title).toBe("Backend unavailable")
    expect(summary({ server: "Backend One", status: "registering", enabled: true, available: true }).title).toBe(
      "Registering",
    )
  })

  renderedTest("renders absent and disabled state and reacts to selected backend changes", async () => {
    const view = await renderHostView()
    expect(view.container.textContent).toContain("Unregistered")
    expect(view.container.textContent).toContain("Backend One")
    view.dispose()

    const changed = await renderHostView({ server: "Backend Two" })
    expect(changed.container.textContent).toContain("Backend Two")
    changed.dispose()

    const disabled = await renderHostView({ enabled: false })
    expect(disabled.container.textContent).toContain("Push delivery disabled")
    disabled.dispose()
  })

  renderedTest("renders an immediate retry action for failed unregister", async () => {
    const view = await renderHostView({
      state: {
        status: "unregistering",
        retryAt: Date.now() + 60_000,
        lastError: { code: "host_unavailable", message: "sanitized" },
      },
    })
    const retry = [...view.container.querySelectorAll("button")].find((button) => button.textContent === "Retry")
    expect(view.container.textContent).toContain("Retrying")
    expect(retry?.disabled).toBe(false)
    retry?.click()
    expect(view.calls.retry).toBe(1)
    view.dispose()
  })

  renderedTest("gives every notification preference switch an accessible label", async () => {
    const view = await renderHostView()
    const labels = [...view.container.querySelectorAll<HTMLElement>('[data-slot="switch-label"]')]
    const inputs = [...view.container.querySelectorAll<HTMLInputElement>('[data-slot="switch-input"]')]

    expect(labels.map((label) => label.textContent)).toEqual(["Agent", "Permissions", "Errors"])
    expect(inputs).toHaveLength(3)
    expect(inputs.every((input) => labels.some((label) => label.getAttribute("for") === input.id))).toBe(true)
    view.dispose()
  })

  test("keeps Android direct delivery separate from relay pairing controls", async () => {
    const file = Bun.file(new URL("./settings-mobile-notifications.tsx", import.meta.url))
    const text = await file.text()

    const parent = text.slice(
      text.indexOf("export const SettingsMobileNotifications"),
      text.indexOf("function AndroidDirectNotifications"),
    )
    const direct = text.slice(text.indexOf("function AndroidDirectNotifications"))

    expect(pushHostProviderMode("ios", false)).toBe("legacy")
    expect(pushHostProviderMode("android", true)).toBe("legacy")
    expect(pushHostProviderMode("android", false, "https://relay.example")).toBe("legacy")
    expect(pushHostProviderMode("android", false)).toBe("host")
    expect(parent).not.toContain("usePushHost()")
    expect(parent).toContain("when={direct()}")
    expect(direct).toContain("usePushHost()")
    expect(direct).toContain('data-component="settings-push-host"')
    expect(text).toContain('data-action="settings-push-host-retry"')
    expect(text).toContain('data-action="settings-push-host-unregister"')
    expect(text).toContain("selected: selectedKey()")
    expect(text).toContain("host: pushHost")
    expect(text).toContain("pushHostServerIdentity(value)?.id")
    expect(text).toContain('selectedHost()?.status !== "active"')
    expect(text).toContain("if (selectedKey()) pushHost.preferencesChanged()")
    expect(text).toContain('action === "retry" ? pushHost.retry(key) : pushHost.unregister(key)')
  })
})
