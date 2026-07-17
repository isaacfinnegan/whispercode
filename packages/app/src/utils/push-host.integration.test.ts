import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { PushRegistration } from "@/context/platform"
import { createPushHostCoordinator, createPushHostState } from "@/context/push-host"
import { ServerConnection } from "@/context/server"
import { PushHostError, registerPushHost, type PushHostSocket } from "./push-host"

const dirs: string[] = []
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

afterEach(async () => {
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
  const start = (args: string[]) =>
    Bun.spawn(args, {
      cwd: source,
      env: { ...process.env, OPENCODE_TEST_HOME: home },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
  type Child = ReturnType<typeof start>
  const children = new Map<string, Child>()
  let sequence = 0
  let cliRuns = 0
  let socketURL = ""

  class Socket extends EventTarget implements PushHostSocket {
    binaryType = "blob"
    private readonly child: Child

    constructor(url: string) {
      super()
      socketURL = url
      const id = new URL(url).pathname.split("/").at(-2)!
      const child = children.get(id)
      if (!child) throw new Error("missing PTY child")
      this.child = child
      void new Response(child.stdout).text().then((value) => {
        stdout.push(value)
        if (value) this.dispatchEvent(new MessageEvent("message", { data: value }))
      })
      void new Response(child.stderr).text().then((value) => stderr.push(value))
      queueMicrotask(() => {
        this.dispatchEvent(new Event("open"))
        this.dispatchEvent(new MessageEvent("message", { data: '{"ready":true}\n' }))
      })
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
      this.child.stdin.end()
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
      children.set(id, start([process.execPath, path.join(source, "cli.ts"), ...wrapped.slice(bin + 1)]))
      return Response.json({ id })
    }
    if (url.pathname.endsWith("/connect-token")) return Response.json({ ticket: `ticket-${name}` })
    if (url.pathname.startsWith("/pty/") && init?.method === "DELETE") {
      const id = url.pathname.split("/").at(-1)!
      const child = children.get(id)
      if (child && child.exitCode === null) child.kill()
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
    fetch,
    socket: (url: string) => new Socket(url),
    socketURL: () => socketURL,
    readRegistry: () => fs.readFile(registry, "utf8").then(JSON.parse),
    registryMode: () => fs.stat(registry).then((stat) => stat.mode & 0o777),
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
      const [status, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return {
        status,
        output,
        error,
        argv,
        sends: JSON.parse(output) as Array<{ tokenMatched: boolean; message: { kind: string; deviceID: string } }>,
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
        return registerPushHost({ server, payload, fetch: target.fetch, socket: target.socket })
      },
      unregister: async () => undefined,
      test: async () => undefined,
    })

    await coordinator.sync({
      servers,
      health: Object.fromEntries(servers.map((server) => [ServerConnection.key(server), true])),
      registration,
      enabled: true,
    })

    const registries = await Promise.all([one.readRegistry(), two.readRegistry()])
    expect([one.cliRuns, two.cliRuns]).toEqual([1, 1])
    expect(registries.map((item) => item.devices.map((device: { id: string }) => device.id))).toEqual([
      ["device-1"],
      ["device-1"],
    ])
    expect(registries[0].devices[0]).toMatchObject({ token, provider: "fcm", tokenGeneration: 4, active: true })
    expect(registries[1].devices[0]).toMatchObject({ token, provider: "fcm", tokenGeneration: 4, active: true })
    expect(await Promise.all([one.registryMode(), two.registryMode()])).toEqual([0o600, 0o600])

    const [complete, approval] = await Promise.all([one.publish("complete"), two.publish("approval")])
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
    }).catch((cause) => cause)

    expect(error).toBeInstanceOf(PushHostError)
    expect(JSON.stringify({ name: error.name, code: error.code, message: error.message })).not.toContain(token)
  })

  test("sanitizes backend configuration and adapter errors containing the private key", async () => {
    const target = await backend("delivery-error")
    const server = {
      type: "http" as const,
      http: { url: target.origin, username: "operator", password: target.password },
    }
    await registerPushHost({ server, payload: registration, fetch: target.fetch, socket: target.socket })

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
  })
})
