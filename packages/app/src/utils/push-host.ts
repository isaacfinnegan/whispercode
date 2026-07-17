import type { ServerConnection } from "@/context/server"
import type { PushRegistration } from "@/context/platform"
import { serverAuthHeaders } from "@/utils/server"
import { ensurePushHost, type PushHostDeadline } from "./push-host-install"
import { runPush } from "./push-plugin"
import { terminalWebSocketURL } from "./terminal-websocket-url"

const READY = '{"ready":true}'
const OUTPUT_LIMIT = 32 * 1024
const TIMEOUT = 15_000
const CLEANUP_TIMEOUT = 1_000

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

function createDeadline(ms: number): PushHostDeadline & { dispose(): void } {
  const controller = new AbortController()
  let timer: ReturnType<typeof globalThis.setTimeout>
  const expired = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      const error = new PushHostError("push_host_timeout")
      reject(error)
      controller.abort(error)
    }, ms)
  })

  return {
    signal: controller.signal,
    run: <T>(job: Promise<T>) => Promise.race([job, expired]),
    sleep: (delay: number) => {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason)
      const job = new Promise<void>((resolve, reject) => {
        const done = () => {
          globalThis.clearTimeout(wait)
          controller.signal.removeEventListener("abort", abort)
        }
        const abort = () => {
          done()
          reject(controller.signal.reason)
        }
        const wait = globalThis.setTimeout(() => {
          done()
          resolve()
        }, delay)
        controller.signal.addEventListener("abort", abort, { once: true })
      })
      return Promise.race([job, expired])
    },
    dispose: () => {
      globalThis.clearTimeout(timer)
      if (!controller.signal.aborted) controller.abort()
    },
  }
}

async function bounded<T>(timeout: number | undefined, run: (deadline: PushHostDeadline) => Promise<T>): Promise<T> {
  const deadline = createDeadline(timeout ?? TIMEOUT)
  try {
    return await run(deadline)
  } finally {
    deadline.dispose()
  }
}

async function cleanupPty(input: BaseInput, id: string) {
  const deadline = createDeadline(Math.min(input.timeout ?? CLEANUP_TIMEOUT, CLEANUP_TIMEOUT))
  const fetch = input.fetch ?? globalThis.fetch
  try {
    const cleanup = fetch(new URL(`/pty/${encodeURIComponent(id)}`, input.server.http.url), {
      method: "DELETE",
      signal: deadline.signal,
      headers: auth(input.server),
    })
    await deadline.run(cleanup).catch(() => undefined)
  } catch {
    // Cleanup is best-effort and must not replace the operation result.
  } finally {
    deadline.dispose()
  }
}

function takeLine(value: string) {
  const end = value.indexOf("\n")
  if (end === -1) return
  return {
    line: value.slice(0, end).replace(/\r$/, ""),
    rest: value.slice(end + 1),
  }
}

