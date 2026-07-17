import type { ServerConnection } from "@/context/server"
import { serverAuthHeaders } from "@/utils/server"
import { addPush, hasPush } from "./push-plugin"

const WAIT_MS = 15_000
const WAIT_GAP = 250

const request = (fetch: typeof globalThis.fetch, server: ServerConnection.Any, path: string, init?: RequestInit) =>
  fetch(new URL(path, server.http.url), {
    ...init,
    headers: {
      ...init?.headers,
      ...serverAuthHeaders(server.http),
    },
  })

export async function ensurePushHost(input: {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
}): Promise<boolean> {
  const fetch = input.fetch ?? globalThis.fetch
  const current = await request(fetch, input.server, "/global/config", { cache: "no-store" })
  if (!current.ok) throw new Error("push_host_config_read_failed")
  const config = (await current.json()) as { plugin?: string[] }
  if (hasPush(config.plugin)) return false

  const patch = await request(fetch, input.server, "/global/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin: addPush(config.plugin) }),
  })
  if (!patch.ok) throw new Error("push_host_config_write_failed")

  let disposeError: unknown
  await request(fetch, input.server, "/global/dispose", { method: "POST" }).catch((cause) => {
    disposeError = cause
  })

  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    const response = await request(fetch, input.server, "/path").catch(() => undefined)
    if (response?.ok) return true
    await new Promise((resolve) => globalThis.setTimeout(resolve, WAIT_GAP))
  }
  if (disposeError) throw disposeError
  throw new Error("push_host_refresh_timeout")
}
