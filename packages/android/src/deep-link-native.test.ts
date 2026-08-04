// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { createDeepLinkLifecycle, initializeDeepLinks, queueDeepLink } from "./deep-link-native"

test("queues a deep link before emitting it", () => {
  const target = {} as Window & { __OPENCODE__?: { deepLinks?: string[] } }
  const uri = "opencode://open-session?server=https%3A%2F%2Fcode.example.com&session=ses_one"
  const observed: string[][] = []

  queueDeepLink(target, uri, () => observed.push([...(target.__OPENCODE__?.deepLinks ?? [])]))

  expect(target.__OPENCODE__?.deepLinks).toEqual([uri])
  expect(observed).toEqual([[uri]])
})

test("appends deep links to the existing queue", () => {
  const target = {
    __OPENCODE__: { deepLinks: ["opencode://open-project?directory=/one"] },
  } as unknown as Window & { __OPENCODE__?: { deepLinks?: string[] } }

  queueDeepLink(target, "opencode://open-session?server=https%3A%2F%2Fa&session=two", () => undefined)

  expect(target.__OPENCODE__?.deepLinks).toHaveLength(2)
})

test("acknowledges readiness only after listener registration", async () => {
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const calls: string[] = []
  const initialized = initializeDeepLinks(ready, async (method) => {
    calls.push(method)
    return null
  })

  await Promise.resolve()
  expect(calls).toEqual([])
  resolveReady?.()
  await initialized
  expect(calls).toEqual(["deepLinkListenersReady"])
})

test("does not acknowledge when listener registration fails", async () => {
  const calls: string[] = []
  await expect(
    initializeDeepLinks(Promise.reject(new Error("listener failed")), async (method) => {
      calls.push(method)
      return null
    }),
  ).rejects.toThrow("listener failed")
  expect(calls).toEqual([])
})

test("keeps the listener active until native readiness is cleared", async () => {
  let releaseNotReady: (() => void) | undefined
  const notReady = new Promise<void>((resolve) => {
    releaseNotReady = resolve
  })
  const calls: string[] = []
  let stopped = false
  const lifecycle = createDeepLinkLifecycle({
    ready: Promise.resolve(),
    send: async (method) => {
      calls.push(method)
      if (method === "deepLinkListenersNotReady") await notReady
      return null
    },
    stop: () => {
      stopped = true
    },
  })

  await lifecycle.ready
  const disposing = lifecycle.dispose()
  await Promise.resolve()

  expect(calls).toEqual(["deepLinkListenersReady", "deepLinkListenersNotReady"])
  expect(stopped).toBe(false)

  releaseNotReady?.()
  await disposing
  expect(stopped).toBe(true)
})

test("serializes a remount behind the previous native teardown", async () => {
  let releaseNotReady: (() => void) | undefined
  const notReady = new Promise<void>((resolve) => {
    releaseNotReady = resolve
  })
  const calls: string[] = []
  const send = async (method: string) => {
    calls.push(method)
    if (method === "deepLinkListenersNotReady") await notReady
    return null
  }
  const previous = createDeepLinkLifecycle({ ready: Promise.resolve(), send, stop: () => undefined })
  await previous.ready

  const disposing = previous.dispose()
  const current = createDeepLinkLifecycle({ ready: Promise.resolve(), send, stop: () => undefined })
  await Promise.resolve()
  expect(calls).toEqual(["deepLinkListenersReady", "deepLinkListenersNotReady"])

  releaseNotReady?.()
  await disposing
  await current.ready
  expect(calls).toEqual(["deepLinkListenersReady", "deepLinkListenersNotReady", "deepLinkListenersReady"])
})