function oldRegister(line: string) {
  if (/\b(?:unknown|unrecognized)\s+(?:command\s+)?["']?register\b/i.test(line)) return true
  const usage = line.match(/\bopencode-push\s+<([^>]+)>/i)?.[1]
  if (!usage) return false
  return !usage.split("|").some((command) => command.trim() === "register")
}

function operationFailure(line: string) {
  return /command not found|npm (?:err!|error)|\be404\b|404 not found|package .*not found|could not determine executable|failed to resolve|unable to resolve/i.test(
    line,
  )
}

function response(line: string, command: string): Record<string, unknown> {
  let result: unknown
  try {
    result = JSON.parse(line)
  } catch {
    if (command === "register" && oldRegister(line)) throw new PushHostError("push_plugin_upgrade_required")
    if (operationFailure(line)) throw new PushHostError("push_host_command_failed")
    throw new PushHostError("push_host_invalid_response")
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

async function connectTicket(input: BaseInput, deadline: PushHostDeadline, id: string, directory: string) {
  const fetch = input.fetch ?? globalThis.fetch
  const url = new URL(`/pty/${encodeURIComponent(id)}/connect-token`, input.server.http.url)
  if (directory) url.searchParams.set("directory", directory)
  const result = await deadline.run(
    fetch(url, {
      method: "POST",
      signal: deadline.signal,
      headers: { "x-opencode-ticket": "1", ...auth(input.server) },
    }),
  )
  if (!result.ok) throw new PushHostError("push_host_connect_ticket_failed")
  const data = await deadline.run(result.json()).catch(() => undefined)
  const ticket = data && typeof data === "object" ? (data as { ticket?: unknown }).ticket : undefined
  if (typeof ticket !== "string" || !ticket) throw new PushHostError("push_host_connect_ticket_failed")
  return ticket
}

async function execute(
  input: BaseInput,
  deadline: PushHostDeadline,
  command: "register" | "unregister" | "status" | "test",
  args: string[],
  payload?: PushRegistration,
): Promise<Record<string, unknown>> {
  const fetch = input.fetch ?? globalThis.fetch
  const spec = runPush([command, ...args], input.tool)
  const created = await deadline.run(
    fetch(new URL("/pty", input.server.http.url), {
      method: "POST",
      signal: deadline.signal,
      headers: { "content-type": "application/json", ...auth(input.server) },
      body: JSON.stringify(spec),
    }),
  )
  if (!created.ok) throw new PushHostError("push_host_create_failed")
  const value = (await deadline.run(created.json())) as { id?: unknown; cwd?: unknown }
  if (typeof value.id !== "string" || !value.id) throw new PushHostError("push_host_create_failed")
  const id = value.id
  const directory = typeof value.cwd === "string" ? value.cwd : ""
  let socket: PushHostSocket | undefined

  try {
    const ticket = await connectTicket(input, deadline, id, directory)
    const url = terminalWebSocketURL({ url: input.server.http.url, id, directory, cursor: 0, ticket })
    const createSocket =
      input.socket ??
      ((href: string) => {
        if (!globalThis.WebSocket) throw new PushHostError("push_host_stream_unavailable")
        return new globalThis.WebSocket(href)
      })
    socket = createSocket(url.toString())
    socket.binaryType = "arraybuffer"

    const stream = new Promise<Record<string, unknown>>((resolve, reject) => {
      let output = ""
      let bytes = 0
      let ready = command !== "register"
      let sent = false
      let settled = false

      const finish = (error?: unknown, result?: Record<string, unknown>) => {
        if (settled) return
        settled = true
        deadline.signal.removeEventListener("abort", onAbort)
        socket?.removeEventListener("open", onOpen)
        socket?.removeEventListener("message", onMessage)
        socket?.removeEventListener("error", onError)
        socket?.removeEventListener("close", onClose)
        if (error) reject(error)
        else resolve(result ?? {})
      }
      const read = () => {
        if (!ready) {
          let frame = takeLine(output)
          while (frame) {
            output = frame.rest
            if (frame.line === READY) {
              ready = true
              if (!sent) {
                sent = true
                socket?.send(`${JSON.stringify(payload)}\n`)
              }
              break
            }
            if (oldRegister(frame.line)) {
              finish(new PushHostError("push_plugin_upgrade_required"))
              return
            }
            if (operationFailure(frame.line)) {
              finish(new PushHostError("push_host_command_failed"))
              return
            }
            frame = takeLine(output)
          }
          if (!ready) return
        }
        const frame = takeLine(output)
        if (!frame) return
        try {
          finish(undefined, response(frame.line, command))
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
        bytes += new TextEncoder().encode(data).byteLength
        if (bytes > OUTPUT_LIMIT) {
          finish(new PushHostError("push_host_output_limit"))
          return
        }
        read()
      }
      const onError = () => finish(new PushHostError("push_host_stream_failed"))
      const onClose = () => finish(new PushHostError("push_host_stream_closed"))
      const onAbort = () => finish(deadline.signal.reason ?? new PushHostError("push_host_timeout"))

      deadline.signal.addEventListener("abort", onAbort, { once: true })
      socket?.addEventListener("open", onOpen)
      socket?.addEventListener("message", onMessage)
      socket?.addEventListener("error", onError)
      socket?.addEventListener("close", onClose)
    })
    return await deadline.run(stream)
  } finally {
    try {
      socket?.close(1000)
    } catch {}
    await cleanupPty(input, id)
  }
}

export async function registerPushHost(input: BaseInput & { payload: PushRegistration }) {
  return bounded(input.timeout, async (deadline) => {
    try {
      await ensurePushHost({ ...input, deadline })
      const result = await execute(input, deadline, "register", ["--stdin"], input.payload)
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
      const code = message === "push_host_recycle_failed" ? message : "push_host_failed"
      throw new PushHostError(code, message)
    }
  })
}

export const unregisterPushHost = (input: BaseInput & { device: string }) =>
  bounded(input.timeout, (deadline) => execute(input, deadline, "unregister", ["--device", input.device]))

export const pushHostStatus = (input: BaseInput) =>
  bounded(input.timeout, (deadline) => execute(input, deadline, "status", ["--json"]))

export const testPushHost = (input: BaseInput & { device: string }) =>
  bounded(input.timeout, (deadline) => execute(input, deadline, "test", ["--device", input.device]))
