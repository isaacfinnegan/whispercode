import fs from "fs/promises"
import os from "os"
import pkg from "../package.json" with { type: "json" }
import { checkin } from "./checkin.js"
import { cut, merge, name, read, write } from "./config.js"
import {
  loadDevices,
  status as deviceStatus,
  register as registerDevice,
  unregister as unregisterDevice,
  type DeviceRegistration,
} from "./device.js"
import { deliverDirect, type DirectResult } from "./direct.js"
import { logFile, stateFile } from "./path.js"
import { claim, devices as relayDevices, publish, removeDevice as relayRemoveDevice } from "./relay.js"
import { append, load, next, save, type Data, type Item } from "./state.js"

export type Cmd =
  | "install"
  | "pair"
  | "register"
  | "unregister"
  | "status"
  | "test"
  | "unpair"
  | "devices"
  | "remove-device"

export type CLIIO = {
  stdin: AsyncIterable<string | Uint8Array>
  stdout: { write(value: string): unknown }
  stderr: { write(value: string): unknown }
}

export type CmdDependencies = {
  deliver: (item: Item, device: DeviceRegistration) => Promise<DirectResult>
  configured: () => boolean
  convert: (value: string | Uint8Array) => Buffer
  concat: (chunks: Buffer[]) => Buffer
}

export type Opts = {
  plugin: string
  json: boolean
  pair?: string
  relay?: string
  server?: string
  device?: string
  stdin?: boolean
  io?: CLIIO
}

const MAX_REGISTER_BYTES = 16 * 1024

export async function run(cmd: string | undefined, opts: Opts, io = processIO(), dependencies: Partial<CmdDependencies> = {}) {
  const next = { ...opts, io }
  switch ((cmd ?? "status") as Cmd) {
    case "install":
      return install(next)
    case "pair":
      return pair(next)
    case "register":
      return register(next, dependencies)
    case "unregister":
      return unregister(next)
    case "status":
      return next.json ? directStatus(next, dependencies) : status(next)
    case "test":
      return next.device ? directTest(next, dependencies) : test(next)
    case "unpair":
      return unpair(next)
    case "devices":
      return listDevices(next)
    case "remove-device":
      return removeDevice(next)
    default:
      help(io)
      return { ok: false, error: "unknown_command" }
  }
}

async function register(opts: Opts, dependencies: Partial<CmdDependencies>) {
  if (!opts.stdin) return directOut(opts, { ok: false, error: "missing_stdin" })
  const line = await readRegisterLine(opts.io!.stdin, dependencies.convert, dependencies.concat)
  if (!line.ok) return directOut(opts, line)

  let value: unknown
  try {
    value = JSON.parse(line.value)
  } catch {
    return directOut(opts, { ok: false, error: "invalid_input" })
  }
  if (!registerInput(value)) return directOut(opts, { ok: false, error: "invalid_input" })

  const result = await registerDevice({
    id: value.device,
    provider: value.provider,
    token: value.token,
    tokenGeneration: value.token_generation,
    prefs: value.prefs,
  }).catch(() => undefined)
  if (!result) return directOut(opts, { ok: false, error: "invalid_input" })
  return directOut(opts, { ok: true, device: result.id, token_generation: result.tokenGeneration })
}

async function unregister(opts: Opts) {
  if (!opts.device) return directOut(opts, { ok: false, error: "missing_device" })
  const removed = await unregisterDevice(opts.device).catch(() => undefined)
  if (removed === undefined) return directOut(opts, { ok: false, error: "invalid_device" })
  if (!removed) return directOut(opts, { ok: false, error: "device_not_found" })
  return directOut(opts, { ok: true, device: opts.device, active: false })
}

async function directStatus(opts: Opts, dependencies: Partial<CmdDependencies>) {
  const configured = (dependencies.configured ?? fcmConfigured)()
  const devices = await deviceStatus().catch(() => undefined)
  if (!devices) return directOut(opts, { ok: false, error: "status_failed", mode: "direct", configured })
  return directOut(opts, {
    mode: "direct",
    configured,
    devices: devices.map((device) => ({
      id: device.id,
      active: device.active,
      token_generation: device.tokenGeneration,
    })),
  })
}

async function directTest(opts: Opts, dependencies: Partial<CmdDependencies>) {
  if (!(dependencies.configured ?? fcmConfigured)()) {
    return directOut(opts, { ok: false, error: "fcm_unconfigured" })
  }
  const full = await loadDevices()
    .then((data) => data.devices)
    .catch(() => undefined)
  const target = full?.find((item) => item.id === opts.device)
  if (!full) return directOut(opts, { ok: false, error: "status_failed" })
  if (!target) return directOut(opts, { ok: false, error: "device_not_found" })
  if (!target.active) return directOut(opts, { ok: false, error: "device_inactive" })
  const deliver = dependencies.deliver ?? ((item, selected) => deliverDirect(item, { devices: async () => [selected] }))
  const result = await deliver(next("test"), target).catch(() => undefined)
  if (!result || result.attempted !== 1 || result.delivered !== 1 || result.failed !== 0) {
    return directOut(opts, { ok: false, error: "delivery_failed" })
  }
  return directOut(opts, { ok: true, device: target.id })
}

