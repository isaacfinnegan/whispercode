import { describe, expect, test } from "bun:test"
import type { PushRegistration } from "./platform"
import { ServerConnection } from "./server"
import { PushHostError } from "@/utils/push-host"
import {
  createPushHostCoordinator,
  createPushHostState,
  nextPushHostRetryAt,
  pushHostRegistration,
  pushHostProviderMode,
  pushHostProviderStack,
  pushHostRetryAt,
  pushHostServerIdentity,
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

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(check()).toBe(true)
}

describe("push host state", () => {
  test("uses direct hosting only for Android without an existing legacy pairing", () => {
    expect(pushHostProviderMode("android", false)).toBe("host")
    expect(pushHostProviderMode("android", true)).toBe("legacy")
    expect(pushHostProviderMode("android", false, "https://relay.example")).toBe("legacy")
    expect(pushHostProviderMode("ios", false)).toBe("legacy")
    expect(pushHostProviderMode("web", false)).toBe("legacy")
  })

  test("keeps legacy contexts mounted while Android direct hosting is active", () => {
    expect(pushHostProviderStack("android", false)).toEqual(["relay", "pair", "host"])
    expect(pushHostProviderStack("android", true)).toEqual(["relay", "pair"])
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

  test("hashes auth-bearing server keys and persists only a sanitized display URL", async () => {
    const first = connection("https://user:password@example.com/api?token=secret-one#private")
    const second = connection("https://user:password@example.com/api?token=secret-two#private")
    const one = await pushHostServerIdentity(first)
    const two = await pushHostServerIdentity(second)

    expect(one.id).toMatch(/^ph_[0-9a-f]{64}$/)
    expect(one.server).toBe("https://example.com/api")
    expect(two.id).not.toBe(one.id)

    const state = createPushHostState()
    const key = ServerConnection.key(first)
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => undefined,
      unregister: async () => undefined,
      test: async () => undefined,
    })
    await coordinator.sync({ servers: [first], health: { [key]: true }, registration: registration(), enabled: true })
    const persisted = JSON.stringify(state.snapshot())
    expect(persisted).not.toContain("user")
    expect(persisted).not.toContain("password")
    expect(persisted).not.toContain("?token")
    expect(persisted).not.toContain("secret-one")
    expect(persisted).toContain("https://example.com/api")

    const legacy = sanitizePushHostPersisted({
      servers: {
        [ServerConnection.key(first)]: state.list()[0],
      },
    })
    expect(legacy.servers).toEqual({})
    expect(JSON.stringify(legacy)).not.toContain("secret-one")
  })

  test("resumes a persisted in-flight registration as pending", () => {
    const id = `ph_${"a".repeat(64)}`
    const persisted = sanitizePushHostPersisted({
      servers: {
        [id]: {
          server: "https://user:password@one.example/path?token=secret#private",
          device: "device-1",
          tokenGeneration: 2,
          status: "registering",
          updatedAt: 1_000,
          token: "secret-fcm-token",
        },
      },
    })

    expect(persisted.servers[id]?.status).toBe("pending")
    expect(persisted.servers[id]?.server).toBe("https://one.example/path")
    expect(JSON.stringify(persisted)).not.toContain("secret-fcm-token")
  })

  test("schedules removed unregister only when authenticated connection remains in memory", () => {
    const id = `ph_${"b".repeat(64)}`
    const pending = {
      server: "https://one",
      device: "device-1",
      tokenGeneration: 2,
      status: "unregistering" as const,
      updatedAt: 1_000,
      retryAt: 6_000,
    }
    expect(nextPushHostRetryAt([[id, pending]], [], 10_000)).toBeUndefined()
    expect(nextPushHostRetryAt([[id, pending]], [id], 10_000)).toBe(10_000)
  })
})

