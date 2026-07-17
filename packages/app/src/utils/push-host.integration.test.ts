import { describe, expect, test } from "bun:test"
import type { PushRegistration } from "@/context/platform"
import { createPushHostCoordinator, createPushHostState } from "@/context/push-host"
import { ServerConnection } from "@/context/server"
import { PushHostError, registerPushHost, type PushHostSocket } from "./push-host"

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

function backend(origin: string, password: string, failure?: string) {
  const requests: Array<{ url: string; body: string; auth: string | null }> = []
  const registry: PushRegistration[] = []
  let socketURL = ""

  class Socket extends EventTarget implements PushHostSocket {
    binaryType = "blob"

    constructor(url: string) {
      super()
      socketURL = url
      queueMicrotask(() => {
        this.dispatchEvent(new Event("open"))
        this.dispatchEvent(new MessageEvent("message", { data: '{"ready":true}\n' }))
      })
    }

    send(value: string) {
      registry.push(JSON.parse(value) as PushRegistration)
      const output = failure
        ? { ok: false, error: failure }
        : { ok: true, device: "device-1", token_generation: registration.token_generation }
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: `${JSON.stringify(output)}\n` })))
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
    if (url.pathname === "/pty" && init?.method === "POST") return Response.json({ id: "pty-1" })
    if (url.pathname === "/pty/pty-1/connect-token") return Response.json({ ticket: "ticket-1" })
    if (url.pathname === "/pty/pty-1" && init?.method === "DELETE") return Response.json(true)
    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch

  return {
    origin,
    password,
    requests,
    registry,
    fetch,
    socket: (url: string) => new Socket(url),
    socketURL: () => socketURL,
  }
}

describe("push host integration security", () => {
  test("registers one Android payload independently with two authenticated servers without persisting transport secrets", async () => {
    const one = backend("https://one.example", "one-password")
    const two = backend("https://two.example", "two-password")
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

    expect(one.registry).toEqual([registration])
    expect(two.registry).toEqual([registration])
    expect(state.list().map((item) => item.status)).toEqual(["active", "active"])
    const artifacts = JSON.stringify({
      argvAndCreateBodies: [one, two].flatMap((item) => item.requests.map((request) => request.body)),
      ptyURLs: [one.socketURL(), two.socketURL()],
      persistedAppState: state.snapshot(),
    })
    expect(artifacts).not.toContain(token)
    expect(artifacts).not.toContain(privateKey)
    expect([one, two].flatMap((item) => item.requests).every((request) => request.auth?.startsWith("Basic "))).toBe(
      true,
    )
  })

  test("throws only a stable transport error when registration fails", async () => {
    const target = backend("https://error.example", "error-password", token)
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
    expect(JSON.stringify({ name: error.name, code: error.code, message: error.message })).not.toContain(privateKey)
  })
})
