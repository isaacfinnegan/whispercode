import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import {
  deactivate,
  loadDevices,
  recordError,
  recordSuccess,
  register,
  status,
  unregister,
  updatePreferences,
  type DevicePreferences,
  type DeviceRegistrationInput,
} from "./device"
import { deviceFile } from "./path"

const dirs: string[] = []
const prefs: DevicePreferences = {
  complete: true,
  approval: true,
  question: true,
  error: true,
}

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function home() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-device-"))
  dirs.push(dir)
  process.env.OPENCODE_TEST_HOME = dir
  return dir
}

async function waitFor(files: string[]) {
  const stop = Date.now() + 5_000
  while (Date.now() < stop) {
    const found = await Promise.all(
      files.map((file) =>
        fs.stat(file).then(
          () => true,
          () => false,
        ),
      ),
    )
    if (found.every(Boolean)) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for registry workers")
}

function input(id = "device-1", token = "t".repeat(32)): DeviceRegistrationInput {
  return {
    id,
    provider: "fcm",
    token,
    tokenGeneration: 1,
    prefs,
  }
}

describe("push device registry", () => {
  test("registers the first device", async () => {
    await home()

    const result = await register(input())
    const data = await loadDevices()

    expect(result).toMatchObject({ id: "device-1", active: true, tokenGeneration: 1 })
    expect(data.devices).toHaveLength(1)
    expect(data.devices[0]).toMatchObject(input())
    expect(data.devices[0]?.createdAt).toEqual(expect.any(Number))
    expect(data.devices[0]?.updatedAt).toEqual(expect.any(Number))
  })

  test("updates a registration by id without duplicating it", async () => {
    await home()
    await register(input())
    const createdAt = (await loadDevices()).devices[0]!.createdAt
    const next = input("device-1", "n".repeat(32))
    next.tokenGeneration = 2
    next.prefs = { ...prefs, question: false }

    const result = await register(next)
    const data = await loadDevices()

    expect(result).toMatchObject({ id: "device-1", active: true, tokenGeneration: 2 })
    expect(data.devices).toHaveLength(1)
    expect(data.devices[0]).toMatchObject({ ...next, createdAt, active: true })
  })

  test("updates preferences", async () => {
    await home()
    await register(input())

    const next = await updatePreferences("device-1", { ...prefs, approval: false })

    expect(next?.prefs).toEqual({ ...prefs, approval: false })
    expect((await loadDevices()).devices[0]?.prefs).toEqual({ ...prefs, approval: false })
  })

  test("unregisters a device", async () => {
    await home()
    await register(input())

    expect(await unregister("device-1")).toBe(true)
    expect(await unregister("device-1")).toBe(false)
    expect((await loadDevices()).devices).toEqual([])
  })

  test("deactivates a device rejected for an invalid token", async () => {
    await home()
    await register(input())

    const next = await deactivate("device-1", "invalid_token")

    expect(next).toMatchObject({ active: false, lastError: { code: "invalid_token", at: expect.any(Number) } })
    expect((await loadDevices()).devices[0]).toMatchObject({
      active: false,
      lastError: { code: "invalid_token", at: expect.any(Number) },
    })
  })

  test("records delivery success and errors", async () => {
    await home()
    await register(input())

    const failed = await recordError("device-1", "temporary")
    const succeeded = await recordSuccess("device-1")

    expect(failed?.lastError).toMatchObject({ code: "temporary", at: expect.any(Number) })
    expect(succeeded?.lastSuccessAt).toEqual(expect.any(Number))
    expect(succeeded?.lastError).toBeUndefined()
  })

  test("returns sanitized status without tokens", async () => {
    await home()
    const token = "secret-device-token-".padEnd(32, "x")
    await register(input("device-1", token))

    const result = await status()
    const json = JSON.stringify(result)

    expect(result[0]).toMatchObject({ id: "device-1", active: true, tokenGeneration: 1 })
    expect(result[0]).not.toHaveProperty("token")
    expect(json).not.toContain(token)
    expect(json).not.toContain("secret-device-token")
  })

  test("rejects error codes containing the device token", async () => {
    await home()
    const token = "secret-device-token-".padEnd(32, "x")
    await register(input("device-1", token))

    const error = await deactivate("device-1", `invalid_${token}`).catch((cause: unknown) => String(cause))

    expect(error).toContain("error code")
    expect(error).not.toContain(token)
    expect(JSON.stringify(await status())).not.toContain(token)
  })

  test("persists an owner-only versioned file", async () => {
    await home()
    await register(input())

    const file = deviceFile()
    const stat = await fs.stat(file)
    const saved = JSON.parse(await fs.readFile(file, "utf8"))

    expect(stat.mode & 0o777).toBe(0o600)
    expect(saved).toMatchObject({ version: 1, devices: [{ id: "device-1" }] })
  })

  test("rejects invalid registration fields without exposing tokens", async () => {
    await home()
    const secret = "secret-token-value-that-is-long-enough"
    const invalid: Array<[string, DeviceRegistrationInput]> = [
      ["id", input("é".repeat(65))],
      ["token", input("device-1", "short")],
      ["token", input("device-1", "x".repeat(8193))],
      ["tokenGeneration", { ...input(), tokenGeneration: -1 }],
      ["tokenGeneration", { ...input(), tokenGeneration: 1.5 }],
      ["provider", { ...input(), provider: "apns" } as DeviceRegistrationInput],
      [
        "prefs.complete",
        { ...input(), token: secret, prefs: { ...prefs, complete: "yes" } } as DeviceRegistrationInput,
      ],
    ]

    for (const [field, value] of invalid) {
      const error = await register(value).catch((cause: unknown) => String(cause))
      expect(error).toContain(field)
      expect(error).not.toContain(secret)
      expect(error).not.toContain(value.token)
    }
  })

  test("rejects malformed persisted content with a sanitized error", async () => {
    await home()
    const secret = "persisted-secret-token-value-12345"
    await fs.mkdir(path.dirname(deviceFile()), { recursive: true })
    await fs.writeFile(
      deviceFile(),
      JSON.stringify({ version: 1, devices: [{ ...input(), token: secret, active: "yes" }] }),
    )

    const error = await loadDevices().catch((cause: unknown) => String(cause))

    expect(error).toContain("device registry")
    expect(error).toContain("active")
    expect(error).not.toContain(secret)
  })

  test("drops unknown fields from persisted registrations", async () => {
    await home()
    await fs.mkdir(path.dirname(deviceFile()), { recursive: true })
    await fs.writeFile(
      deviceFile(),
      JSON.stringify({
        version: 1,
        unknown: "drop",
        devices: [
          {
            ...input(),
            prefs: { ...prefs, unknown: true },
            active: true,
            createdAt: 1,
            updatedAt: 2,
            lastError: { code: "temporary", at: 3, unknown: "drop" },
            unknown: "drop",
          },
        ],
      }),
    )

    expect(await loadDevices()).toEqual({
      version: 1,
      devices: [
        {
          ...input(),
          prefs,
          active: true,
          createdAt: 1,
          updatedAt: 2,
          lastError: { code: "temporary", at: 3 },
        },
      ],
    })
  })

  test("drops unknown fields from registration input", async () => {
    await home()
    const value = {
      ...input(),
      prefs: { ...prefs, unknown: true },
      unknown: "drop",
    } as DeviceRegistrationInput

    await register(value)

    expect((await loadDevices()).devices[0]).toEqual({
      ...input(),
      prefs,
      active: true,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    })
  })

  test("serializes concurrent mutations without losing registrations", async () => {
    await home()
    const count = 20

    await Promise.all(
      Array.from({ length: count }, (_, index) => register(input(`device-${index}`, `${index}`.padEnd(32, "x")))),
    )

    const data = await loadDevices()
    expect(data.devices).toHaveLength(count)
    expect(new Set(data.devices.map((device) => device.id)).size).toBe(count)
  })

  test("serializes registrations across processes", async () => {
    const dir = await home()
    const gate = path.join(dir, "gate")
    const module = pathToFileURL(path.join(import.meta.dir, "device.ts")).href
    const ready = Array.from({ length: 12 }, (_, index) => path.join(dir, `ready-${index}`))
    const workers = ready.map((file, index) => {
      const value = input(`process-${index}`, `${index}`.padEnd(32, "x"))
      const script = [
        `import fs from "fs/promises"`,
        `import { register } from ${JSON.stringify(module)}`,
        `process.env.OPENCODE_TEST_HOME = ${JSON.stringify(dir)}`,
        `await fs.writeFile(${JSON.stringify(file)}, "")`,
        `while (!(await fs.stat(${JSON.stringify(gate)}).then(() => true, () => false))) await Bun.sleep(5)`,
        `await register(${JSON.stringify(value)})`,
      ].join(";")
      return Bun.spawn([process.execPath, "-e", script], {
        cwd: import.meta.dir,
        stdout: "pipe",
        stderr: "pipe",
      })
    })

    try {
      await waitFor(ready)
      await fs.writeFile(gate, "go")
      const results = await Promise.all(
        workers.map(async (worker) => ({
          code: await worker.exited,
          stderr: await new Response(worker.stderr).text(),
        })),
      )
      expect(results).toEqual(Array.from({ length: workers.length }, () => ({ code: 0, stderr: "" })))
    } finally {
      workers.forEach((worker) => worker.kill())
    }

    const data = await loadDevices()
    expect(data.devices).toHaveLength(workers.length)
    expect(new Set(data.devices.map((device) => device.id)).size).toBe(workers.length)
  }, 20_000)

  test("a delayed reclaimed claimant cannot remove a newer lock", async () => {
    const dir = await home()
    const lock = `${deviceFile()}.lock`
    const module = pathToFileURL(path.join(import.meta.dir, "device.ts")).href
    const readyA = path.join(dir, "ready-a")
    const readyB = path.join(dir, "ready-b")
    const gateA = path.join(dir, "gate-a")
    const gateB = path.join(dir, "gate-b")
    const valueA = input("delayed", "a".repeat(32))
    const valueB = input("newer", "b".repeat(32))
    const scriptA = [
      `import fs from "fs/promises"`,
      `const lock = ${JSON.stringify(lock)}`,
      `const originalWriteFile = fs.writeFile.bind(fs)`,
      `const originalOpen = fs.open.bind(fs)`,
      `const pause = async () => { await originalWriteFile(${JSON.stringify(readyA)}, ""); while (!(await fs.stat(${JSON.stringify(gateA)}).then(() => true, () => false))) await Bun.sleep(5) }`,
      `fs.writeFile = async (file, ...args) => { if (String(file).endsWith("/owner.json")) await pause(); return originalWriteFile(file, ...args) }`,
      `fs.open = async (file, ...args) => { const handle = await originalOpen(file, ...args); if (String(file) === lock && args[0] === "wx") { const write = handle.writeFile.bind(handle); handle.writeFile = async (...writeArgs) => { await pause(); return write(...writeArgs) } } return handle }`,
      `const { register } = await import(${JSON.stringify(module)})`,
      `process.env.OPENCODE_TEST_HOME = ${JSON.stringify(dir)}`,
      `await register(${JSON.stringify(valueA)})`,
    ].join(";")
    const scriptB = [
      `import fs from "fs/promises"`,
      `const originalWriteFile = fs.writeFile.bind(fs)`,
      `const originalOpen = fs.open.bind(fs)`,
      `const pause = async () => { await originalWriteFile(${JSON.stringify(readyB)}, ""); while (!(await fs.stat(${JSON.stringify(gateB)}).then(() => true, () => false))) await Bun.sleep(5) }`,
      `fs.open = async (file, ...args) => { const handle = await originalOpen(file, ...args); if (String(file).includes(".tmp")) { const write = handle.writeFile.bind(handle); handle.writeFile = async (...writeArgs) => { await pause(); return write(...writeArgs) } } return handle }`,
      `const { register } = await import(${JSON.stringify(module)})`,
      `process.env.OPENCODE_TEST_HOME = ${JSON.stringify(dir)}`,
      `await register(${JSON.stringify(valueB)})`,
    ].join(";")
    const delayed = Bun.spawn([process.execPath, "-e", scriptA], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    let newer: ReturnType<typeof Bun.spawn> | undefined

    try {
      await waitFor([readyA])
      const old = new Date(Date.now() - 60_000)
      await fs.utimes(lock, old, old)
      newer = Bun.spawn([process.execPath, "-e", scriptB], {
        cwd: import.meta.dir,
        stdout: "pipe",
        stderr: "pipe",
      })
      await waitFor([readyB])
      await fs.writeFile(gateA, "go")
      await Bun.sleep(100)
      expect(
        await fs.stat(lock).then(
          () => true,
          () => false,
        ),
      ).toBe(true)
      await fs.writeFile(gateB, "go")

      const results = await Promise.all(
        [delayed, newer].map(async (worker) => ({
          code: await worker.exited,
          stderr: await new Response(worker.stderr).text(),
        })),
      )
      expect(results).toEqual([
        { code: 0, stderr: "" },
        { code: 0, stderr: "" },
      ])
      expect((await loadDevices()).devices.map((device) => device.id).sort()).toEqual(["delayed", "newer"])
    } finally {
      await fs.writeFile(gateA, "go").catch(() => undefined)
      await fs.writeFile(gateB, "go").catch(() => undefined)
      delayed.kill()
      newer?.kill()
    }
  }, 20_000)

  test("recovers a stale lock owned by a dead process", async () => {
    await home()
    const lock = `${deviceFile()}.lock`
    const old = new Date(Date.now() - 60_000)
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, JSON.stringify({ owner: "stale", pid: 2_147_483_647, createdAt: old.getTime() }))
    await fs.utimes(lock, old, old)
    await fs.mkdir(`${lock}.breaker`)
    await fs.utimes(`${lock}.breaker`, old, old)

    await register(input())

    expect(
      await fs.stat(lock).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(
      await fs.stat(`${lock}.breaker`).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect((await loadDevices()).devices).toHaveLength(1)
  })

  test("recovers an old ownerless lock", async () => {
    await home()
    const lock = `${deviceFile()}.lock`
    const old = new Date(Date.now() - 60_000)
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, "")
    await fs.utimes(lock, old, old)

    await register(input())

    expect(
      await fs.stat(lock).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect((await loadDevices()).devices).toHaveLength(1)
  })

  test("recovers an old lock with malformed owner metadata", async () => {
    await home()
    const lock = `${deviceFile()}.lock`
    const old = new Date(Date.now() - 60_000)
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, "not-json")
    await fs.utimes(lock, old, old)

    await register(input())

    expect(
      await fs.stat(lock).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect((await loadDevices()).devices).toHaveLength(1)
  })

  test("does not remove a fresh ownerless lock", async () => {
    await home()
    const lock = `${deviceFile()}.lock`
    const token = "secret-device-token-".padEnd(32, "x")
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, "")

    const error = await register(input("device-1", token)).catch((cause: unknown) => String(cause))

    expect(error).toContain("device registry is busy")
    expect(error).not.toContain(token)
    expect(
      await fs.stat(lock).then(
        () => true,
        () => false,
      ),
    ).toBe(true)
  }, 10_000)

  test("does not remove a stale-looking lock owned by a live process", async () => {
    await home()
    const lock = `${deviceFile()}.lock`
    const old = new Date(Date.now() - 60_000)
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, JSON.stringify({ owner: "live", pid: process.pid, createdAt: old.getTime() }))
    await fs.utimes(lock, old, old)

    const error = await register(input("device-1", "secret-device-token-".padEnd(32, "x"))).catch((cause: unknown) =>
      String(cause),
    )

    expect(error).toContain("device registry is busy")
    expect(error).not.toContain("secret-device-token")
    expect(
      await fs.stat(lock).then(
        () => true,
        () => false,
      ),
    ).toBe(true)
  }, 10_000)
})
