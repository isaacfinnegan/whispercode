import type { ServerConnection } from "@/context/server"
import type { PushRegistration } from "@/context/platform"
import { serverAuthHeaders } from "@/utils/server"
import { ensurePushHost } from "./push-host-install"
import { runPush } from "./push-plugin"

const READY = '{"ready":true}\n'
const OUTPUT_LIMIT = 32 * 1024
const TIMEOUT = 15_000
const OLD_COMMAND = /command not found|not found|unknown command|unknown_command|unrecognized|opencode-push\s*</i

export interface PushHostSocket extends EventTarget {
  binaryType: string
  send(value: string): void
  close(code?: number): void
}

type SocketFactory = (url: string) => PushHostSocket
type BaseInput = {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  socket?: SocketFactory
  timeout?: number
  tool?: "npx" | "bunx"
}

export class PushHostError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = "PushHostError"
  }
}

const auth = (server: ServerConnection.Any) => serverAuthHeaders(server.http)

function response(value: string, command: string): Record<string, unknown> {
  const line = value.split("\n", 1)[0]?.replace(/\r$/, "") ?? ""
  let result: unknown
  try {
    result = JSON.parse(line)
  } catch {
    const old = OLD_COMMAND.test(value)
    throw new PushHostError(
      old && command === "register" ? "push_plugin_upgrade_required" : "push_host_invalid_response",
    )
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new PushHostError("push_host_invalid_response")
  }
  const data = result as Record<string, unknown>
  if (data.ok === false) {
    const code =
      data.error === "unknown_command" && command === "register" ? "push_plugin_upgrade_required" : data.error
    throw new PushHostError(typeof code === "string" ? code : "push_host_command_failed")
  }
  return data
}

async function execute(
  input: BaseInput,
  command: "register" | "unregister" | "status" | "test",
  args: string[],
  payload?: PushRegistration,
): Promise<Record<string, unknown>> {
  const fetch = input.fetch ?? globalThis.fetch
  const spec = runPush([command, ...args], input.tool)
  const created = await fetch(new URL("/pty", input.server.http.url), {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(input.server) },
    body: JSON.stringify(spec),
  })
  if (!created.ok) throw new PushHostError("push_host_create_failed")
  const value = (await created.json()) as { id?: unknown }
  if (typeof value.id !== "string" || !value.id) throw new PushHostError("push_host_create_failed")
  const id = value.id
  let socket: PushHostSocket | undefined

  try {
    const url = new URL(`/pty/${encodeURIComponent(id)}/connect`, input.server.http.url)
    url.searchParams.set("cursor", "0")
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.username = input.server.http.username ?? ""
    url.password = input.server.http.password ?? ""
    const createSocket =
      input.socket ??
      ((href: string) => {
        if (!globalThis.WebSocket) throw new PushHostError("push_host_stream_unavailable")
        return new globalThis.WebSocket(href)
      })
    socket = createSocket(url.toString())
    socket.binaryType = "arraybuffer"

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      let output = ""
      let ready = command !== "register"
      let sent = false
      let settled = false
      const timer = globalThis.setTimeout(
        () => finish(new PushHostError("push_host_timeout")),
        input.timeout ?? TIMEOUT,
      )

      const finish = (error?: unknown, result?: Record<string, unknown>) => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timer)
        socket?.removeEventListener("open", onOpen)
        socket?.removeEventListener("message", onMessage)
        socket?.removeEventListener("error", onError)
        socket?.removeEventListener("close", onClose)
        if (error) reject(error)
        else resolve(result ?? {})
      }
      const read = () => {
        if (!ready) {
          const marker = output.indexOf(READY)
          if (marker === -1) {
            if (OLD_COMMAND.test(output)) {
              finish(new PushHostError("push_plugin_upgrade_required"))
            }
            return
          }
          output = output.slice(marker + READY.length)
          ready = true
          if (!sent) {
            sent = true
            socket?.send(`${JSON.stringify(payload)}\n`)
          }
        }
        const newline = output.indexOf("\n")
        if (newline === -1) return
        try {
          finish(undefined, response(output.slice(0, newline + 1), command))
        } catch (cause) {
          finish(cause)
        }
      }
      const onOpen = () => undefined
      const onMessage = (event: Event) => {
        const data = (event as MessageEvent).data
        if (data instanceof ArrayBuffer) return
        if (typeof data !== "string") return
        output += data
        if (new TextEncoder().encode(output).byteLength > OUTPUT_LIMIT) {
          finish(new PushHostError("push_host_output_limit"))
          return
        }
        read()
      }
      const onError = () => finish(new PushHostError("push_host_stream_failed"))
      const onClose = () => finish(new PushHostError("push_host_stream_closed"))

      socket?.addEventListener("open", onOpen)
      socket?.addEventListener("message", onMessage)
      socket?.addEventListener("error", onError)
      socket?.addEventListener("close", onClose)
    })
  } finally {
    try {
      socket?.close(1000)
    } catch {}
    await fetch(new URL(`/pty/${encodeURIComponent(id)}`, input.server.http.url), {
      method: "DELETE",
      headers: auth(input.server),
    }).catch(() => undefined)
  }
}

export async function registerPushHost(input: BaseInput & { payload: PushRegistration }) {
  try {
    await ensurePushHost(input)
    const result = await execute(input, "register", ["--stdin"], input.payload)
    if (JSON.stringify(result).includes(input.payload.token)) {
      throw new PushHostError("push_host_invalid_response")
    }
    return result
  } catch (cause) {
    const redact = (value: string) => value.split(input.payload.token).join("[redacted]")
    if (cause instanceof PushHostError) {
      const code = cause.code.includes(input.payload.token) ? "push_host_command_failed" : cause.code
      throw new PushHostError(code, redact(cause.message))
    }
    const message = cause instanceof Error ? redact(cause.message) : "push_host_failed"
    throw new PushHostError("push_host_failed", message)
  }
}

export const unregisterPushHost = (input: BaseInput & { device: string }) =>
  execute(input, "unregister", ["--device", input.device])

export const pushHostStatus = (input: BaseInput) => execute(input, "status", ["--json"])

export const testPushHost = (input: BaseInput & { device: string }) =>
  execute(input, "test", ["--device", input.device])
