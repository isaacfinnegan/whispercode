import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { PushPlugin } from "./push-plugin"
import { ensurePushHost } from "./push-host-install"

const server: ServerConnection.Http = {
  type: "http",
  http: {
    url: "https://host.example.com",
    username: "operator",
    password: "secret",
  },
}

function host(plugin: string[]) {
  const calls: Array<{ path: string; method: string; auth: string | null; body?: unknown }> = []
  let config = { plugin }
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ path: url.pathname, method, auth: headers.get("authorization"), body })

    if (url.pathname === "/global/config" && method === "GET") return Response.json(config)
    if (url.pathname === "/global/config" && method === "PATCH") {
      config = { ...config, ...(body as { plugin: string[] }) }
      return Response.json(config)
    }
    if (url.pathname === "/global/dispose" && method === "POST") return Response.json(true)
    if (url.pathname === "/path") return Response.json({ state: "/tmp/opencode", directory: "/repo" })
    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

describe("ensurePushHost", () => {
  test("does not write or recycle an already active plugin", async () => {
    const trace = host([PushPlugin.spec])

    expect(await ensurePushHost({ server, fetch: trace.fetch })).toBe(false)
    expect(trace.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /global/config"])
    expect(trace.calls[0]?.auth).toMatch(/^Basic /)
  })

  test("installs, recycles, and observes the refreshed backend in order", async () => {
    const trace = host(["other-plugin"])

    expect(await ensurePushHost({ server, fetch: trace.fetch })).toBe(true)
    expect(trace.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /global/config",
      "PATCH /global/config",
      "POST /global/dispose",
      "GET /path",
    ])
    expect(trace.calls[1]?.body).toEqual({ plugin: ["other-plugin", PushPlugin.spec] })
    expect(trace.calls.every((call) => call.auth?.startsWith("Basic "))).toBe(true)
  })
})
