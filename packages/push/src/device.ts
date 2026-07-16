import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { deviceFile } from "./path.js"

export type DevicePreferences = {
  complete: boolean
  approval: boolean
  question: boolean
  error: boolean
}

export type DeviceRegistration = {
  id: string
  provider: "fcm"
  token: string
  tokenGeneration: number
  prefs: DevicePreferences
  active: boolean
  createdAt: number
  updatedAt: number
  lastSuccessAt?: number
  lastError?: { code: string; at: number }
}

export type DeviceRegistrationInput = Pick<
  DeviceRegistration,
  "id" | "provider" | "token" | "tokenGeneration" | "prefs"
>

export type DeviceStatus = Omit<DeviceRegistration, "token">

type DeviceFile = { version: 1; devices: DeviceRegistration[] }
type LockOwner = { owner: string; pid: number; createdAt: number }

let mutations: Promise<void> = Promise.resolve()

const LOCK_WAIT_MS = 2_000
const LOCK_STALE_MS = 30_000
const LOCK_STEP_MS = 20

function fail(scope: "registration" | "registry", field: string, reason: string): never {
  throw new Error(`invalid device ${scope}: ${field} ${reason}`)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errno(value: unknown): string | undefined {
  if (!object(value) || typeof value.code !== "string") return
  return value.code
}

function id(value: unknown, scope: "registration" | "registry", field = "id"): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") === 0)
    fail(scope, field, "must be a non-empty string")
  if (Buffer.byteLength(value, "utf8") > 128) fail(scope, field, "must be at most 128 UTF-8 bytes")
}

function preferences(value: unknown, scope: "registration" | "registry", field = "prefs"): DevicePreferences {
  if (!object(value)) fail(scope, field, "must be an object")
  for (const key of ["complete", "approval", "question", "error"] as const) {
    if (typeof value[key] !== "boolean") fail(scope, `${field}.${key}`, "must be boolean")
  }
  return {
    complete: value.complete as boolean,
    approval: value.approval as boolean,
    question: value.question as boolean,
    error: value.error as boolean,
  }
}

function integer(value: unknown, scope: "registration" | "registry", field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) fail(scope, field, "must be a non-negative integer")
}

function registration(value: unknown, scope: "registration" | "registry", prefix = ""): DeviceRegistration {
  if (!object(value)) fail(scope, prefix || "device", "must be an object")
  const field = (key: string) => (prefix ? `${prefix}.${key}` : key)
  id(value.id, scope, field("id"))
  if (value.provider !== "fcm") fail(scope, field("provider"), 'must be "fcm"')
  if (typeof value.token !== "string") fail(scope, field("token"), "must be a string")
  const bytes = Buffer.byteLength(value.token, "utf8")
  if (bytes < 32 || bytes > 8192) fail(scope, field("token"), "must be 32..8192 UTF-8 bytes")
  integer(value.tokenGeneration, scope, field("tokenGeneration"))
  const prefs = preferences(value.prefs, scope, field("prefs"))
  if (typeof value.active !== "boolean") fail(scope, field("active"), "must be boolean")
  integer(value.createdAt, scope, field("createdAt"))
  integer(value.updatedAt, scope, field("updatedAt"))
  if (value.lastSuccessAt !== undefined) integer(value.lastSuccessAt, scope, field("lastSuccessAt"))
  let lastError: DeviceRegistration["lastError"]
  if (value.lastError !== undefined) {
    if (!object(value.lastError)) fail(scope, field("lastError"), "must be an object")
    if (typeof value.lastError.code !== "string" || value.lastError.code.length === 0) {
      fail(scope, field("lastError.code"), "must be a non-empty string")
    }
    if (value.lastError.code.includes(value.token)) {
      fail(scope, field("lastError.code"), "must not contain the device token")
    }
    integer(value.lastError.at, scope, field("lastError.at"))
    lastError = { code: value.lastError.code, at: value.lastError.at }
  }
  const result: DeviceRegistration = {
    id: value.id,
    provider: "fcm",
    token: value.token,
    tokenGeneration: value.tokenGeneration,
    prefs,
    active: value.active,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  if (value.lastSuccessAt !== undefined) result.lastSuccessAt = value.lastSuccessAt
  if (lastError !== undefined) result.lastError = lastError
  return result
}

function input(value: DeviceRegistrationInput): DeviceRegistrationInput {
  if (!object(value)) fail("registration", "device", "must be an object")
  id(value.id, "registration")
  if (value.provider !== "fcm") fail("registration", "provider", 'must be "fcm"')
  if (typeof value.token !== "string") fail("registration", "token", "must be a string")
  const bytes = Buffer.byteLength(value.token, "utf8")
  if (bytes < 32 || bytes > 8192) fail("registration", "token", "must be 32..8192 UTF-8 bytes")
  integer(value.tokenGeneration, "registration", "tokenGeneration")
  const prefs = preferences(value.prefs, "registration")
  return {
    id: value.id,
    provider: "fcm",
    token: value.token,
    tokenGeneration: value.tokenGeneration,
    prefs,
  }
}

function code(value: string, token: string): string {
  if (typeof value !== "string" || value.length === 0) fail("registration", "error code", "must be a non-empty string")
  if (value.includes(token)) fail("registration", "error code", "must not contain the device token")
  return value
}

async function read(): Promise<DeviceFile> {
  const text = await fs.readFile(deviceFile(), "utf8").catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return
    throw new Error("unable to read device registry", { cause })
  })
  if (text === undefined) return { version: 1, devices: [] }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new Error("invalid device registry: file is not valid JSON", { cause })
  }
  if (!object(value)) fail("registry", "file", "must be an object")
  if (value.version !== 1) fail("registry", "version", "must be 1")
  if (!Array.isArray(value.devices)) fail("registry", "devices", "must be an array")
  return {
    version: 1,
    devices: value.devices.map((device, index) => registration(device, "registry", `devices[${index}]`)),
  }
}

