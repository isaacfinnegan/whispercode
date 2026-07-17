// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to cover the fork's mobile push
// settings diagnostics and toast behavior.

import { describe, expect, test } from "bun:test"
import { dict } from "../i18n/en"
import { pushHostProviderMode } from "../context/push-host"
import { PushFail } from "../utils/push-pair"
import { shouldToastPairErr } from "./settings-mobile-notifications-helpers"
import { diagRows, hostSummary } from "./settings-mobile-notifications-data"

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