export async function install(opts: Opts) {
  const cfg = await read()
  const list = merge(cfg.data.plugin ?? [], opts.plugin)
  const data = await load()

  if (opts.pair) {
    await claimPair(opts, data)
  }

  data.updated_at = Date.now()
  await save(data)

  if (opts.pair && data.mode === "relay" && data.relay) {
    await checkin(data, "install")
  }

  await write(cfg.src, cfg.text, list)

  return out(opts, {
    ok: true,
    cmd: "install",
    plugin: opts.plugin,
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    config: cfg.src,
    state: stateFile(),
  })
}

export async function pair(opts: Opts) {
  if (!opts.pair) {
    return out(opts, { ok: false, error: "missing_pair_token" })
  }

  const data = await load()
  await claimPair(opts, data)
  data.updated_at = Date.now()
  await save(data)

  if (data.mode === "relay" && data.relay) {
    await checkin(data, "pair")
  }

  return out(opts, {
    ok: true,
    cmd: "pair",
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    state: stateFile(),
  })
}

export async function status(opts: Opts) {
  const cfg = await read()
  const pkg = name(opts.plugin)
  const list = cfg.data.plugin ?? []
  const data = await load()
  const log = await fs
    .stat(logFile())
    .then((x) => x.size)
    .catch(() => 0)

  return out(opts, {
    ok: true,
    cmd: "status",
    plugin: pkg,
    installed: list.some((item) => name(item) === pkg),
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    checked: data.relay?.checked ?? null,
    result: data.relay?.result ?? null,
    reason: data.relay?.reason ?? null,
    error: data.relay?.err ?? null,
    config: cfg.src,
    state: stateFile(),
    log: logFile(),
    bytes: log,
    last: data.last ?? null,
  })
}

export async function test(opts: Opts) {
  const data = await load()
  const item = next("test")
  let sent: "accepted" | "suppressed" | undefined
  data.last = item
  data.updated_at = Date.now()
  await append(item)

  if (data.mode === "relay" && data.relay) {
    await checkin(data, "test")
    if (data.relay.result !== "failed") {
      const relay = data.relay
      await publish(data, item)
        .then((res) => {
          sent = res.suppressed ? "suppressed" : "accepted"
          data.relay = {
            ...relay,
            checked: Date.now(),
            result: "ok",
            reason: res.reason,
            delivery: res.deliveries?.[0]?.delivery_id,
            err: undefined,
          }
        })
        .catch((err: unknown) => {
          data.relay = {
            ...relay,
            checked: Date.now(),
            result: "failed",
            err: err instanceof Error ? err.message : String(err),
          }
        })
    }
  }

  await save(data)

  return out(opts, {
    ok: true,
    cmd: "test",
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    checked: data.relay?.checked ?? null,
    result: data.relay?.result ?? null,
    publish: sent ?? null,
    reason: data.relay?.reason ?? null,
    delivery: data.relay?.delivery ?? null,
    error: data.relay?.err ?? null,
    state: stateFile(),
    log: logFile(),
    item,
  })
}

export async function unpair(opts: Opts) {
  const cfg = await read()
  const list = cut(cfg.data.plugin ?? [], name(opts.plugin))
  await write(cfg.src, cfg.text, list)
  await fs.rm(stateFile(), { force: true }).catch(() => undefined)
  await fs.rm(logFile(), { force: true }).catch(() => undefined)

  return out(opts, {
    ok: true,
    cmd: "unpair",
    config: cfg.src,
    state: stateFile(),
    log: logFile(),
  })
}

export async function listDevices(opts: Opts) {
  const data = await load()
  if (data.mode !== "relay" || !data.relay) {
    return out(opts, { ok: false, error: "not_paired" })
  }
  const list = await relayDevices(data)
  return out(opts, { ok: true, cmd: "devices", devices: list })
}

export async function removeDevice(opts: Opts) {
  const data = await load()
  if (data.mode !== "relay" || !data.relay) {
    return out(opts, { ok: false, error: "not_paired" })
  }
  if (!opts.device) {
    return out(opts, { ok: false, error: "missing_device_id" })
  }
  const res = await relayRemoveDevice(data, opts.device)
  return out(opts, { ...res, ok: true, cmd: "remove-device" })
}

export function parse(args: string[]): Opts {
  const opts: Opts = {
    plugin: pkg.name,
    json: false,
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--json") {
      opts.json = true
      continue
    }
    if (arg === "--stdin") {
      opts.stdin = true
      continue
    }
    if (arg === "--plugin") {
      const next = args[i + 1]
      if (next) {
        opts.plugin = next
        i += 1
      }
      continue
    }
    if (arg === "--pair") {
      const next = args[i + 1]
      if (next) {
        opts.pair = next
        i += 1
      }
      continue
    }
    if (arg === "--relay") {
      const next = args[i + 1]
      if (next) {
        opts.relay = next
        i += 1
      }
      continue
    }
    if (arg === "--server") {
      const next = args[i + 1]
      if (next) {
        opts.server = next
        i += 1
      }
      continue
    }
    if (arg === "--device") {
      const next = args[i + 1]
      if (next) {
        opts.device = next
        i += 1
      }
      continue
    }
  }

  return opts
}

