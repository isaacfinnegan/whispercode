import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useGlobal } from "@/context/global"
import { type PushPrefs, type PushRegistration, type PushState, usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { Persist, persisted } from "@/utils/persist"
import { PushHostError, registerPushHost, testPushHost, unregisterPushHost } from "@/utils/push-host"
import { DEFAULT_PUSH_RELAY_URL } from "@/utils/push-relay-url"

export type HostPushState = {
  server: string
  device: string
  tokenGeneration: number
  status: "pending" | "registering" | "active" | "error" | "unregistering"
  updatedAt: number
  retryAt?: number
  lastError?: { code: string; message: string }
}

type HostPushIssue = NonNullable<HostPushState["lastError"]>
type HostPushSnapshot = Record<string, HostPushState>
type StateChange = (value: HostPushSnapshot) => void

const RETRY_MS = [5_000, 30_000, 120_000, 600_000] as const

export function pushHostProviderMode(
  platform: "web" | "desktop" | "ios" | "android",
  legacyPaired: boolean,
  relay?: string,
) {
  const customRelay = relay?.replace(/\/+$/, "") !== undefined && relay.replace(/\/+$/, "") !== DEFAULT_PUSH_RELAY_URL
  return platform === "android" && !legacyPaired && !customRelay ? "host" : "legacy"
}

export function pushHostProviderStack(
  platform: "web" | "desktop" | "ios" | "android",
  legacyPaired: boolean,
  relay?: string,
) {
  const legacy = ["relay", "pair"] as const
  return pushHostProviderMode(platform, legacyPaired, relay) === "host" ? [...legacy, "host" as const] : [...legacy]
}

export function pushHostRetryAt(now: number, attempt: number) {
  return now + RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]
}

export function nextPushHostRetryAt(
  states: HostPushState[],
  servers: ServerConnection.Any[],
  health: Record<string, boolean | undefined>,
  now: number,
) {
  const available = new Set<string>(
    servers.flatMap((server) => {
      const key = ServerConnection.key(server)
      return server.http.password && health[key] === true ? [key] : []
    }),
  )
  const retries = states.flatMap((state) =>
    state.retryAt !== undefined && available.has(state.server) ? [Math.max(now, state.retryAt)] : [],
  )
  return retries.length ? Math.min(...retries) : undefined
}