async function write(value: DeviceFile): Promise<void> {
  const file = deviceFile()
  const dir = path.dirname(file)
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const handle = await fs.open(temp, "wx", 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.chmod(temp, 0o600)
    await fs.rename(temp, file)
  } catch (cause) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw new Error("unable to persist device registry", { cause })
  }
}

function lockOwner(value: unknown): LockOwner | undefined {
  if (!object(value)) return
  if (typeof value.owner !== "string" || !Number.isInteger(value.pid) || !Number.isInteger(value.createdAt)) return
  return { owner: value.owner, pid: value.pid as number, createdAt: value.createdAt as number }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return errno(cause) !== "ESRCH"
  }
}

async function stale(lock: string): Promise<boolean> {
  const canonical = await fs.stat(lock).catch(() => undefined)
  if (!canonical) return false
  const file = canonical.isDirectory() ? path.join(lock, "owner.json") : lock
  const [owner, metadata] = await Promise.all([
    fs
      .readFile(file, "utf8")
      .then(JSON.parse)
      .then(lockOwner, () => undefined),
    fs.stat(file).catch(() => undefined),
  ])
  if (!owner || !metadata) return Date.now() - canonical.mtimeMs > LOCK_STALE_MS
  if (Date.now() - Math.max(owner.createdAt, metadata.mtimeMs) <= LOCK_STALE_MS) return false
  return !alive(owner.pid)
}

