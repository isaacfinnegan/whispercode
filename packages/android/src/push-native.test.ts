// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { createBridge } from "./bridge"
import { isPushHref, normalizePair, normalizePush } from "./push-native"

const push = {
  supported: true,
  permission: "authorized",
  allowed: true,
  registered: true,
  paired: true,
  generic: false,
  channel: "fcm",
  diag: {
    token: true,
    tokenPending: false,
    relay: "https://relay.example.com",
  },
}

test("normalizePush rejects partial native state payloads", () => {
  expect(normalizePush({ ...push, permission: undefined })).toBeNull()
  expect(normalizePush({ ...push, paired: undefined })).toBeNull()
})

test("normalizePush accepts a complete native PushState", () => {
  expect(normalizePush(push)).toEqual(push)
})

test("normalizePair preserves canonical PairInfo fields", () => {
  expect(
    normalizePair({
      id: "pair-1",
      status: "pending",
      token: "token",
      command: "claim",
      expires: "2026-07-15T00:00:00Z",
      channel: "fcm",
      device: "device-1",
      message: "Pair this device",
    }),
  ).toEqual({
    id: "pair-1",
    status: "pending",
    token: "token",
    command: "claim",
    expires: "2026-07-15T00:00:00Z",
    channel: "fcm",
    device: "device-1",
    message: "Pair this device",
  })
})

test("mapped commands preserve native rejection messages", async () => {
  const bridge = createBridge(async () => {
    throw new Error("pair_not_found")
  })

  await expect(bridge.sendAsync("testPush")).rejects.toThrow("pair_not_found")
  await expect(bridge.sendAsync("unknown")).resolves.toBeNull()
})

test("isPushHref only accepts app-relative and approved deep links", () => {
  expect(isPushHref("/session/abc")).toBe(true)
  expect(isPushHref("opencode://open-project?directory=%2Ftmp%2Fdemo")).toBe(true)
  expect(isPushHref("opencode://new-session?directory=%2Ftmp%2Fdemo")).toBe(true)
  expect(isPushHref("javascript:alert(1)")).toBe(false)
  expect(isPushHref("file:///tmp/demo")).toBe(false)
  expect(isPushHref("https://example.com")).toBe(false)
  expect(isPushHref("//example.com")).toBe(false)
  expect(isPushHref("opencode://other?directory=%2Ftmp%2Fdemo")).toBe(false)
})