export function pushHostRegistration(registration: PushRegistration, prefs: PushPrefs): PushRegistration {
  return { ...registration, prefs }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function storedState(value: unknown): HostPushState | undefined {
  if (!isRecord(value)) return
  if (typeof value.server !== "string" || typeof value.device !== "string") return
  if (typeof value.tokenGeneration !== "number" || typeof value.updatedAt !== "number") return
  if (!["pending", "registering", "active", "error", "unregistering"].includes(String(value.status))) return
  const lastError = isRecord(value.lastError)
    ? typeof value.lastError.code === "string" && typeof value.lastError.message === "string"
      ? { code: value.lastError.code, message: value.lastError.message }
      : undefined
    : undefined
  return {
    server: value.server,
    device: value.device,
    tokenGeneration: value.tokenGeneration,
    status: value.status === "registering" ? "pending" : (value.status as HostPushState["status"]),
    updatedAt: value.updatedAt,
    retryAt: typeof value.retryAt === "number" ? value.retryAt : undefined,
    lastError,
  }
}

export function sanitizePushHostPersisted(value: unknown) {
  if (!isRecord(value) || !isRecord(value.servers)) return { servers: {} as HostPushSnapshot }
  const servers = Object.fromEntries(
    Object.entries(value.servers).flatMap(([key, item]) => {
      const state = storedState(item)
      if (!state) return []
      return [[key, { ...state, server: key }]]
    }),
  )
  return { servers }
}

function issue(error: unknown, action: "register" | "unregister"): HostPushIssue {
  const code = error instanceof PushHostError ? error.code : "push_host_failed"
  return {
    code,
    message: action === "register" ? "Push registration failed" : "Push unregistration failed",
  }
}

export function createPushHostState(
  initial: HostPushSnapshot = {},
  change?: StateChange,
  now: () => number = Date.now,
) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, { ...value }]))
  const attempts = new Map<string, number>()

  const inferAttempt = (value: HostPushState) => {
    if (value.retryAt === undefined) return 0
    const delay = value.retryAt - value.updatedAt
    const index = RETRY_MS.findIndex((item) => item === delay)
    return index === -1 ? 0 : Math.min(index + 1, RETRY_MS.length - 1)
  }
  values.forEach((value, key) => attempts.set(key, inferAttempt(value)))

  const snapshot = () => Object.fromEntries([...values].map(([key, value]) => [key, { ...value }]))
  const emit = () => change?.(snapshot())
  const set = (key: string, value: HostPushState) => {
    values.set(key, value)
    emit()
  }
  const fail = (
    server: string,
    device: string,
    tokenGeneration: number,
    error: HostPushIssue,
    status: "error" | "unregistering",
  ) => {
    const time = now()
    const attempt = attempts.get(server) ?? 0
    attempts.set(server, Math.min(attempt + 1, RETRY_MS.length - 1))
    set(server, {
      server,
      device,
      tokenGeneration,
      status,
      updatedAt: time,
      retryAt: pushHostRetryAt(time, attempt),
      lastError: error,
    })
  }

  return {
    hydrate(input: HostPushSnapshot) {
      values.clear()
      attempts.clear()
      Object.entries(input).forEach(([key, value]) => {
        values.set(key, { ...value })
        attempts.set(key, inferAttempt(value))
      })
    },
    snapshot,
    list: () => [...values.values()],
    get: (server: string) => values.get(server),
    pending(server: string) {
      const current = values.get(server)
      if (!current) return
      set(server, { ...current, status: "pending", updatedAt: now(), retryAt: undefined, lastError: undefined })
    },
    registering(server: string, payload: PushRegistration) {
      set(server, {
        server,
        device: payload.device,
        tokenGeneration: payload.token_generation,
        status: "registering",
        updatedAt: now(),
      })
    },
    success(server: string, device: string, tokenGeneration: number) {
      attempts.delete(server)
      set(server, { server, device, tokenGeneration, status: "active", updatedAt: now() })
    },
    failure(server: string, payload: PushRegistration, error: unknown) {
      fail(server, payload.device, payload.token_generation, issue(error, "register"), "error")
    },
    unregistering(server: string) {
      const current = values.get(server)
      if (!current) return
      set(server, { ...current, status: "unregistering", updatedAt: now(), retryAt: undefined, lastError: undefined })
    },
    unregisterFailed(server: string, error: HostPushIssue | unknown) {
      const current = values.get(server)
      if (!current) return
      const next =
        isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
          ? { code: error.code, message: error.message }
          : issue(error, "unregister")
      fail(server, current.device, current.tokenGeneration, next, "unregistering")
    },
    remove(server: string) {
      attempts.delete(server)
      values.delete(server)
      emit()
    },
  }
}

export type PushHostState = ReturnType<typeof createPushHostState>

export function shouldRegister(
  state: PushHostState,
  input: { server: string; generation: number; allowed: boolean; now?: number },
) {
  if (!input.allowed) return false
  const current = state.get(input.server)
  if (!current) return true
  if (current.status === "registering" || current.status === "unregistering") return false
  if (current.tokenGeneration !== input.generation) return true
  if (current.status === "active") return false
  if (current.status === "error" && current.retryAt !== undefined) return (input.now ?? Date.now()) >= current.retryAt
  return true
}

export function shouldRetryUnregister(state: HostPushState, now = Date.now()) {
  return state.status === "unregistering" && state.retryAt !== undefined && now >= state.retryAt
}

type CoordinatorInput = {
  servers: ServerConnection.Any[]
  health: Record<string, boolean | undefined>
  registration?: PushRegistration
  enabled: boolean
}

type PushHostCoordinatorOptions = {
  state: PushHostState
  register(server: ServerConnection.Any, payload: PushRegistration): Promise<unknown>
  unregister(server: ServerConnection.Any, device: string): Promise<unknown>
  test(server: ServerConnection.Any, device: string): Promise<unknown>
  now?: () => number
}

