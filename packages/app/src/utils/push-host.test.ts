import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import type { PushRegistration } from "@/context/platform"
import { PushPlugin, runPush } from "./push-plugin"
import {
  PushHostError,
  pushHostStatus,
  registerPushHost,
  testPushHost,
  unregisterPushHost,
  type PushHostSocket,
} from "./push-host"

const token = "fcm-secret-token"
const registration: PushRegistration = {
  version: 1,
  device: "device-1",
  provider: "fcm",
  token,
  token_generation: 3,
  prefs: { complete: true, approval: true, question: false, error: true },
}
const server: ServerConnection.Http = {
  type: "http",
  http: { url: "https://host.example.com", username: "operator", password: "password" },
}

type Plan = { ready?: boolean; output?: string; close?: boolean; deleteHang?: boolean }

async function within<T>(promise: Promise<T>, ms = 200): Promise<T> {
  const expired = Symbol("test timeout")
  let timer: ReturnType<typeof setTimeout>
  const guard = new Promise<typeof expired>((resolve) => {
    timer = setTimeout(() => resolve(expired), ms)
  })
  try {
    const result = await Promise.race([promise, guard])
    expect(result).not.toBe(expired)
    if (result === expired) throw new Error("operation exceeded the injected deadline")
    return result
  } finally {
    clearTimeout(timer!)
  }
}

function trace(plan: Plan = {}, installed = true) {
  const requests: Array<{ path: string; method: string; auth: string | null; body: string }> = []
  const stdin: string[] = []
  const output: string[] = []
  let websocketURL = ""
  let socketClosed = false
  let created = false
  let deleteAborted = false

  class Socket extends EventTarget implements PushHostSocket {
    binaryType = "blob"

    constructor(readonly url: string) {
      super()
      websocketURL = url
      queueMicrotask(() => {
        this.dispatchEvent(new Event("open"))
        if (plan.ready) this.emit('{"ready":true}\n')
        if (!plan.ready && plan.output !== undefined) this.emit(plan.output)
      })
    }

    send(value: string) {
      stdin.push(value)
      if (plan.output !== undefined) queueMicrotask(() => this.emit(plan.output!))
    }

    close() {
      socketClosed = true
      if (plan.close !== false) queueMicrotask(() => this.dispatchEvent(new Event("close")))
    }

    private emit(value: string) {
      output.push(value)
      this.dispatchEvent(new MessageEvent("message", { data: value }))
    }
  }

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === "string" ? init.body : ""
    requests.push({ path: url.pathname, method, auth: headers.get("authorization"), body })
    if (url.pathname === "/global/config" && method === "GET") {
      return Response.json({ plugin: installed ? [PushPlugin.spec] : [] })
    }
    if (url.pathname === "/global/config" && method === "PATCH") return Response.json({ plugin: [PushPlugin.spec] })
    if (url.pathname === "/global/dispose" && method === "POST") return Response.json(true)
    if (url.pathname === "/path") return Response.json({ state: "/tmp/opencode", directory: "/repo" })
    if (url.pathname === "/pty" && method === "POST") {
      created = true
      return Response.json({ id: "pty-1" })
    }
    if (url.pathname === "/pty/pty-1" && method === "DELETE") {
      if (!plan.deleteHang) return Response.json(true)
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          deleteAborted = true
          reject(new DOMException("Aborted", "AbortError"))
        }
        if (init?.signal?.aborted) abort()
        else init?.signal?.addEventListener("abort", abort, { once: true })
      })
    }
    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch

  return {
    fetch,
    socket: (url: string) => new Socket(url),
    requests,
    stdin,
    output,
    websocketURL: () => websocketURL,
    socketClosed: () => socketClosed,
    created: () => created,
    deleteAborted: () => deleteAborted,
  }
}

function hang(init: RequestInit | undefined, aborted: () => void): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = () => {
      aborted()
      reject(new DOMException("Aborted", "AbortError"))
    }
    if (init?.signal?.aborted) abort()
    else init?.signal?.addEventListener("abort", abort, { once: true })
  })
}

describe("runPush", () => {
  test("builds argv arrays without shell interpolation", () => {
    expect(runPush(["register", "--stdin"])).toEqual({
      command: "npx",
      args: ["--yes", "--prefix", ".", `--package=${PushPlugin.spec}`, PushPlugin.bin, "register", "--stdin"],
    })
    expect(runPush(["status", "--json"], "bunx")).toEqual({
      command: "bunx",
      args: [PushPlugin.spec, "status", "--json"],
    })
  })
})

