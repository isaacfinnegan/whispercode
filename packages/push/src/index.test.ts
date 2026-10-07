import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import plugin from "./index"
import { load, save, type Data } from "./state"

const dirs: string[] = []

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-plugin-"))
  dirs.push(dir)
  process.env.OPENCODE_TEST_HOME = dir
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

function relayState(port: number | undefined): Data {
  return {
    v: 1,
    mode: "relay",
    root: {},
    cool: {},
    relay: { url: `http://127.0.0.1:${port}`, channel: "channel", secret: "secret" },
  }
}

describe("push plugin delivery", () => {
  test("default local mode records events without delivering anywhere", async () => {
    await setup()
    const requests: string[] = []
    const relay = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname)
        return Response.json({ accepted: true })
      },
    })
    try {
      await save({ ...relayState(relay.port), mode: "local" })

      await expect(notify()).resolves.toBeUndefined()

      expect(requests).toEqual([])
      expect((await load()).last?.kind).toBe("complete")
    } finally {
      relay.stop()
    }
  })

  test("fresh state defaults to local mode and does not deliver", async () => {
    await setup()

    await expect(notify()).resolves.toBeUndefined()

    const data = await load()
    expect(data.mode).toBe("local")
    expect(data.relay).toBeUndefined()
  })

  test("explicit relay mode publishes through the relay", async () => {
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
      await save(relayState(relay.port))

      await notify()

      expect(requests.filter((route) => route === "/v1/events/publish")).toHaveLength(1)
      expect((await load()).relay?.result).toBe("accepted")
    } finally {
      relay.stop()
    }
  })

  test("explicit relay mode without relay configuration does not reject", async () => {
    await setup()
    await save({ v: 1, mode: "relay", root: {}, cool: {} })

    await expect(notify()).resolves.toBeUndefined()

    expect((await load()).relay).toBeUndefined()
  })

  test("dispose drains an in-flight relay publish before resolving", async () => {
    await setup()
    let release!: () => void
    let started!: () => void
    const sending = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const relay = Bun.serve({
      port: 0,
      async fetch(req) {
        const route = new URL(req.url).pathname
        if (route === "/v1/events/publish") {
          started()
          await gate
          return Response.json({ accepted: true })
        }
        return Response.json({ ok: true })
      },
    })
    try {
      await save(relayState(relay.port))
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

      release()
      await disposing
      await pending
      expect(disposed).toBe(true)
    } finally {
      relay.stop(true)
    }
  })

  test(
    "dispose returns within a bound when relay publish does not settle",
    async () => {
      await setup()
      let started!: () => void
      const sending = new Promise<void>((resolve) => {
        started = resolve
      })
      const relay = Bun.serve({
        port: 0,
        fetch(req) {
          if (new URL(req.url).pathname === "/v1/events/publish") {
            started()
            return new Promise<Response>(() => {})
          }
          return Response.json({ ok: true })
        },
      })
      try {
        await save(relayState(relay.port))
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
      } finally {
        relay.stop(true)
      }
    },
    { timeout: 3_000 },
  )
})
