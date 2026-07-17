import { describe, expect, test } from "bun:test"
import type { PushRegistration } from "./platform"
import { ServerConnection } from "./server"
import { PushHostError } from "@/utils/push-host"
import {
  createPushHostCoordinator,
  createPushHostState,
  pushHostRegistration,
  pushHostProviderMode,
  pushHostRetryAt,
  sanitizePushHostPersisted,
  shouldRegister,
  shouldRetryUnregister,
} from "./push-host"

const registration = (generation = 2): PushRegistration => ({
  version: 1,
  device: "device-1",
  provider: "fcm",
  token: "secret-fcm-token",
  token_generation: generation,
  prefs: { complete: true, approval: true, question: true, error: false },
})

const connection = (url: string) => ({
  type: "http" as const,
  http: { url, password: "operator-secret" },
})

describe("push host state", () => {
  test("uses direct hosting only for Android without an existing legacy pairing", () => {
    expect(pushHostProviderMode("android", false)).toBe("host")
    expect(pushHostProviderMode("android", true)).toBe("legacy")
    expect(pushHostProviderMode("android", false, "https://relay.example")).toBe("legacy")
    expect(pushHostProviderMode("ios", false)).toBe("legacy")
    expect(pushHostProviderMode("web", false)).toBe("legacy")
  })

  test("registers once per authenticated server and token generation", () => {
    const state = createPushHostState()
    expect(shouldRegister(state, { server: "https://one", generation: 2, allowed: true })).toBe(true)
    state.success("https://one", "device-1", 2)
    expect(shouldRegister(state, { server: "https://one", generation: 2, allowed: true })).toBe(false)
    expect(shouldRegister(state, { server: "https://two", generation: 2, allowed: true })).toBe(true)
    expect(shouldRegister(state, { server: "https://one", generation: 3, allowed: true })).toBe(true)
  })

  test("re-registers with the current preference snapshot", () => {
    const next = pushHostRegistration(registration(), {
      complete: false,
      approval: true,
      question: false,
      error: true,
    })
    expect(next.prefs).toEqual({ complete: false, approval: true, question: false, error: true })
    expect(next.token).toBe("secret-fcm-token")
  })

  test("retries failed unregister with bounded backoff while retaining metadata", () => {
    let now = 1_000
    const state = createPushHostState({}, undefined, () => now)
    state.success("https://one", "device-1", 2)
    state.unregisterFailed("https://one", { code: "host_unavailable", message: "Backend unavailable" })

    expect(state.get("https://one")).toMatchObject({
      device: "device-1",
      tokenGeneration: 2,
      status: "unregistering",
      retryAt: 6_000,
    })
    expect(shouldRetryUnregister(state.get("https://one")!, 5_999)).toBe(false)
    expect(shouldRetryUnregister(state.get("https://one")!, 6_000)).toBe(true)

    now = 6_000
    state.unregisterFailed("https://one", { code: "host_unavailable", message: "Backend unavailable" })
    expect(state.get("https://one")?.retryAt).toBe(36_000)
  })

  test("uses 5s, 30s, 2m, then 10m retry intervals", () => {
    expect([0, 1, 2, 3, 4].map((attempt) => pushHostRetryAt(1_000, attempt))).toEqual([
      6_000, 31_000, 121_000, 601_000, 601_000,
    ])
  })

  test("persists only the nonsecret state shape", () => {
    const state = createPushHostState()
    state.registering("https://one", registration())
    state.failure("https://one", registration(), new Error("raw PTY output secret-fcm-token"))

    const serialized = JSON.stringify(state.snapshot())
    expect(serialized).not.toContain("secret-fcm-token")
    expect(serialized).not.toContain("raw PTY output")
    expect(state.get("https://one")?.lastError).toEqual({
      code: "push_host_failed",
      message: "Push registration failed",
    })
  })

  test("resumes a persisted in-flight registration as pending", () => {
    const persisted = sanitizePushHostPersisted({
      servers: {
        "https://one": {
          server: "https://stale-identity",
          device: "device-1",
          tokenGeneration: 2,
          status: "registering",
          updatedAt: 1_000,
          token: "secret-fcm-token",
        },
      },
    })

    expect(persisted.servers["https://one"]?.status).toBe("pending")
    expect(persisted.servers["https://one"]?.server).toBe("https://one")
    expect(JSON.stringify(persisted)).not.toContain("secret-fcm-token")
  })
})

