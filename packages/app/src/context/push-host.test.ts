import { describe, expect, test } from "bun:test"
import type { PushRegistration } from "./platform"
import { ServerConnection } from "./server"
import { PushHostError } from "@/utils/push-host"
import {
  createPushHostCoordinator,
  createPushHostRetryTimer,
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

  test("uses a synchronous credential-free canonical origin identity", async () => {
    const first = connection("https://user:password@example.com/api?token=secret-one#private")
    const second = connection("https://user:password@example.com/api?token=secret-two#private")
    const other = connection("https://example.com:444/api?token=secret-one")
    const one = pushHostServerIdentity(first)
    const two = pushHostServerIdentity(second)

    expect(one).toEqual({ id: "https://example.com", server: "https://example.com" })
    expect(two).toEqual(one)
    expect(pushHostServerIdentity(other)?.id).toBe("https://example.com:444")
    expect(
      pushHostServerIdentity({
        type: "sidecar",
        variant: "base",
        http: { url: "http://localhost:4096" },
      }),
    ).toBeUndefined()

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
    expect(persisted).toContain("https://example.com")

    const legacy = sanitizePushHostPersisted({
      servers: {
        [ServerConnection.key(first)]: state.list()[0],
        "https://example.com": state.list()[0],
      },
    })
    expect(legacy.servers).toEqual({})
    expect(JSON.stringify(legacy)).not.toContain("secret-one")
  })

  test("resumes a persisted in-flight registration as pending", () => {
    const id = "https://one.example"
    const persisted = sanitizePushHostPersisted({
      version: 2,
      servers: {
        [id]: {
          server: id,
          device: "device-1",
          tokenGeneration: 2,
          status: "registering",
          updatedAt: 1_000,
          token: "secret-fcm-token",
        },
      },
    })

    expect(persisted.servers[id]?.status).toBe("pending")
    expect(persisted.servers[id]?.server).toBe(id)
    expect(JSON.stringify(persisted)).not.toContain("secret-fcm-token")
  })

  test("schedules removed unregister only when authenticated connection remains in memory", () => {
    const id = "https://one"
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
  test("scopes the first successful direct registration to only that backend", async () => {
    const one = connection("https://one")
    const two = connection("https://two")
    const oneKey = ServerConnection.key(one)
    const twoKey = ServerConnection.key(two)
    const calls: string[] = []
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async (server) => calls.push(ServerConnection.key(server)),
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [one], health: { [oneKey]: true }, registration: registration(), enabled: true })
    expect(calls).toEqual([oneKey])
    expect(coordinator.state(oneKey)?.status).toBe("active")
    expect(coordinator.state(twoKey)).toBeUndefined()

    await coordinator.sync({
      servers: [one, two],
      health: { [oneKey]: true, [twoKey]: true },
      registration: registration(),
      enabled: true,
    })
    expect(calls).toEqual([oneKey, twoKey])
    expect(coordinator.state(oneKey)?.status).toBe("active")
    expect(coordinator.state(twoKey)?.status).toBe("active")
  })

  test("keeps direct diagnostics and persisted state free of registration and backend secrets", async () => {
    const server = connection("https://one/path?private=transport-secret")
    const key = ServerConnection.key(server)
    const serviceKey = "backend-service-account-private-key"
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: async () => {
        throw new PushHostError("host_unavailable", `transport failed with ${serviceKey} for ${registration().token}`)
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({ servers: [server], health: { [key]: true }, registration: registration(), enabled: true })

    const diagnostics = JSON.stringify(coordinator.state(key))
    const persisted = JSON.stringify(sanitizePushHostPersisted({ version: 2, servers: state.snapshot() }))
    for (const secret of [registration().token, serviceKey, "operator-secret", "transport-secret"]) {
      expect(diagnostics).not.toContain(secret)
      expect(persisted).not.toContain(secret)
    }
    expect(coordinator.state(key)?.lastError).toEqual({
      code: "host_unavailable",
      message: "Push registration failed",
    })
  })

  test("deduplicates configured connections with the same canonical origin", async () => {
    const first = connection("https://one/path?workspace=first")
    const second = connection("https://one/other?workspace=second")
    const calls: string[] = []
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (server) => calls.push(server.http.url),
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({
      servers: [first, second],
      health: { [ServerConnection.key(first)]: true, [ServerConnection.key(second)]: true },
      registration: registration(),
      enabled: true,
    })

    expect(calls).toEqual([first.http.url])
    expect(coordinator.state(ServerConnection.key(second))?.status).toBe("active")
  })

  test("selects the first authenticated healthy alias for a canonical origin", async () => {
    const first = { type: "http" as const, http: { url: "https://one/unavailable" } }
    const second = connection("https://one/ready")
    const third = connection("https://one/also-ready")
    const calls: string[] = []
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (server) => calls.push(server.http.url),
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({
      servers: [first, second, third],
      health: {
        [ServerConnection.key(first)]: false,
        [ServerConnection.key(second)]: true,
        [ServerConnection.key(third)]: true,
      },
      registration: registration(),
      enabled: true,
    })

    expect(calls).toEqual([second.http.url])
  })

  test("arms a hydrated future retry after readiness and coordinator mapping change", () => {
    let ready = false
    let revision = 0
    let mapped = false
    let timer: { delay: number; wake: () => void } | undefined
    let wakes = 0

    createPushHostRetryTimer({
      ready,
      retryAt: () => (mapped ? 6_000 : undefined),
      now: () => 1_000,
      wake: () => wakes++,
      schedule: (wake, delay) => {
        timer = { delay, wake }
        return 1
      },
      cancel: () => undefined,
    })

    ready = true
    expect(timer).toBeUndefined()
    mapped = true
    revision++
    createPushHostRetryTimer({
      ready,
      retryAt: () => (revision === 1 && mapped ? 6_000 : undefined),
      now: () => 1_000,
      wake: () => wakes++,
      schedule: (wake, delay) => {
        timer = { delay, wake }
        return 1
      },
      cancel: () => undefined,
    })
    expect(timer?.delay).toBe(5_000)
    timer?.wake()
    expect(wakes).toBe(1)
  })

  test("concurrent syncs finish with the newest generation and preferences", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const seen: Array<[number, boolean]> = []
    const server = connection("https://one")
    const key = ServerConnection.key(server)
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
      register: async (_server, payload) => {
        seen.push([payload.token_generation, payload.prefs.complete])
        if (seen.length === 1) await gate
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
    const third = coordinator.sync({
      servers: [server],
      health: { [key]: true },
      registration: pushHostRegistration(registration(3), {
        complete: false,
        approval: true,
        question: false,
        error: true,
      }),
      enabled: true,
    })
    release()
    await Promise.all([first, third])

    expect(seen).toEqual([
      [2, true],
      [3, false],
    ])
    expect(coordinator.state(key)?.tokenGeneration).toBe(3)
  })

  test("hydrates canonical active and due error states without a side mapping", async () => {
    const server = connection("https://one/path?token=private")
    const activeServer = connection("https://two/other?token=private")
    const key = ServerConnection.key(server)
    const activeKey = ServerConnection.key(activeServer)
    const id = "https://one"
    const state = createPushHostState({
      [id]: {
        server: id,
        device: "device-1",
        tokenGeneration: 2,
        status: "error",
        updatedAt: 1_000,
        retryAt: 6_000,
      },
      "https://two": {
        server: "https://two",
        device: "device-1",
        tokenGeneration: 2,
        status: "active",
        updatedAt: 1_000,
      },
    })
    let registrations = 0
    const coordinator = createPushHostCoordinator({
      state,
      now: () => 10_000,
      register: async () => {
        registrations++
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    expect(state.get(id)?.status).toBe("error")
    expect(coordinator.state(activeKey)?.status).toBe("active")
    await coordinator.sync({
      servers: [server, activeServer],
      health: { [key]: true, [activeKey]: true },
      registration: registration(2),
      enabled: true,
    })
    expect(registrations).toBe(1)
    expect(coordinator.state(key)?.status).toBe("active")
    expect(coordinator.state(activeKey)?.status).toBe("active")
  })

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

  test("shutdown during initial sync unregisters synchronously admitted registration", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const events: string[] = []
    const server = connection("https://one/path?token=private")
    const key = ServerConnection.key(server)
    const coordinator = createPushHostCoordinator({
      state: createPushHostState(),
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
    const shutdown = coordinator.shutdown()
    release()
    await Promise.all([syncing, shutdown])

    expect(events).toEqual(["register", "unregister"])
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
    const identity = pushHostServerIdentity(server)!
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
    const identity = pushHostServerIdentity(connection(key))!
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
