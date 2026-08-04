// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { initializeDeepLinks, queueDeepLink } from "./deep-link-native"

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