describe("push host coordinator", () => {
  test("coalesces concurrent attempts by normalized server key while servers remain independent", async () => {
    const pending = new Map<string, () => void>()
    const calls: string[] = []
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async (server) => {
        const key = ServerConnection.key(server)
        calls.push(key)
        await new Promise<void>((resolve) => pending.set(key, resolve))
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })
    const one = connection("https://one/")
    const two = connection("https://two")
    const input = {
      servers: [one, two],
      health: { [ServerConnection.key(one)]: true, [ServerConnection.key(two)]: true },
      registration: registration(),
      enabled: true,
    }

    const first = coordinator.sync(input)
    const second = coordinator.sync(input)
    await Promise.resolve()
    expect(calls).toEqual(["https://one/", "https://two"])
    pending.forEach((resolve) => resolve())
    await Promise.all([first, second])
    expect(state.get(ServerConnection.key(one))?.status).toBe("active")
    expect(state.get(ServerConnection.key(two))?.status).toBe("active")
  })

  test("registers after server health recovers and re-registers for a new token generation", async () => {
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const generations: number[] = []
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (_server, payload) => generations.push(payload.token_generation),
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({
      servers: [server],
      health: { [key]: false },
      registration: registration(2),
      enabled: true,
    })
    expect(generations).toEqual([])
    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(2), enabled: true })
    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(2), enabled: true })
    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(3), enabled: true })
    expect(generations).toEqual([2, 3])
  })

  test("unregisters removed servers and retries a failed unregister without dropping state", async () => {
    let now = 1_000
    let attempts = 0
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const state = createPushHostState({}, undefined, () => now)
    const coordinator = createPushHostCoordinator({
      state,
      now: () => now,
      register: async () => undefined,
      unregister: async () => {
        attempts++
        if (attempts === 1) throw new PushHostError("host_unavailable", "raw PTY output secret-fcm-token")
      },
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })
    await coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    expect(attempts).toBe(1)
    expect(state.get(key)?.status).toBe("unregistering")
    expect(JSON.stringify(state.snapshot())).not.toContain("secret-fcm-token")
    expect(state.get(key)?.lastError).toEqual({
      code: "host_unavailable",
      message: "Push unregistration failed",
    })

    await coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    expect(attempts).toBe(1)
    expect(state.get(key)?.status).toBe("unregistering")

    now = 6_000
    await coordinator.retry(key)
    expect(attempts).toBe(2)
    expect(state.get(key)).toBeUndefined()
  })

  test("unregisters all active servers when every push preference is disabled", async () => {
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const removed: string[] = []
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => undefined,
      unregister: async (target) => removed.push(ServerConnection.key(target)),
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })
    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: false })
    expect(removed).toEqual([key])
    expect(state.get(key)).toBeUndefined()
  })

  test("retries failed manual unregister while the server remains configured", async () => {
    let now = 1_000
    let attempts = 0
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const state = createPushHostState({}, undefined, () => now)
    const coordinator = createPushHostCoordinator({
      state,
      now: () => now,
      register: async () => undefined,
      unregister: async () => {
        attempts++
        if (attempts === 1) throw new Error("offline")
      },
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })
    await coordinator.unregister(key)
    now = 6_000
    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })
    expect(attempts).toBe(2)
    expect(state.get(key)).toBeUndefined()
  })

  test("allows an explicit retry of failed registration", async () => {
    let attempts = 0
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => {
        attempts++
        if (attempts === 1) throw new Error("offline")
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })
    expect(state.get(key)?.status).toBe("error")
    await coordinator.retry(key)
    expect(attempts).toBe(2)
    expect(state.get(key)?.status).toBe("active")
  })
})
