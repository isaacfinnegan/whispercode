import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { PushRegistration } from "@/context/platform"
import { createPushHostCoordinator, createPushHostState } from "@/context/push-host"
import { ServerConnection } from "@/context/server"
import { PushHostError, registerPushHost, type PushHostSocket } from "./push-host"

const dirs: string[] = []
const cleanups: Array<() => Promise<void>> = []
const operationTimeout = 5_000
const outputLimit = 64 * 1024
const token = "integration-ui-fcm-token".padEnd(32, "x")
const privateKey = "-----BEGIN PRIVATE KEY-----backend-only-secret-----END PRIVATE KEY-----"
const registration: PushRegistration = {
  version: 1,
  device: "device-1",
  provider: "fcm",
  token,
  token_generation: 4,
  prefs: { complete: true, approval: true, question: true, error: true },
}

function within<T>(promise: Promise<T>, timeout = operationTimeout): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("integration operation timed out")), timeout)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function backend(name: string, failure?: string) {
  const origin = `https://${name}.example`
  const password = `${name}-password`
  const home = await fs.mkdtemp(path.join(os.tmpdir(), `push-host-${name}-`))
  dirs.push(home)
  const source = path.resolve(import.meta.dir, "../../../push/src")
  const registry = path.join(home, ".local", "state", "opencode", "whisperopencode-push-devices.json")
  const requests: Array<{ url: string; body: string; auth: string | null }> = []
  const stdout: string[] = []
  const stderr: string[] = []
  const node = Bun.which("node")
  if (!node) throw new Error("node is required for PTY integration coverage")
  const harness = String.raw`
    const pty = require("@lydell/node-pty")
    const [bun, file, home, cwd, ...args] = process.argv.slice(1)
    const child = pty.spawn(bun, [file, ...args], {
      cwd,
      env: { ...process.env, OPENCODE_TEST_HOME: home },
      cols: 80,
      rows: 24,
    })
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      child.kill()
    }
    const timer = setTimeout(() => {
      process.stderr.write("PTY harness timed out")
      stop()
    }, 10000)
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => child.write(chunk))
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    child.onData((chunk) => process.stdout.write(chunk))
    child.onExit(({ exitCode }) => {
      clearTimeout(timer)
      process.exit(exitCode)
    })
  `
  const start = (args: string[]) =>
    Bun.spawn([node, "-e", harness, process.execPath, path.join(source, "cli.ts"), home, source, ...args], {
      cwd: source,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
  type Child = ReturnType<typeof start>
  type Entry = { child: Child; readers: Promise<void>[] }
  const children = new Map<string, Entry>()
  const deliveries = new Set<ReturnType<typeof Bun.spawn>>()
  let sequence = 0
  let cliRuns = 0
  let socketURL = ""
  let disposed = false

  const pump = async (stream: ReadableStream<Uint8Array>, output: string[], receive?: (value: string) => void) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) break
        bytes += result.value.byteLength
        if (bytes > outputLimit) throw new Error("integration output limit exceeded")
        const value = decoder.decode(result.value, { stream: true })
        if (!value) continue
        output.push(value)
        receive?.(value)
      }
      const value = decoder.decode()
      if (value) {
        output.push(value)
        receive?.(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  const terminate = async (entry: Entry) => {
    if (entry.child.exitCode === null) entry.child.kill("SIGTERM")
    await within(entry.child.exited).catch(async () => {
      if (entry.child.exitCode === null) entry.child.kill("SIGKILL")
      await within(entry.child.exited)
    })
    await within(Promise.allSettled(entry.readers).then(() => undefined))
  }

  const stop = async (id: string) => {
    const entry = children.get(id)
    if (!entry) return
    children.delete(id)
    await terminate(entry)
  }

  const dispose = async () => {
    if (disposed) return
    disposed = true
    await Promise.allSettled([...children.keys()].map(stop))
    await Promise.allSettled(
      [...deliveries].map(async (child) => {
        if (child.exitCode === null) child.kill("SIGTERM")
        await within(child.exited).catch(async () => {
          if (child.exitCode === null) child.kill("SIGKILL")
          await within(child.exited)
        })
      }),
    )
    deliveries.clear()
  }
  cleanups.push(dispose)

  class Socket extends EventTarget implements PushHostSocket {
    binaryType = "blob"
    private readonly child: Child

    constructor(url: string) {
      super()
      socketURL = url
      const id = new URL(url).pathname.split("/").at(-2)!
      const entry = children.get(id)
      if (!entry) throw new Error("missing PTY child")
      this.child = entry.child
      entry.readers.push(
        pump(entry.child.stdout, stdout, (value) =>
          this.dispatchEvent(new MessageEvent("message", { data: value })),
        ).catch(() => {
          this.dispatchEvent(new Event("error"))
        }),
        pump(entry.child.stderr, stderr).catch(() => undefined),
      )
      queueMicrotask(() => this.dispatchEvent(new Event("open")))
    }

    send(value: string) {
      if (failure) {
        this.child.kill()
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", { data: `${JSON.stringify({ ok: false, error: failure })}\n` }),
          ),
        )
        return
      }
      this.child.stdin.write(value)
    }

    close() {}
  }

  const expected = `Basic ${btoa(`operator:${password}`)}`
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = typeof init?.body === "string" ? init.body : ""
    const auth = new Headers(init?.headers).get("authorization")
    requests.push({ url: url.toString(), body, auth })
    if (auth !== expected) return new Response("unauthorized", { status: 401 })
    if (url.pathname === "/global/config") return Response.json({ plugin: ["@whisperopencode/push"] })
    if (url.pathname === "/path") return Response.json({ directory: "/repo" })
    if (url.pathname === "/pty" && init?.method === "POST") {
      const spec = JSON.parse(body) as { command?: string; args?: string[] }
      const wrapped = spec.args?.[2] ? (JSON.parse(spec.args[2]) as string[]) : []
      const bin = wrapped.indexOf("opencode-push")
      if (spec.command !== "node" || spec.args?.[0] !== "-e" || bin === -1) {
        return new Response("invalid push command", { status: 400 })
      }
      const id = `pty-${++sequence}`
      cliRuns++
      children.set(id, { child: start(wrapped.slice(bin + 1)), readers: [] })
      return Response.json({ id })
    }
    if (url.pathname.endsWith("/connect-token")) return Response.json({ ticket: `ticket-${name}` })
    if (url.pathname.startsWith("/pty/") && init?.method === "DELETE") {
      const id = url.pathname.split("/").at(-1)!
      await stop(id)
      return Response.json(true)
    }
    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch

  return {
    origin,
    password,
    requests,
    stdout,
    stderr,
    get cliRuns() {
      return cliRuns
    },
    active: () => children.size + deliveries.size,
    fetch,
    socket: (url: string) => new Socket(url),
    socketURL: () => socketURL,
    readRegistry: () => within(fs.readFile(registry, "utf8").then(JSON.parse)),
    registryMode: () => within(fs.stat(registry).then((stat) => stat.mode & 0o777)),
    dispose,
    async publish(kind: "complete" | "approval", fail = false) {
      const event =
        kind === "complete"
          ? { type: "session.idle", properties: { sessionID: `${name}-session` } }
          : { type: "permission.asked", properties: { id: `${name}-request`, sessionID: `${name}-session` } }
      const script = String.raw`
        import { mock } from "bun:test"
        const sent = []
        mock.module("@whispercode/push-provider", () => ({
          createFcmAdapter: () => ({
            send: async (value, message) => {
              sent.push({ tokenMatched: value === process.env.EXPECTED_TOKEN, message })
              if (process.env.FAIL_SEND === "1") throw new Error(process.env.PRIVATE_KEY_SENTINEL)
              return { ok: true, invalid: false, code: "ok" }
            },
          }),
        }))
        const { default: plugin } = await import(${JSON.stringify(path.join(source, "index.ts"))})
        const hooks = await plugin({})
        await hooks.event({ event: ${JSON.stringify(event)} })
        process.stdout.write(JSON.stringify(sent))
      `
      const argv = [process.execPath, "-e", script]
      const child = Bun.spawn(argv, {
        cwd: source,
        env: {
          ...process.env,
          OPENCODE_TEST_HOME: home,
          EXPECTED_TOKEN: token,
          FAIL_SEND: fail ? "1" : "0",
          PRIVATE_KEY_SENTINEL: privateKey,
          WHISPEROPENCODE_PUSH_FCM_PROJECT_ID: "integration-project",
          WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
            client_email: "push@example.test",
            private_key: privateKey,
          }),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      deliveries.add(child)
      const output = new Response(child.stdout).text()
      const error = new Response(child.stderr).text()
      try {
        const [status, result, logs] = await within(Promise.all([child.exited, output, error]))
        return {
          status,
          output: result,
          error: logs,
          argv,
          sends: JSON.parse(result) as Array<{ tokenMatched: boolean; message: { kind: string; deviceID: string } }>,
        }
      } finally {
        if (child.exitCode === null) child.kill("SIGTERM")
        await within(child.exited).catch(async () => {
          if (child.exitCode === null) child.kill("SIGKILL")
          await within(child.exited)
        })
        await within(Promise.allSettled([output, error]).then(() => undefined))
        deliveries.delete(child)
      }
    },
  }
}

describe("push host integration security", () => {
  test("joins coordinator, authenticated PTY transport, CLI registries, and direct delivery for two backends", async () => {
    const one = await backend("one")
    const two = await backend("two")
    const servers = [one, two].map((item) => ({
      type: "http" as const,
      http: { url: item.origin, username: "operator", password: item.password },
    }))
    const state = createPushHostState()
    const coordinator = createPushHostCoordinator({
      state,
      register: (server, payload) => {
        const target = server.http.url === one.origin ? one : two
        return registerPushHost({
          server,
          payload,
          fetch: target.fetch,
          socket: target.socket,
          timeout: operationTimeout,
        })
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await within(
      coordinator.sync({
        servers,
        health: Object.fromEntries(servers.map((server) => [ServerConnection.key(server), true])),
        registration,
        enabled: true,
      }),
      operationTimeout * 2,
    )

    const registries = await Promise.all([one.readRegistry(), two.readRegistry()])
    expect([one.cliRuns, two.cliRuns]).toEqual([1, 1])
    expect(one.stdout.join("")).toContain('{"ready":true}')
    expect(two.stdout.join("")).toContain('{"ready":true}')
    expect([one.active(), two.active()]).toEqual([0, 0])
    expect(registries.map((item) => item.devices.map((device: { id: string }) => device.id))).toEqual([
      ["device-1"],
      ["device-1"],
    ])
    expect(registries[0].devices[0]).toMatchObject({ token, provider: "fcm", tokenGeneration: 4, active: true })
    expect(registries[1].devices[0]).toMatchObject({ token, provider: "fcm", tokenGeneration: 4, active: true })
    expect(await Promise.all([one.registryMode(), two.registryMode()])).toEqual([0o600, 0o600])

    const [complete, approval] = await within(Promise.all([one.publish("complete"), two.publish("approval")]))
    expect([complete.status, approval.status]).toEqual([0, 0])
    expect(complete.sends).toEqual([
      { tokenMatched: true, message: expect.objectContaining({ kind: "complete", deviceID: "device-1" }) },
    ])
    expect(approval.sends).toEqual([
      { tokenMatched: true, message: expect.objectContaining({ kind: "approval", deviceID: "device-1" }) },
    ])
    expect(state.list().map((item) => item.status)).toEqual(["active", "active"])

    const artifacts = JSON.stringify({
      argvAndCreateBodies: [one, two].flatMap((item) => item.requests.map((request) => request.body)),
      httpURLs: [one, two].flatMap((item) => item.requests.map((request) => request.url)),
      ptyURLs: [one.socketURL(), two.socketURL()],
      cliOutput: [one.stdout, one.stderr, two.stdout, two.stderr],
      pluginArgv: [complete.argv, approval.argv],
      pluginLogs: [complete.output, complete.error, approval.output, approval.error],
      persistedAppState: state.snapshot(),
    })
    expect(artifacts).not.toContain(token)
    expect(artifacts).not.toContain(privateKey)
    expect([one, two].flatMap((item) => item.requests).every((request) => request.auth?.startsWith("Basic "))).toBe(
      true,
    )
  })

  test("sanitizes token-bearing transport errors", async () => {
    const target = await backend("error", token)
    const server = {
      type: "http" as const,
      http: { url: target.origin, username: "operator", password: target.password },
    }

    const error = await registerPushHost({
      server,
      payload: registration,
      fetch: target.fetch,
      socket: target.socket,
      timeout: operationTimeout,
    }).catch((cause) => cause)

    expect(error).toBeInstanceOf(PushHostError)
    expect(JSON.stringify({ name: error.name, code: error.code, message: error.message })).not.toContain(token)
    expect(target.active()).toBe(0)
  })

  test("sanitizes backend configuration and adapter errors containing the private key", async () => {
    const target = await backend("delivery-error")
    const server = {
      type: "http" as const,
      http: { url: target.origin, username: "operator", password: target.password },
    }
    await registerPushHost({
      server,
      payload: registration,
      fetch: target.fetch,
      socket: target.socket,
      timeout: operationTimeout,
    })

    const failed = await target.publish("complete", true)
    const registry = await target.readRegistry()
    const artifacts = JSON.stringify({
      argv: failed.argv,
      logs: [failed.output, failed.error],
      status: registry.devices.map((device: { lastError?: unknown }) => device.lastError),
    })
    expect(failed.sends).toHaveLength(1)
    expect(registry.devices[0].lastError).toMatchObject({ code: "delivery_failed", at: expect.any(Number) })
    expect(artifacts).not.toContain(token)
    expect(artifacts).not.toContain(privateKey)
    expect(target.active()).toBe(0)
  })
})
