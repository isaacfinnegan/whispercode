// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { createBridge } from "./bridge"

test("maps only the retained mobile bridge operations", async () => {
  const calls: string[] = []
  const bridge = createBridge(async (command) => {
    calls.push(command)
    return null as never
  })

  for (const method of ["isWhisperReady", "startRecording", "stopRecording", "scanNetwork", "cancelScan", "share"])
    await bridge.sendAsync(method)

  expect(calls).toEqual([
    "plugin:mobile-bridge|is_whisper_ready",
    "plugin:mobile-bridge|start_recording",
    "plugin:mobile-bridge|stop_recording",
    "plugin:mobile-bridge|scan_network",
    "plugin:mobile-bridge|cancel_scan",
    "plugin:mobile-bridge|share",
  ])
})

test("removed push operations are unavailable", async () => {
  const calls: string[] = []
  const bridge = createBridge(async (command) => {
    calls.push(command)
    return null as never
  })

  for (const method of [
    "getPushState",
    "getPushRegistration",
    "pushListenersReady",
    "pushListenersNotReady",
    "requestPushPermission",
    "openSystemSettings",
    "testPush",
    "beginPushPairing",
    "getPushPairing",
    "setPushPreferences",
    "setPushRelayURL",
    "setPushCredentials",
    "clearPushPairing",
  ]) {
    await expect(bridge.sendAsync(method)).resolves.toBeNull()
  }

  expect(calls).toEqual([])
})
