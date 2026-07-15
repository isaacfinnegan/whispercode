// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { createBridge } from "./bridge"
import { isPushHref, normalizePair, normalizePush, queuePushDeepLink, routePushHref } from "./push-native"

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

test("listeners expose registration readiness", async () => {
  let register: (() => void) | undefined
  const bridge = createBridge(
    async () => null as never,
    () =>
      new Promise((resolve) => {
        register = () => resolve({ unregister: async () => {} })
      }),
  )

  const stop = bridge.on("pushOpened", () => {})
  let ready = false
  void stop.ready.then(() => {
    ready = true
  })
  expect(ready).toBe(false)
  register?.()
  await stop.ready
  expect(ready).toBe(true)
})

test("listeners reject readiness when registration fails", async () => {
  const bridge = createBridge(
    async () => null as never,
    async () => {
      throw new Error("listener registration failed")
    },
  )

  await expect(bridge.on("pushOpened", () => {}).ready).rejects.toThrow("listener registration failed")
})

test("native push initialization acknowledges listener readiness before requesting state", async () => {
  const calls: string[] = []
  const initialize = (
    (await import("./push-native")) as {
      initializeNativePush?: (
        ready: Promise<unknown>,
        send: (method: string) => Promise<unknown>,
        setPush: (state: typeof push) => void,
      ) => Promise<void>
    }
  ).initializeNativePush

  expect(initialize).toBeDefined()
  if (!initialize) return

  await initialize(
    Promise.resolve(),
    async (method) => {
      calls.push(method)
      return push
    },
    () => {},
  )

  expect(calls).toEqual(["pushListenersReady", "getPushState"])
})

test("native push initialization skips state when listener acknowledgment fails", async () => {
  const calls: string[] = []
  const initialize = (
    (await import("./push-native")) as {
      initializeNativePush?: (
        ready: Promise<unknown>,
        send: (method: string) => Promise<unknown>,
        setPush: (state: typeof push) => void,
      ) => Promise<void>
    }
  ).initializeNativePush

  expect(initialize).toBeDefined()
  if (!initialize) return

  await expect(
    initialize(
      Promise.resolve(),
      async (method) => {
        calls.push(method)
        throw new Error("listener acknowledgment failed")
      },
      () => {},
    ),
  ).rejects.toThrow("listener acknowledgment failed")

  expect(calls).toEqual(["pushListenersReady"])
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

test("routePushHref uses router navigation and the deep-link event", () => {
  const routes: string[] = []
  const deepLinks: string[] = []

  expect(
    routePushHref(
      "/session/abc",
      (href) => routes.push(href),
      (href) => deepLinks.push(href),
    ),
  ).toBe(true)
  expect(routes).toEqual(["/session/abc"])
  expect(deepLinks).toEqual([])

  expect(
    routePushHref(
      "opencode://new-session?directory=%2Ftmp%2Fdemo",
      (href) => routes.push(href),
      (href) => deepLinks.push(href),
    ),
  ).toBe(true)
  expect(deepLinks).toEqual(["opencode://new-session?directory=%2Ftmp%2Fdemo"])
  expect(
    routePushHref(
      "https://example.com",
      () => {},
      () => {},
    ),
  ).toBe(false)
})

test("queuePushDeepLink appends before dispatch for a cold-start layout drain", () => {
  const target: { __OPENCODE__?: { deepLinks?: string[] } } = {}
  const href = "opencode://open-project?directory=%2Ftmp%2Fdemo"
  let queuedAtDispatch: string[] | undefined

  queuePushDeepLink(target, href, () => {
    queuedAtDispatch = target.__OPENCODE__?.deepLinks
  })

  expect(queuedAtDispatch).toEqual([href])
  expect(target.__OPENCODE__?.deepLinks).toEqual([href])
})
