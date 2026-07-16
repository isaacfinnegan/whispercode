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

let mutations: Promise<void> = Promise.resolve()

function fail(scope: "registration" | "registry", field: string, reason: string): never {
  throw new Error(`invalid device ${scope}: ${field} ${reason}`)
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function id(value: unknown, scope: "registration" | "registry", field = "id"): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") === 0)
    fail(scope, field, "must be a non-empty string")
  if (Buffer.byteLength(value, "utf8") > 128) fail(scope, field, "must be at most 128 UTF-8 bytes")
}

function preferences(
  value: unknown,
  scope: "registration" | "registry",
  field = "prefs",
): asserts value is DevicePreferences {
  if (!object(value)) fail(scope, field, "must be an object")
  for (const key of ["complete", "approval", "question", "error"] as const) {
    if (typeof value[key] !== "boolean") fail(scope, `${field}.${key}`, "must be boolean")
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
  preferences(value.prefs, scope, field("prefs"))
  if (typeof value.active !== "boolean") fail(scope, field("active"), "must be boolean")
  integer(value.createdAt, scope, field("createdAt"))
  integer(value.updatedAt, scope, field("updatedAt"))
  if (value.lastSuccessAt !== undefined) integer(value.lastSuccessAt, scope, field("lastSuccessAt"))
  if (value.lastError !== undefined) {
    if (!object(value.lastError)) fail(scope, field("lastError"), "must be an object")
    if (typeof value.lastError.code !== "string" || value.lastError.code.length === 0) {
      fail(scope, field("lastError.code"), "must be a non-empty string")
    }
    if (value.lastError.code.includes(value.token)) {
      fail(scope, field("lastError.code"), "must not contain the device token")
    }
    integer(value.lastError.at, scope, field("lastError.at"))
  }
  return value as DeviceRegistration
}

function input(value: DeviceRegistrationInput): DeviceRegistrationInput {
  if (!object(value)) fail("registration", "device", "must be an object")
  id(value.id, "registration")
  if (value.provider !== "fcm") fail("registration", "provider", 'must be "fcm"')
  if (typeof value.token !== "string") fail("registration", "token", "must be a string")
  const bytes = Buffer.byteLength(value.token, "utf8")
  if (bytes < 32 || bytes > 8192) fail("registration", "token", "must be 32..8192 UTF-8 bytes")
  integer(value.tokenGeneration, "registration", "tokenGeneration")
  preferences(value.prefs, "registration")
  return value
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

function mutate<T>(action: (value: DeviceFile) => Promise<T>): Promise<T> {
  const next = mutations.then(async () => action(await read()))
  mutations = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function project(device: DeviceRegistration): DeviceStatus {
  const { token: _, ...value } = device
  return value
}

export function loadDevices(): Promise<DeviceFile> {
  return mutations.then(read)
}

export function status(): Promise<DeviceStatus[]> {
  return loadDevices().then((data) => data.devices.map(project))
}

export async function register(value: DeviceRegistrationInput): Promise<DeviceStatus> {
  input(value)
  return await mutate(async (file) => {
    const now = Date.now()
    const index = file.devices.findIndex((device) => device.id === value.id)
    const previous = file.devices[index]
    const device: DeviceRegistration = {
      ...previous,
      ...value,
      prefs: { ...value.prefs },
      active: true,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    if (index === -1) file.devices.push(device)
    else file.devices[index] = device
    await write(file)
    return project(device)
  })
}

export function updatePreferences(deviceID: string, value: DevicePreferences): Promise<DeviceStatus | undefined> {
  id(deviceID, "registration")
  preferences(value, "registration")
  return mutate(async (file) => {
    const device = file.devices.find((item) => item.id === deviceID)
    if (!device) return
    device.prefs = { ...value }
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
