import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { PushMessage, PushResult } from "@whispercode/push-provider"
import { loadDevices, register } from "./device"
import { save, type Data } from "./state"

const dirs: string[] = []
const sent: PushMessage[] = []
const used: number[] = []
let adapters = 0
let delivery = async (): Promise<PushResult> => ({ ok: true, invalid: false, code: "ok" })

mock.module("@whispercode/push-provider", () => ({
  createFcmAdapter: () => {
    const id = ++adapters
    return {
      send: async (_token: string, message: PushMessage) => {
        sent.push(message)
        used.push(id)
        return delivery()
      },
    }
  },
}))

const { default: plugin } = await import("./index")

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  delete process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID
  delete process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
  sent.splice(0)
  used.splice(0)
  adapters = 0
  delivery = async () => ({ ok: true, invalid: false, code: "ok" })
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-plugin-"))
  dirs.push(dir)
  process.env.OPENCODE_TEST_HOME = dir
  await register({
    id: "device-1",
    provider: "fcm",
    token: "device-token".padEnd(32, "x"),
    tokenGeneration: 1,
    prefs: { complete: true, approval: true, question: true, error: true },
  })
}

async function emit(hooks: Awaited<ReturnType<typeof plugin>>, session = "private-session") {
  await hooks.event?.({
    event: { type: "session.created", properties: { info: { id: session } } },
  } as never)
  await hooks.event?.({
    event: { type: "session.idle", properties: { sessionID: session } },
  } as never)
}

async function notify() {
  const hooks = await plugin({} as never)
  await emit(hooks)
}

describe("push plugin delivery", () => {
  test("reuses one FCM adapter while backend credentials are unchanged", async () => {
    await setup()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "private-key-1",
    })
    const hooks = await plugin({} as never)

    await emit(hooks, "session-1")
    await emit(hooks, "session-2")

    expect(adapters).toBe(1)
    expect(used).toEqual([1, 1])
  })

  test("creates a new FCM adapter when backend credentials rotate", async () => {
    await setup()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "private-key-1",
    })
    const hooks = await plugin({} as never)
    await emit(hooks, "session-1")

    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "private-key-2",
    })
    await emit(hooks, "session-2")

    expect(adapters).toBe(2)
    expect(used).toEqual([1, 2])
  })

  test("dispose drains an in-flight event before resolving", async () => {
    await setup()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "private-key",
    })
    let release!: (result: PushResult) => void
    let started!: () => void
    const sending = new Promise<void>((resolve) => {
      started = resolve
    })
    delivery = () =>
      new Promise<PushResult>((resolve) => {
        release = resolve
        started()
      })
    const hooks = await plugin({} as never)
    await hooks.event?.({
      event: { type: "session.created", properties: { info: { id: "session-1" } } },
    } as never)
    const pending = hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-1" } },
    } as never)
    await sending

    let disposed = false
    const disposing = hooks.dispose?.().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    release({ ok: true, invalid: false, code: "ok" })
    await disposing
    await pending
    expect(disposed).toBe(true)
  })

  test(
    "dispose returns within a bound when delivery does not settle",
    async () => {
      await setup()
      process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
      process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
        client_email: "push@example.com",
        private_key: "private-key",
      })
      let started!: () => void
      const sending = new Promise<void>((resolve) => {
        started = resolve
      })
      delivery = () =>
        new Promise<PushResult>(() => {
          started()
        })
      const hooks = await plugin({} as never)
      await hooks.event?.({
        event: { type: "session.created", properties: { info: { id: "session-1" } } },
      } as never)
      void hooks.event?.({
        event: { type: "session.idle", properties: { sessionID: "session-1" } },
      } as never)
      await sending

      expect(hooks.dispose).toBeFunction()
      const before = Date.now()
      await hooks.dispose?.()
      expect(Date.now() - before).toBeLessThan(2_500)
    },
    { timeout: 3_000 },
  )

  test("default mode routes notification events through direct delivery and not relay", async () => {
    await setup()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "not-a-real-private-key",
    })
    const requests: string[] = []
    const relay = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname)
        return Response.json({ accepted: true })
      },
    })
    try {
      await save({
        v: 1,
        mode: "local",
        root: {},
        cool: {},
        relay: { url: `http://127.0.0.1:${relay.port}`, channel: "channel", secret: "secret" },
      })

      await notify()

      const device = (await loadDevices()).devices[0]
      expect(device?.lastSuccessAt).toBeNumber()
      expect(sent).toEqual([
        {
          deviceID: "device-1",
          deliveryID: expect.any(String),
          kind: "complete",
          title: "Response ready",
          body: "Tap to return to WhisperCode",
        },
      ])
      expect(JSON.stringify(sent)).not.toContain("private-session")
      expect(JSON.stringify(sent)).not.toContain("not-a-real-private-key")
      expect(requests).toEqual([])
    } finally {
      relay.stop()
    }
  })

  test("explicit relay mode publishes only through the relay", async () => {
    await setup()
    const requests: string[] = []
    const relay = Bun.serve({
      port: 0,
      async fetch(req) {
        const route = new URL(req.url).pathname
        requests.push(route)
        if (route === "/v1/channel/checkin") return Response.json({ ok: true })
        if (route === "/v1/events/publish") return Response.json({ accepted: true })
        return new Response("not found", { status: 404 })
      },
    })
    try {
      const data: Data = {
        v: 1,
        mode: "relay",
        root: {},
        cool: {},
        relay: { url: `http://127.0.0.1:${relay.port}`, channel: "channel", secret: "secret" },
      }
      await save(data)

      await notify()

      expect(requests.filter((route) => route === "/v1/events/publish")).toHaveLength(1)
      expect((await loadDevices()).devices[0]?.lastError).toBeUndefined()
    } finally {
      relay.stop()
    }
  })

  test("explicit relay mode without relay configuration never falls back to direct delivery", async () => {
    await setup()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "private-key",
    })
    await save({ v: 1, mode: "relay", root: {}, cool: {} })

    await expect(notify()).resolves.toBeUndefined()

    expect(sent).toEqual([])
    const device = (await loadDevices()).devices[0]
    expect(device?.lastSuccessAt).toBeUndefined()
    expect(device?.lastError).toBeUndefined()
  })

  test.each([undefined, "not-json"])(
    "missing or malformed FCM configuration records a sanitized status without rejecting: %p",
    async (credentials) => {
      await setup()
      process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
      if (credentials) process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = credentials

      await expect(notify()).resolves.toBeUndefined()

      const error = (await loadDevices()).devices[0]?.lastError
      expect(error?.code).toBe("fcm_not_configured")
      expect(JSON.stringify(error)).not.toContain(credentials ?? "private-session")
    },
  )

  test.each([
    ["whitespace project ID", " ", "push@example.com", "private-key"],
    ["whitespace client email", "project-1", "\t", "private-key"],
    ["whitespace private key", "project-1", "push@example.com", "\n"],
  ])("sanitizes structurally unusable FCM configuration: %s", async (_name, project, email, key) => {
    await setup()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = project
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: email,
      private_key: key,
    })

    await expect(notify()).resolves.toBeUndefined()

    expect(sent).toEqual([])
    const error = (await loadDevices()).devices[0]?.lastError
    expect(error?.code).toBe("fcm_not_configured")
    expect(Object.keys(error ?? {}).sort()).toEqual(["at", "code"])
  })
})
