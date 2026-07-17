import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { sendPushTest } from "./push-test"

describe("push test", () => {
  test("targets the selected backend on Android", async () => {
    const calls: string[] = []
    const ok = await sendPushTest({
      mode: "host",
      platform: { platform: "android", fetch },
      selected: ServerConnection.Key.make("https://backend.example"),
      host: { test: async (server) => void calls.push(server) },
    })

    expect(ok).toBe(true)
    expect(calls).toEqual(["https://backend.example"])
  })

  test("sanitizes Android backend delivery failures", async () => {
    const error = new Error("service account secret and raw PTY output")
    await expect(
      sendPushTest({
        mode: "host",
        platform: { platform: "android", fetch },
        selected: ServerConnection.Key.make("https://backend.example"),
        host: { test: async () => Promise.reject(error) },
      }),
    ).rejects.toThrow("Backend push delivery is not configured")
  })

  test("preserves the native test path outside Android", async () => {
    const calls: Array<string | undefined> = []
    const ok = await sendPushTest({
      mode: "legacy",
      platform: {
        platform: "ios",
        fetch,
        testPush: async (href) => {
          calls.push(href)
          return true
        },
      },
      href: "/session/one",
    })

    expect(ok).toBe(true)
    expect(calls).toEqual(["/session/one"])
  })

  test("preserves the native test path for Android legacy mode without a host context", async () => {
    const calls: Array<string | undefined> = []
    const ok = await sendPushTest({
      mode: "legacy",
      platform: {
        platform: "android",
        fetch,
        testPush: async (href) => {
          calls.push(href)
          return true
        },
      },
      href: "/session/legacy",
    })

    expect(ok).toBe(true)
    expect(calls).toEqual(["/session/legacy"])
  })
})
