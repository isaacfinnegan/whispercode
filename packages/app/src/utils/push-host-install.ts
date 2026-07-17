import type { ServerConnection } from "@/context/server"
import { serverAuthHeaders } from "@/utils/server"
import { addPush, hasPush } from "./push-plugin"

const WAIT_MS = 15_000
const WAIT_GAP = 250

export type PushHostDeadline = {
  signal: AbortSignal
  run<T>(job: Promise<T>): Promise<T>
  sleep(ms: number): Promise<void>
}

const request = (
  fetch: typeof globalThis.fetch,
  server: ServerConnection.Any,
  path: string,
  deadline?: PushHostDeadline,
  init?: RequestInit,
) => {
  const job = fetch(new URL(path, server.http.url), {
    ...init,
    signal: deadline?.signal ?? init?.signal,
    headers: {
      ...init?.headers,
      ...serverAuthHeaders(server.http),
    },
  })
  return deadline ? deadline.run(job) : job
}

export async function ensurePushHost(input: {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  deadline?: PushHostDeadline
}): Promise<boolean> {
  const fetch = input.fetch ?? globalThis.fetch
  const current = await request(fetch, input.server, "/global/config", input.deadline, { cache: "no-store" })
  if (!current.ok) throw new Error("push_host_config_read_failed")
  const config = (await (input.deadline ? input.deadline.run(current.json()) : current.json())) as { plugin?: string[] }
  if (hasPush(config.plugin)) return false

  const patch = await request(fetch, input.server, "/global/config", input.deadline, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin: addPush(config.plugin) }),
  })
  if (!patch.ok) throw new Error("push_host_config_write_failed")

  let disposeError: unknown
  const disposed = await request(fetch, input.server, "/global/dispose", input.deadline, { method: "POST" }).catch(
    (cause) => {
      if (input.deadline?.signal.aborted) throw cause
      disposeError = cause
      return undefined
    },
  )
  if (disposed && !disposed.ok) throw new Error("push_host_recycle_failed")

  const deadline = Date.now() + WAIT_MS
  while (input.deadline ? !input.deadline.signal.aborted : Date.now() < deadline) {
    const response = await request(fetch, input.server, "/path", input.deadline).catch((cause) => {
      if (input.deadline?.signal.aborted) throw cause
      return undefined
    })
    if (response?.ok) return true
    if (input.deadline) await input.deadline.sleep(WAIT_GAP)
    else await new Promise((resolve) => globalThis.setTimeout(resolve, WAIT_GAP))
  }
  if (disposeError) throw disposeError
  throw new Error("push_host_refresh_timeout")
}