export function print(opts: Opts, data: Record<string, unknown>) {
  if (opts.json) {
    output(opts, `${JSON.stringify(data, null, 2)}\n`)
    return
  }

  for (const [key, value] of Object.entries(data)) {
    output(opts, `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}\n`)
  }
}

export function help(io = processIO()) {
  io.stdout.write(
    "opencode-push <install|pair|register|unregister|status|test|unpair|devices|remove-device> [--stdin] [--pair <token>] [--relay <url>] [--server <label>] [--plugin <spec>] [--device <id>] [--json]\n",
  )
}

async function claimPair(opts: Opts, data: Data) {
  const server = opts.server ?? os.hostname()
  const root = opts.relay ?? envRelay()
  const existing =
    data.mode === "relay" && data.relay && data.relay.url === root
      ? { channel_id: data.relay.channel, channel_secret: data.relay.secret }
      : undefined
  const res = await claim(root, opts.pair!, server, pkg.version, existing)
  data.mode = "relay"
  data.relay = {
    url: res.relay_url,
    channel: res.channel_id,
    secret: res.channel_secret,
    server,
  }
}

function envRelay() {
  return (
    process.env.WHISPEROPENCODE_PUSH_RELAY_URL ??
    process.env.OPENCODE_PUSH_RELAY_URL ??
    "https://whisper.clankercontext.com"
  )
}

function out(opts: Opts, data: Record<string, unknown>) {
  print(opts, data)
  return data
}

function directOut(opts: Opts, data: Record<string, unknown>) {
  output(opts, `${JSON.stringify(data)}\n`)
  return data
}

function output(opts: Opts, value: string) {
  if (opts.io) return opts.io.stdout.write(value)
  process.stdout.write(value)
}

function processIO(): CLIIO {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

async function readRegisterLine(
  input: AsyncIterable<string | Uint8Array>,
  convert = (value: string | Uint8Array): Buffer => Buffer.from(value),
  concat = (chunks: Buffer[]): Buffer => Buffer.concat(chunks),
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const value of input) {
      const length = typeof value === "string" ? Buffer.byteLength(value) : value.byteLength
      if (length > MAX_REGISTER_BYTES - bytes) return { ok: false, error: "input_too_large" }
      const chunk = convert(value)
      const newline = chunk.indexOf(0x0a)
      if (newline === -1) {
        bytes += chunk.length
        if (bytes > MAX_REGISTER_BYTES) return { ok: false, error: "input_too_large" }
        chunks.push(chunk)
        continue
      }

      const end = newline + 1
      bytes += end
      if (bytes > MAX_REGISTER_BYTES) return { ok: false, error: "input_too_large" }
      if (end !== chunk.length) return { ok: false, error: "trailing_input" }
      const stream = input as AsyncIterable<string | Uint8Array> & { readableLength?: number }
      if ((stream.readableLength ?? 0) > 0) return { ok: false, error: "trailing_input" }
      chunks.push(chunk.subarray(0, newline))
      try {
        return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(concat(chunks)) }
      } catch {
        return { ok: false, error: "invalid_input" }
      }
    }
  } catch {
    return { ok: false, error: "input_error" }
  }
  return { ok: false, error: "newline_required" }
}

type RegisterInput = {
  version: 1
  device: string
  provider: "fcm"
  token: string
  token_generation: number
  prefs: {
    complete: boolean
    approval: boolean
    question: boolean
    error: boolean
  }
}

function registerInput(value: unknown): value is RegisterInput {
  if (!object(value)) return false
  if (!keys(value, ["version", "device", "provider", "token", "token_generation", "prefs"])) return false
  if (value.version !== 1 || value.provider !== "fcm") return false
  if (typeof value.device !== "string" || typeof value.token !== "string") return false
  if (!Number.isInteger(value.token_generation) || (value.token_generation as number) < 0) return false
  if (!object(value.prefs) || !keys(value.prefs, ["complete", "approval", "question", "error"])) return false
  return [value.prefs.complete, value.prefs.approval, value.prefs.question, value.prefs.error].every(
    (item) => typeof item === "boolean",
  )
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function fcmConfigured() {
  const raw = process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
  if (!raw) return false
  try {
    const credentials = JSON.parse(raw) as unknown
    if (!object(credentials)) return false
    const project = process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID ?? credentials.project_id
    return (
      typeof project === "string" &&
      project.length > 0 &&
      typeof credentials.client_email === "string" &&
      credentials.client_email.length > 0 &&
      typeof credentials.private_key === "string" &&
      credentials.private_key.length > 0
    )
  } catch {
    return false
  }
}