describe("push host PTY", () => {
  test("overall deadline aborts a hanging host config request", async () => {
    let aborted = false
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      hang(init, () => (aborted = true))) as typeof globalThis.fetch

    const error = await within(
      registerPushHost({ server, payload: registration, fetch, timeout: 10 }).catch((cause) => cause),
    )

    expect(error).toMatchObject({ code: "push_host_timeout" })
    expect(aborted).toBe(true)
  })

  test("overall deadline aborts a hanging host refresh poll before PTY creation", async () => {
    let aborted = false
    let pty = false
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === "/global/config" && !init?.method) return Response.json({ plugin: [] })
      if (path === "/global/config" && init?.method === "PATCH") return Response.json({ plugin: [PushPlugin.spec] })
      if (path === "/global/dispose") return Response.json(true)
      if (path === "/path") return hang(init, () => (aborted = true))
      if (path === "/pty") pty = true
      return new Response("unexpected", { status: 500 })
    }) as typeof globalThis.fetch

    const error = await within(
      registerPushHost({ server, payload: registration, fetch, timeout: 10 }).catch((cause) => cause),
    )

    expect(error).toMatchObject({ code: "push_host_timeout" })
    expect(aborted).toBe(true)
    expect(pty).toBe(false)
  })

  test("overall deadline aborts a hanging PTY create request", async () => {
    let aborted = false
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      hang(init, () => (aborted = true))) as typeof globalThis.fetch

    const error = await within(pushHostStatus({ server, fetch, timeout: 10 }).catch((cause) => cause))

    expect(error).toMatchObject({ code: "push_host_timeout" })
    expect(aborted).toBe(true)
  })

  test("overall deadline bounds a hanging PTY create response body", async () => {
    let bodyStarted = false
    const fetch = (async () =>
      ({
        ok: true,
        json: () => {
          bodyStarted = true
          return new Promise(() => {})
        },
      }) as Response) as unknown as typeof globalThis.fetch

    const error = await within(pushHostStatus({ server, fetch, timeout: 10 }).catch((cause) => cause))

    expect(error).toMatchObject({ code: "push_host_timeout" })
    expect(bodyStarted).toBe(true)
  })

  test("hanging PTY deletion is bounded and does not mask success", async () => {
    const next = trace({ output: '{"mode":"direct","configured":true,"devices":[]}\n', deleteHang: true })

    const result = await within(pushHostStatus({ server, fetch: next.fetch, socket: next.socket, timeout: 10 }))

    expect(result).toEqual({ mode: "direct", configured: true, devices: [] })
    expect(next.deleteAborted()).toBe(true)
    expect(next.requests.at(-1)).toMatchObject({ path: "/pty/pty-1", method: "DELETE" })
  })

  test("hanging PTY deletion is bounded and does not mask the primary error", async () => {
    const next = trace({ output: "not-json\n", deleteHang: true })

    const error = await within(
      pushHostStatus({ server, fetch: next.fetch, socket: next.socket, timeout: 10 }).catch((cause) => cause),
    )

    expect(error).toMatchObject({ code: "push_host_invalid_response" })
    expect(next.deleteAborted()).toBe(true)
    expect(next.requests.at(-1)).toMatchObject({ path: "/pty/pty-1", method: "DELETE" })
  })

  test("synchronous PTY deletion failure does not mask the primary error", async () => {
    const next = trace({ output: "not-json\n" })
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") throw new Error("delete failed")
      return next.fetch(input, init)
    }) as typeof globalThis.fetch

    const error = await pushHostStatus({ server, fetch, socket: next.socket, timeout: 10 }).catch((cause) => cause)

    expect(error).toMatchObject({ code: "push_host_invalid_response" })
  })

  test("register sends the token only in PTY stdin after readiness", async () => {
    const next = trace({ ready: true, output: '{"ok":true,"device":"device-1","token_generation":3}\n' })

    const result = await registerPushHost({ server, payload: registration, fetch: next.fetch, socket: next.socket })

    const create = next.requests.find((request) => request.path === "/pty" && request.method === "POST")!
    expect(JSON.parse(create.body)).toEqual({
      command: "npx",
      args: ["--yes", "--prefix", ".", `--package=${PushPlugin.spec}`, PushPlugin.bin, "register", "--stdin"],
    })
    expect(JSON.stringify(create)).not.toContain(token)
    expect(next.websocketURL()).not.toContain(token)
    expect(next.stdin).toEqual([JSON.stringify(registration) + "\n"])
    expect(next.output.join("")).not.toContain(token)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(result).toEqual({ ok: true, device: "device-1", token_generation: 3 })
  })

  test("observes the refreshed backend before creating the registration PTY", async () => {
    const next = trace({ ready: true, output: '{"ok":true,"device":"device-1","token_generation":3}\n' }, false)

    await registerPushHost({ server, payload: registration, fetch: next.fetch, socket: next.socket })

    expect(next.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /global/config",
      "PATCH /global/config",
      "POST /global/dispose",
      "GET /path",
      "POST /pty",
      "DELETE /pty/pty-1",
    ])
  })

  test("does not send registration before the exact readiness marker", async () => {
    const next = trace({ ready: false, close: false })
    const job = registerPushHost({
      server,
      payload: registration,
      fetch: next.fetch,
      socket: next.socket,
      timeout: 10,
    })

    await Bun.sleep(0)
    expect(next.stdin).toEqual([])
    await expect(job).rejects.toMatchObject({ code: "push_host_timeout" })
    expect(next.stdin).toEqual([])
    expect(next.requests.at(-1)).toMatchObject({ path: "/pty/pty-1", method: "DELETE" })
  })

  test("runs non-register commands without readiness or stdin", async () => {
    const status = trace({ output: '{"mode":"direct","configured":true,"devices":[]}\n' })
    await expect(pushHostStatus({ server, fetch: status.fetch, socket: status.socket })).resolves.toEqual({
      mode: "direct",
      configured: true,
      devices: [],
    })
    expect(status.stdin).toEqual([])

    const unregister = trace({ output: '{"ok":true,"device":"device-1","active":false}\n' })
    await expect(
      unregisterPushHost({ server, device: "device-1", fetch: unregister.fetch, socket: unregister.socket }),
    ).resolves.toMatchObject({ ok: true })
    expect(unregister.stdin).toEqual([])

    const test = trace({ output: '{"ok":true,"device":"device-1"}\n' })
    await expect(
      testPushHost({ server, device: "device-1", fetch: test.fetch, socket: test.socket }),
    ).resolves.toMatchObject({
      ok: true,
    })
    expect(test.stdin).toEqual([])
  })

  test("preserves HTTP and websocket authentication and always deletes the PTY", async () => {
    const next = trace({ output: '{"mode":"direct","configured":true,"devices":[]}\n' })
    await pushHostStatus({ server, fetch: next.fetch, socket: next.socket })

    expect(next.requests.every((request) => request.auth?.startsWith("Basic "))).toBe(true)
    const url = new URL(next.websocketURL())
    expect(url.username).toBe("operator")
    expect(url.password).toBe("password")
    expect(next.socketClosed()).toBe(true)
    expect(next.requests.at(-1)).toMatchObject({ path: "/pty/pty-1", method: "DELETE" })
  })

  test("deletes the PTY and sanitizes malformed output, timeout, and output overflow", async () => {
    for (const item of [
      { plan: { output: "not-json\n" }, code: "push_host_invalid_response" },
      { plan: { close: false }, code: "push_host_timeout", timeout: 10 },
      { plan: { output: "x".repeat(32 * 1024 + 1) }, code: "push_host_output_limit" },
    ]) {
      const next = trace(item.plan)
      const error = await pushHostStatus({
        server,
        fetch: next.fetch,
        socket: next.socket,
        timeout: item.timeout,
      }).catch((cause) => cause)
      expect(error).toBeInstanceOf(PushHostError)
      expect(error.code).toBe(item.code)
      expect(error.message).not.toContain(token)
      expect(next.requests.at(-1)).toMatchObject({ path: "/pty/pty-1", method: "DELETE" })
    }
  })

  test("maps missing and old register commands to a stable upgrade error without exposing the token", async () => {
    for (const output of [
      "sh: opencode-push: command not found\n",
      "opencode-push <install|pair|status|test>\n",
      '{"ok":false,"error":"unknown_command"}\n',
    ]) {
      const next = trace({ ready: output.startsWith("{"), output })
      const error = await registerPushHost({
        server,
        payload: registration,
        fetch: next.fetch,
        socket: next.socket,
        timeout: 10,
      }).catch((cause) => cause)
      expect(error).toBeInstanceOf(PushHostError)
      expect(error.code).toBe("push_plugin_upgrade_required")
      expect(error.message).not.toContain(token)
      expect(JSON.stringify(next.requests)).not.toContain(token)
      expect(next.websocketURL()).not.toContain(token)
    }
  })

  test("redacts a token returned in a hostile command error", async () => {
    const next = trace({ ready: true, output: `${JSON.stringify({ ok: false, error: token })}\n` })

    const error = await registerPushHost({
      server,
      payload: registration,
      fetch: next.fetch,
      socket: next.socket,
    }).catch((cause) => cause)

    expect(error).toBeInstanceOf(PushHostError)
    expect(error.code).not.toContain(token)
    expect(error.message).not.toContain(token)
  })

  test("rejects a response that attempts to return the registration token", async () => {
    const next = trace({ ready: true, output: `${JSON.stringify({ ok: true, token })}\n` })

    const error = await registerPushHost({
      server,
      payload: registration,
      fetch: next.fetch,
      socket: next.socket,
    }).catch((cause) => cause)

    expect(error).toBeInstanceOf(PushHostError)
    expect(error.code).toBe("push_host_invalid_response")
    expect(error.message).not.toContain(token)
  })
})