export function createPushHostCoordinator(options: PushHostCoordinatorOptions) {
  const now = options.now ?? Date.now
  const known = new Map<string, ServerConnection.Any>()
  const inflight = new Map<string, { kind: "register" | "unregister" | "test"; promise: Promise<unknown> }>()
  const desired = new Map<string, { server: ServerConnection.Any; payload: PushRegistration; signature: string }>()
  let latest: CoordinatorInput | undefined

  const run = (
    server: string,
    kind: "register" | "unregister" | "test",
    job: () => Promise<unknown>,
  ): Promise<unknown> => {
    const current = inflight.get(server)
    if (current?.kind === kind) return current.promise
    if (current) return current.promise.then(() => run(server, kind, job))
    const promise = job().finally(() => {
      if (inflight.get(server)?.promise === promise) inflight.delete(server)
    })
    inflight.set(server, { kind, promise })
    return promise
  }

  const unregister = async (server: string) => {
    const current = options.state.get(server)
    const conn = known.get(server)
    if (!current || !conn) return
    await run(server, "unregister", async () => {
      options.state.unregistering(server)
      await options.unregister(conn, current.device).then(
        () => options.state.remove(server),
        (error) => options.state.unregisterFailed(server, issue(error, "unregister")),
      )
    })
  }

  const register = (server: ServerConnection.Any, payload: PushRegistration) => {
    const key = ServerConnection.key(server)
    const signature = `${payload.token_generation}\0${JSON.stringify(payload.prefs)}`
    desired.set(key, { server, payload, signature })
    return run(key, "register", async () => {
      while (true) {
        const next = desired.get(key)
        if (!next) return
        options.state.registering(key, next.payload)
        const ok = await options.register(next.server, next.payload).then(
          () => {
            options.state.success(key, next.payload.device, next.payload.token_generation)
            return true
          },
          (error) => {
            options.state.failure(key, next.payload, error)
            return false
          },
        )
        const pending = desired.get(key)
        if (pending?.signature !== next.signature) continue
        desired.delete(key)
        if (!ok) return
        return
      }
    })
  }

  const sync = async (input: CoordinatorInput) => {
    latest = input
    input.servers.forEach((server) => known.set(ServerConnection.key(server), server))
    const current = new Set<string>(input.servers.map(ServerConnection.key))
    const currentServers = new Map<string, ServerConnection.Any>(
      input.servers.map((server) => [ServerConnection.key(server), server]),
    )
    if (!input.enabled) desired.clear()
    else [...desired.keys()].filter((key) => !current.has(key)).forEach((key) => desired.delete(key))
    const removals = options.state
      .list()
      .filter((state) => {
        if (state.status === "unregistering") {
          const conn = currentServers.get(state.server)
          if (!conn?.http.password || input.health[state.server] !== true) return false
          return state.retryAt === undefined || shouldRetryUnregister(state, now())
        }
        return !input.enabled || !current.has(state.server)
      })
      .map((state) => unregister(state.server))
    if (!input.enabled || !input.registration) {
      await Promise.all(removals)
      return
    }

    const registrations = input.servers.flatMap((server) => {
      const key = ServerConnection.key(server)
      const allowed = !!server.http.password && input.health[key] === true
      const running = inflight.get(key)?.kind === "register"
      if (allowed && running) return [register(server, input.registration!)]
      if (
        !shouldRegister(options.state, {
          server: key,
          generation: input.registration!.token_generation,
          allowed,
          now: now(),
        })
      ) {
        return []
      }
      return [register(server, input.registration!)]
    })
    await Promise.all([...removals, ...registrations])
  }

  return {
    sync,
    retry(server: string) {
      const current = options.state.get(server)
      if (!current) return Promise.resolve()
      if (current.status === "unregistering") return unregister(server).then(() => undefined)
      if (current.status !== "error" || !latest) return Promise.resolve()
      options.state.pending(server)
      return sync(latest)
    },
    unregister,
    test(server: string) {
      const current = options.state.get(server)
      const conn = known.get(server)
      if (!current || !conn) return Promise.reject(new PushHostError("push_host_not_registered"))
      return run(server, "test", () => options.test(conn, current.device)).then(() => undefined)
    },
    preferencesChanged() {
      options.state.list().forEach((state) => {
        if (state.status === "active") options.state.pending(state.server)
      })
    },
  }
}