async function clearStale(lock: string): Promise<void> {
  const breaker = `${lock}.breaker`
  const claimed = await fs.mkdir(breaker, { mode: 0o700 }).then(
    () => true,
    async (cause: unknown) => {
      if (errno(cause) === "EEXIST") {
        const stat = await fs.stat(breaker).catch(() => undefined)
        if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(breaker, { recursive: true, force: true }).catch(() => undefined)
        }
        return false
      }
      throw cause
    },
  )
  if (!claimed) return
  try {
    if (await stale(lock)) await fs.rm(lock, { recursive: true, force: true })
  } finally {
    await fs.rm(breaker, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function acquire(): Promise<() => Promise<void>> {
  const lock = `${deviceFile()}.lock`
  const owner: LockOwner = { owner: randomUUID(), pid: process.pid, createdAt: Date.now() }
  const stop = Date.now() + LOCK_WAIT_MS
  await fs.mkdir(path.dirname(lock), { recursive: true, mode: 0o700 })

  while (true) {
    const handle = await fs.open(lock, "wx", 0o600).then(
      (value) => value,
      (cause: unknown) => {
        if (errno(cause) === "EEXIST" || errno(cause) === "EISDIR") return
        throw cause
      },
    )
    if (handle) {
      try {
        await handle.writeFile(JSON.stringify(owner))
        await handle.sync()
      } catch (cause) {
        await handle.close().catch(() => undefined)
        throw new Error("unable to create device registry lock", { cause })
      }

      const [current, held, canonical] = await Promise.all([
        fs
          .readFile(lock, "utf8")
          .then(JSON.parse)
          .then(lockOwner, () => undefined),
        handle.stat(),
        fs.stat(lock).catch(() => undefined),
      ])
      if (current?.owner !== owner.owner || !canonical || canonical.dev !== held.dev || canonical.ino !== held.ino) {
        await handle.close().catch(() => undefined)
      } else {
        return async () => {
          try {
            const [latest, pathStat] = await Promise.all([
              fs
                .readFile(lock, "utf8")
                .then(JSON.parse)
                .then(lockOwner, () => undefined),
              fs.stat(lock).catch(() => undefined),
            ])
            if (latest?.owner !== owner.owner || !pathStat || pathStat.dev !== held.dev || pathStat.ino !== held.ino) {
              throw new Error("unable to release device registry lock safely")
            }
            await fs.rm(lock)
          } finally {
            await handle.close().catch(() => undefined)
          }
        }
      }
    }

    await clearStale(lock)
    if (Date.now() >= stop) throw new Error("device registry is busy")
    await Bun.sleep(LOCK_STEP_MS)
  }
}

function mutate<T>(action: (value: DeviceFile) => Promise<T>): Promise<T> {
  const next = mutations.then(async () => {
    const release = await acquire()
    try {
      return await action(await read())
    } finally {
      await release()
    }
  })
  mutations = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function project(device: DeviceRegistration): DeviceStatus {
  const value: DeviceStatus = {
    id: device.id,
    provider: device.provider,
    tokenGeneration: device.tokenGeneration,
    prefs: preferences(device.prefs, "registry"),
    active: device.active,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  }
  if (device.lastSuccessAt !== undefined) value.lastSuccessAt = device.lastSuccessAt
  if (device.lastError !== undefined) value.lastError = { code: device.lastError.code, at: device.lastError.at }
  return value
}

export function loadDevices(): Promise<DeviceFile> {
  return mutations.then(read)
}

export function status(): Promise<DeviceStatus[]> {
  return loadDevices().then((data) => data.devices.map(project))
}

export async function register(value: DeviceRegistrationInput): Promise<DeviceStatus> {
  const next = input(value)
  return await mutate(async (file) => {
    const now = Date.now()
    const index = file.devices.findIndex((device) => device.id === next.id)
    const previous = file.devices[index]
    const device: DeviceRegistration = {
      id: next.id,
      provider: next.provider,
      token: next.token,
      tokenGeneration: next.tokenGeneration,
      prefs: next.prefs,
      active: true,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    if (previous?.lastSuccessAt !== undefined) device.lastSuccessAt = previous.lastSuccessAt
    if (previous?.lastError !== undefined) {
      device.lastError = { code: previous.lastError.code, at: previous.lastError.at }
    }
    if (index === -1) file.devices.push(device)
    else file.devices[index] = device
    await write(file)
    return project(device)
  })
}

export function updatePreferences(deviceID: string, value: DevicePreferences): Promise<DeviceStatus | undefined> {
  id(deviceID, "registration")
  const prefs = preferences(value, "registration")
  return mutate(async (file) => {
    const device = file.devices.find((item) => item.id === deviceID)
    if (!device) return
    device.prefs = prefs
    device.updatedAt = Date.now()
    await write(file)
    return project(device)
  })
}

export function unregister(deviceID: string): Promise<boolean> {
  id(deviceID, "registration")
  return mutate(async (file) => {
    const devices = file.devices.filter((device) => device.id !== deviceID)
    if (devices.length === file.devices.length) return false
    file.devices = devices
    await write(file)
    return true
  })
}

export function deactivate(deviceID: string, errorCode: string): Promise<DeviceStatus | undefined> {
  id(deviceID, "registration")
  return mutate(async (file) => {
    const device = file.devices.find((item) => item.id === deviceID)
    if (!device) return
    const now = Date.now()
    device.active = false
    device.updatedAt = now
    device.lastError = { code: code(errorCode, device.token), at: now }
    await write(file)
    return project(device)
  })
}

export function recordSuccess(deviceID: string): Promise<DeviceStatus | undefined> {
  id(deviceID, "registration")
  return mutate(async (file) => {
    const device = file.devices.find((item) => item.id === deviceID)
    if (!device) return
    const now = Date.now()
    device.updatedAt = now
    device.lastSuccessAt = now
    delete device.lastError
    await write(file)
    return project(device)
  })
}

export function recordError(deviceID: string, errorCode: string): Promise<DeviceStatus | undefined> {
  id(deviceID, "registration")
  return mutate(async (file) => {
    const device = file.devices.find((item) => item.id === deviceID)
    if (!device) return
    const now = Date.now()
    device.updatedAt = now
    device.lastError = { code: code(errorCode, device.token), at: now }
    await write(file)
    return project(device)
  })
}