describe("push host coordinator", () => {
  test("shutdown unregisters active hosts and rejects later registration admission", async () => {
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    let registrations = 0
    let unregistrations = 0
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => {
        registrations++
      },
      unregister: async () => {
        unregistrations++
      },
      test: async () => undefined,
    })
    const input = { servers: [server], health: { [key]: true }, registration: registration(), enabled: true }

    await coordinator.sync(input)
    await coordinator.shutdown()
    await coordinator.sync(input)

    expect(registrations).toBe(1)
    expect(unregistrations).toBe(1)
    expect(coordinator.state(key)).toBeUndefined()
  })

  test("shutdown queues unregister behind an in-flight registration", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const events: string[] = []
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => {
        events.push("register")
        await gate
      },
      unregister: async () => {
        events.push("unregister")
      },
      test: async () => undefined,
    })

    const syncing = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: registration(),
      enabled: true,
    })
    await waitFor(() => events[0] === "register")
    const shutdown = coordinator.shutdown()
    release()
    await Promise.all([syncing, shutdown])

    expect(events).toEqual(["register", "unregister"])
    expect(coordinator.state(key)).toBeUndefined()
  })

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
    await waitFor(() => calls.length === 2)
    expect(calls).toEqual(["https://one/", "https://two"])
    pending.forEach((resolve) => resolve())
    await Promise.all([first, second])
    expect(coordinator.state(ServerConnection.key(one))?.status).toBe("active")
    expect(coordinator.state(ServerConnection.key(two))?.status).toBe("active")
  })

  test("replays the latest token generation after an in-flight registration", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const generations: number[] = []
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (_server, payload) => {
        generations.push(payload.token_generation)
        if (generations.length === 1) await gate
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    const first = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: registration(2),
      enabled: true,
    })
    await waitFor(() => generations.length === 1)
    const second = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: registration(3),
      enabled: true,
    })
    release()
    await Promise.all([first, second])

    expect(generations).toEqual([2, 3])
  })

  test("replays the latest preferences after an in-flight registration", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const complete: boolean[] = []
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (_server, payload) => {
        complete.push(payload.prefs.complete)
        if (complete.length === 1) await gate
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    const first = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: registration(),
      enabled: true,
    })
    await waitFor(() => complete.length === 1)
    const second = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: pushHostRegistration(registration(), {
        complete: false,
        approval: true,
        question: false,
        error: false,
      }),
      enabled: true,
    })
    release()
    await Promise.all([first, second])

    expect(complete).toEqual([true, false])
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
    expect(coordinator.state(key)?.status).toBe("unregistering")
    expect(JSON.stringify(state.snapshot())).not.toContain("secret-fcm-token")
    expect(coordinator.state(key)?.lastError).toEqual({
      code: "host_unavailable",
      message: "Push unregistration failed",
    })

    await coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    expect(attempts).toBe(1)
    expect(coordinator.state(key)?.status).toBe("unregistering")

    now = 6_000
    expect(coordinator.nextRetryAt(now)).toBe(now)
    await coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    expect(attempts).toBe(2)
    expect(coordinator.state(key)).toBeUndefined()
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
    expect(coordinator.state(key)).toBeUndefined()
  })

  test("retries failed manual unregister and reconciles a still-configured server", async () => {
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
    expect(coordinator.state(key)?.status).toBe("active")
  })

  test("re-add during in-flight unregister reconciles to one active registration", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let registrations = 0
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const state = createPushHostState()
    const identity = await pushHostServerIdentity(server)
    state.success(identity.id, "device-1", 2, identity.server)
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => {
        registrations++
      },
      unregister: async () => gate,
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })
    const removing = coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    await waitFor(() => coordinator.state(key)?.status === "unregistering")
    const readding = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: registration(),
      enabled: true,
    })
    release()
    await Promise.all([removing, readding])

    expect(registrations).toBe(1)
    expect(coordinator.state(key)?.status).toBe("active")
  })

  test("failed test operation preserves rejection and continues queued token rotation", async () => {
    let reject!: (error: Error) => void
    const gate = new Promise<void>((_resolve, rejectGate) => (reject = rejectGate))
    const generations: number[] = []
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (_server, payload) => {
        generations.push(payload.token_generation)
      },
      unregister: async () => undefined,
      test: async () => gate,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(2), enabled: true })
    const testing = coordinator.test(key)
    const rotating = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: registration(3),
      enabled: true,
    })
    reject(new Error("test failed"))

    await expect(testing).rejects.toThrow("test failed")
    await rotating
    expect(generations).toEqual([2, 3])
  })

  test("keeps hydrated unregister dormant until the server is re-added authenticated", async () => {
    const key = "https://one"
    const identity = await pushHostServerIdentity(connection(key))
    let attempts = 0
    const state = createPushHostState({
      [identity.id]: {
        server: identity.server,
        device: "device-1",
        tokenGeneration: 2,
        status: "unregistering",
        updatedAt: 1_000,
        retryAt: 6_000,
      },
    })
    const coordinator = createPushHostCoordinator({
      state,
      now: () => 10_000,
      register: async () => undefined,
      unregister: async () => {
        attempts++
      },
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    await coordinator.sync({ servers: [], health: {}, registration: registration(), enabled: true })
    expect(attempts).toBe(0)
    expect(state.get(identity.id)?.retryAt).toBe(6_000)
    expect(coordinator.nextRetryAt(10_000)).toBeUndefined()

    const unauthenticated = { type: "http" as const, http: { url: key } }
    await coordinator.sync({
      servers: [unauthenticated],
      health: { [key]: true },
      registration: registration(),
      enabled: true,
    })
    expect(attempts).toBe(0)
    expect(state.get(identity.id)?.status).toBe("unregistering")
    expect(coordinator.nextRetryAt(10_000)).toBeUndefined()

    await coordinator.sync({
      servers: [connection(key)],
      health: { [key]: true },
      registration: registration(),
      enabled: true,
    })
    expect(attempts).toBe(1)
    expect(coordinator.state(key)?.status).toBe("active")
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
    expect(coordinator.state(key)?.status).toBe("error")
    await coordinator.retry(key)
    expect(attempts).toBe(2)
    expect(coordinator.state(key)?.status).toBe("active")
  })
})