export const { use: usePushHost, provider: PushHostProvider } = createSimpleContext({
  name: "PushHost",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const global = useGlobal()
    const server = useServer()
    const settings = useSettings()
    const [store, setStore, , ready] = persisted(
      {
        ...Persist.global("push.host", ["push.host.v1"]),
        migrate: sanitizePushHostPersisted,
      },
      createStore<{ servers: HostPushSnapshot }>({ servers: {} }),
    )
    const [runtime, setRuntime] = createStore({ generation: -1, tick: 0 })
    const state = createPushHostState({}, (value) => setStore("servers", reconcile(value)))
    let registration: PushRegistration | undefined
    let hydrated = false
    let prefsSignature: string | undefined
    let refreshID = 0

    const coordinator = createPushHostCoordinator({
      state,
      register: (target, payload) => registerPushHost({ server: target, payload, fetch: platform.fetch }),
      unregister: (target, device) => unregisterPushHost({ server: target, device, fetch: platform.fetch }),
      test: (target, device) => testPushHost({ server: target, device, fetch: platform.fetch }),
    })
    const prefs = createMemo<PushPrefs>(() => ({
      complete: settings.notifications.agent(),
      approval: settings.notifications.permissions(),
      question: settings.notifications.agent(),
      error: settings.notifications.errors(),
    }))
    const enabled = createMemo(() => Object.values(prefs()).some(Boolean))
    const bump = () => setRuntime("tick", (value) => value + 1)
    const refresh = async (observed?: PushState) => {
      if (platform.platform !== "android" || !platform.getPushRegistration) return
      const id = ++refreshID
      const push = observed ?? (await platform.getPushState?.().catch(() => platform.pushState?.()))
      if (id !== refreshID) return
      if (!push || !push.allowed || push.permission !== "authorized") {
        registration = undefined
        setRuntime("generation", -1)
        return
      }
      const next = await platform.getPushRegistration().catch(() => undefined)
      if (id !== refreshID) return
      registration = next
      setRuntime("generation", next?.token_generation ?? -1)
    }

    createEffect(() => {
      if (!ready() || hydrated) return
      hydrated = true
      state.hydrate(store.servers)
      bump()
    })

    createEffect(() => {
      const signature = JSON.stringify(prefs())
      if (prefsSignature === undefined) {
        prefsSignature = signature
        return
      }
      if (signature === prefsSignature) return
      prefsSignature = signature
      coordinator.preferencesChanged()
      bump()
    })

    createEffect(() => {
      runtime.tick
      runtime.generation
      if (!ready() || !hydrated || platform.platform !== "android") return
      const health = Object.fromEntries(
        global.servers.list().map((target) => {
          const key = ServerConnection.key(target)
          return [key, global.servers.health[key]?.healthy]
        }),
      )
      void coordinator.sync({
        servers: global.servers.list(),
        health,
        registration: registration ? pushHostRegistration(registration, prefs()) : undefined,
        enabled: enabled(),
      })
    })

    createEffect(() => {
      const retryAt = nextPushHostRetryAt(
        Object.values(store.servers),
        global.servers.list(),
        Object.fromEntries(
          global.servers.list().map((target) => {
            const key = ServerConnection.key(target)
            return [key, global.servers.health[key]?.healthy]
          }),
        ),
        Date.now(),
      )
      if (retryAt === undefined) return
      const timer = globalThis.setTimeout(bump, Math.max(0, retryAt - Date.now()))
      onCleanup(() => globalThis.clearTimeout(timer))
    })

    createEffect(() => {
      const push = platform.pushState?.()
      if (platform.platform !== "android" || !push) return
      void refresh(push).finally(bump)
    })

    onMount(() => {
      const wake = () => {
        void refresh().finally(bump)
      }
      void refresh().finally(bump)
      window.addEventListener("focus", wake)
      window.addEventListener("online", wake)
      window.addEventListener("opencode:resume", wake)
      onCleanup(() => {
        window.removeEventListener("focus", wake)
        window.removeEventListener("online", wake)
        window.removeEventListener("opencode:resume", wake)
      })
    })

    return {
      ready,
      states: () => store.servers,
      get: (key: ServerConnection.Key) => store.servers[key],
      selected: () => store.servers[server.key],
      retry: (key = server.key) => coordinator.retry(key),
      unregister: (key = server.key) => coordinator.unregister(key),
      test: (key = server.key) => coordinator.test(key),
      preferencesChanged() {
        batch(() => {
          coordinator.preferencesChanged()
          bump()
        })
      },
    }
  },
})
