import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { install, pair, parse, run, status, test as ping, unpair, type CLIIO, type Opts } from "./cmd"
import { main } from "./cli"
import { deactivate, loadDevices, register as registerDevice } from "./device"

const base = (): Opts => ({ plugin: "@whisperopencode/push", json: true })

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "push-"))
}

afterEach(() => {
  delete process.env.OPENCODE_TEST_HOME
  delete process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID
  delete process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
})

function memoryIO(input = "", chunks?: Array<string | Uint8Array>) {
  let stdout = ""
  let stderr = ""
  const io: CLIIO = {
    stdin: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks ?? [input]) yield chunk
      },
    },
    stdout: { write: (value) => void (stdout += value) },
    stderr: { write: (value) => void (stderr += value) },
  }
  return { io, stdout: () => stdout, stderr: () => stderr }
}

const registration = (value: Record<string, unknown> = {}) => ({
  version: 1,
  device: "device-1",
  provider: "fcm",
  token: "secret-device-token".padEnd(32, "x"),
  token_generation: 2,
  prefs: { complete: true, approval: true, question: true, error: true },
  ...value,
})

function configureFCM() {
  process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
  process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: "project-1",
    client_email: "push@example.test",
    private_key: "private-key",
  })
}

describe("push cmd", () => {
  test("installs local mode without pair token", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const res = await install(base())
    expect(res.mode).toBe("local")
  })

  test("pairs without modifying config", async () => {
    const dir = await tmp()
    process.env.OPENCODE_TEST_HOME = dir
    const cfg = path.join(dir, ".config", "opencode", "opencode.jsonc")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await fs.writeFile(cfg, JSON.stringify({ plugin: ["foo@1.0.0"] }, null, 2) + "\n")

    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (): Promise<Response> =>
        Response.json({
          relay_url: `http://127.0.0.1:${port}`,
          channel_id: "ch_1",
          channel_secret: "sec_1",
        }),
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next

    const res = await pair({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}` })
    expect(res.cmd).toBe("pair")
    expect(res.mode).toBe("relay")
    expect(res.channel).toBe("ch_1")

    const text = await fs.readFile(cfg, "utf8")
    expect(text).toContain('"foo@1.0.0"')
    expect(text).not.toContain("@whisperopencode/push")
    await srv.stop()
  })

  test("pair requires a token", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const res = await pair(base())
    expect(res).toEqual({
      ok: false,
      error: "missing_pair_token",
    })
  })

  test("claims relay pair and stores relay state", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const seen: Array<Record<string, unknown>> = []
    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (req: Request): Promise<Response> => {
        const body = (await req.json()) as Record<string, unknown>
        seen.push(body)
        return Response.json({
          relay_url: `http://127.0.0.1:${port}`,
          channel_id: "ch_1",
          channel_secret: "sec_1",
        })
      },
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next

    const res = await install({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}`, server: "macbook" })
    expect(res.mode).toBe("relay")
    expect(res.channel).toBe("ch_1")
    expect(seen[0]?.pair_token).toBe("ptok_1")
    await srv.stop()
  })

  test("status reports relay diagnostics", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (): Promise<Response> =>
        Response.json({
          relay_url: `http://127.0.0.1:${port}`,
          channel_id: "ch_1",
          channel_secret: "sec_1",
        }),
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next
    await install({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}` })
    const res = await status(base())
    expect(res.mode).toBe("relay")
    expect(res.channel).toBe("ch_1")
    await srv.stop()
  })

  test("test publishes a relay event when paired", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const seen: string[] = []
    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (req: Request): Promise<Response> => {
        seen.push(new URL(req.url).pathname)
        return Response.json(
          new URL(req.url).pathname === "/v1/pair/claim"
            ? {
                relay_url: `http://127.0.0.1:${port}`,
                channel_id: "ch_1",
                channel_secret: "sec_1",
              }
            : { ok: true },
        )
      },
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next
    await install({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}` })
    const res = await ping(base())
    expect(res.result).toBe("ok")
    expect(res.publish).toBe("accepted")
    expect(seen.includes("/v1/channel/checkin")).toBe(true)
    expect(seen.includes("/v1/events/publish")).toBe(true)
    await srv.stop()
  })

  test("unpair removes files", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    await install(base())
    const res = await unpair(base())
    expect(res.cmd).toBe("unpair")
  })

  test("rerun rewrites pinned config to unpinned spec", async () => {
    const dir = await tmp()
    process.env.OPENCODE_TEST_HOME = dir
    const cfg = path.join(dir, ".config", "opencode", "opencode.jsonc")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await fs.writeFile(
      cfg,
      JSON.stringify(
        {
          plugin: ["foo@1.0.0", "@whisperopencode/push@0.2.0"],
        },
        null,
        2,
      ) + "\n",
    )

    await install(base())

    const text = await fs.readFile(cfg, "utf8")
    expect(text).toContain('"@whisperopencode/push"')
    expect(text).not.toContain("@whisperopencode/push@0.2.0")
    expect(text).toContain('"foo@1.0.0"')
  })
})

describe("direct push cmd", () => {
  test("register --stdin consumes one JSON line and never echoes the token", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const value = registration()
    const memory = memoryIO(`${JSON.stringify(value)}\n`)

    const result = await run("register", parse(["register", "--stdin"]), memory.io)

    expect(result).toEqual({ ok: true, device: "device-1", token_generation: 2 })
    expect(memory.stdout()).toBe('{"ok":true,"device":"device-1","token_generation":2}\n')
    expect(memory.stdout() + memory.stderr()).not.toContain(value.token)
    expect((await loadDevices()).devices[0]).toMatchObject({
      id: "device-1",
      token: value.token,
      tokenGeneration: 2,
    })
  })

  test("register handles UTF-8 characters split across input chunks", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const device = `device-${String.fromCodePoint(0xe9)}`
    const value = registration({ device })
    const input = Buffer.from(`${JSON.stringify(value)}\n`)
    const split = input.indexOf(Buffer.from(String.fromCodePoint(0xe9))) + 1
    const memory = memoryIO("", [input.subarray(0, split), input.subarray(split)])

    expect(await run("register", parse(["register", "--stdin"]), memory.io)).toEqual({
      ok: true,
      device,
      token_generation: 2,
    })
  })

  test("register uses the injected bounded conversion seam", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO(`${JSON.stringify(registration())}\n`)
    let conversions = 0
    let concatenations = 0

    const result = await run("register", parse(["register", "--stdin"]), memory.io, {
      convert: (value) => {
        conversions++
        return Buffer.from(value)
      },
      concat: (chunks) => {
        concatenations++
        return Buffer.concat(chunks)
      },
    })

    expect(result.ok).toBe(true)
    expect(conversions).toBe(1)
    expect(concatenations).toBe(1)
  })

  test("register requires --stdin", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO(`${JSON.stringify(registration())}\n`)

    expect(await run("register", parse(["register"]), memory.io)).toEqual({
      ok: false,
      error: "missing_stdin",
    })
    expect((await loadDevices()).devices).toEqual([])
  })

  test.each([
    ["malformed JSON", "not-json\n", "invalid_input"],
    ["missing newline", JSON.stringify(registration()), "newline_required"],
    ["a second line", `${JSON.stringify(registration())}\n{}\n`, "trailing_input"],
    ["trailing data", `${JSON.stringify(registration())}\nx`, "trailing_input"],
  ])("register rejects %s without exposing input", async (_label, input, code) => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO(input)

    const result = await run("register", parse(["register", "--stdin"]), memory.io)

    expect(result).toEqual({ ok: false, error: code })
    expect(memory.stdout() + memory.stderr()).not.toContain("secret-device-token")
    expect((await loadDevices()).devices).toEqual([])
  })

  test("register enforces the 16 KiB byte boundary including the newline", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const prefix = JSON.stringify(registration({ token: "" }))
    const marker = '"token":""'
    const bytes = 16 * 1024
    const exact = prefix.replace(marker, `"token":"${"x".repeat(bytes - Buffer.byteLength(prefix) - 1)}"`) + "\n"
    expect(Buffer.byteLength(exact)).toBe(bytes)
    const accepted = memoryIO("", [Buffer.from(exact.slice(0, -2)), Buffer.from(exact.slice(-2))])

    expect(await run("register", parse(["register", "--stdin"]), accepted.io)).toEqual({
      ok: false,
      error: "invalid_input",
    })

    const oversized = memoryIO(`${"x".repeat(bytes)}\n`)
    expect(await run("register", parse(["register", "--stdin"]), oversized.io)).toEqual({
      ok: false,
      error: "input_too_large",
    })
  })

  test("register rejects a huge chunk before conversion or concatenation", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO("", [new Uint8Array(4 * 1024 * 1024)])
    let conversions = 0
    let concatenations = 0

    const result = await run("register", parse(["register", "--stdin"]), memory.io, {
      convert: (value) => {
        conversions++
        return Buffer.from(value)
      },
      concat: (chunks) => {
        concatenations++
        return Buffer.concat(chunks)
      },
    })

    expect(result).toEqual({ ok: false, error: "input_too_large" })
    expect(conversions).toBe(0)
    expect(concatenations).toBe(0)
  })

  test("register returns after one newline while stdin remains open", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO()
    const line = `${JSON.stringify(registration())}\n`
    let calls = 0
    let returned = false
    memory.io.stdin = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            calls++
            if (calls === 1) return Promise.resolve({ done: false as const, value: line })
            return new Promise<IteratorResult<string>>(() => undefined)
          },
          return() {
            returned = true
            return Promise.resolve({ done: true as const, value: undefined })
          },
        }
      },
    }

    const result = await Promise.race([
      run("register", parse(["register", "--stdin"]), memory.io),
      Bun.sleep(100).then(() => "timeout" as const),
    ])

    expect(result).not.toBe("timeout")
    expect(result).toMatchObject({ ok: true, device: "device-1" })
    expect(calls).toBe(1)
    expect(returned).toBe(true)
  })

  test.each([
    ["unknown top-level fields", registration({ extra: true })],
    ["unknown nested fields", registration({ prefs: { ...registration().prefs, extra: true } })],
    ["wrong version", registration({ version: 2 })],
    ["wrong provider", registration({ provider: "apns" })],
    ["wrong types", registration({ token_generation: "2" })],
    ["invalid registry values", registration({ token: "short" })],
  ])("register rejects %s before persistence", async (_label, value) => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO(`${JSON.stringify(value)}\n`)

    expect(await run("register", parse(["register", "--stdin"]), memory.io)).toEqual({
      ok: false,
      error: "invalid_input",
    })
    expect((await loadDevices()).devices).toEqual([])
    expect(memory.stdout() + memory.stderr()).not.toContain(String(value.token))
  })

  test("unregister deletes only the selected device with stable not-found behavior", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    await registerDevice({
      id: "device-1",
      provider: "fcm",
      token: "one".padEnd(32, "x"),
      tokenGeneration: 1,
      prefs: registration().prefs,
    })
    await registerDevice({
      id: "device-2",
      provider: "fcm",
      token: "two".padEnd(32, "x"),
      tokenGeneration: 1,
      prefs: registration().prefs,
    })
    const memory = memoryIO()

    expect(await run("unregister", parse(["unregister", "--device", "device-1"]), memory.io)).toEqual({
      ok: true,
      device: "device-1",
      active: false,
    })
    expect((await loadDevices()).devices.map((item) => item.id)).toEqual(["device-2"])
    expect(await run("unregister", parse(["unregister", "--device", "device-1"]), memory.io)).toEqual({
      ok: false,
      error: "device_not_found",
    })
  })

  test("unregister requires a device", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO()

    expect(await run("unregister", parse(["unregister"]), memory.io)).toEqual({
      ok: false,
      error: "missing_device",
    })
  })

  test("status --json reports sanitized direct state and usable configuration", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const value = registration()
    await registerDevice({
      id: value.device,
      provider: "fcm",
      token: value.token,
      tokenGeneration: value.token_generation,
      prefs: value.prefs,
    })
    configureFCM()
    const memory = memoryIO()

    const result = await run("status", parse(["status", "--json"]), memory.io)

    expect(result).toEqual({
      mode: "direct",
      configured: true,
      devices: [{ id: "device-1", active: true, token_generation: 2 }],
    })
    expect(memory.stdout()).not.toContain(value.token)
    expect(memory.stdout()).not.toContain("private-key")
  })

  test("status --json reports malformed or incomplete configuration as unconfigured", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "project-1"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = "not-json"
    const memory = memoryIO()

    expect(await run("status", parse(["status", "--json"]), memory.io)).toEqual({
      mode: "direct",
      configured: false,
      devices: [],
    })
  })

  test("test --device delivers only the selected active device", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    configureFCM()
    for (const id of ["device-1", "device-2"]) {
      await registerDevice({
        id,
        provider: "fcm",
        token: id.padEnd(32, "x"),
        tokenGeneration: 1,
        prefs: registration().prefs,
      })
    }
    const sent: string[] = []
    const memory = memoryIO()

    const result = await run("test", parse(["test", "--device", "device-1"]), memory.io, {
      deliver: async (_item, device) => {
        sent.push(device.id)
        return { attempted: 1, delivered: 1, failed: 0 }
      },
    })

    expect(result).toEqual({ ok: true, device: "device-1" })
    expect(sent).toEqual(["device-1"])
  })

  test("test --device returns stable safe configuration, device, active, and delivery errors", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    await registerDevice({
      id: "inactive",
      provider: "fcm",
      token: "secret-inactive-token".padEnd(32, "x"),
      tokenGeneration: 1,
      prefs: registration().prefs,
    })
    await deactivate("inactive", "private provider detail", 1)
    const memory = memoryIO()

    expect(await run("test", parse(["test", "--device", "missing"]), memory.io)).toEqual({
      ok: false,
      error: "fcm_unconfigured",
    })
    configureFCM()
    expect(await run("test", parse(["test", "--device", "missing"]), memory.io)).toEqual({
      ok: false,
      error: "device_not_found",
    })
    expect(await run("test", parse(["test", "--device", "inactive"]), memory.io)).toEqual({
      ok: false,
      error: "device_inactive",
    })
    await registerDevice({
      id: "failed",
      provider: "fcm",
      token: "secret-failed-token".padEnd(32, "x"),
      tokenGeneration: 1,
      prefs: registration().prefs,
    })
    expect(
      await run("test", parse(["test", "--device", "failed"]), memory.io, {
        deliver: async () => {
          throw new Error("raw provider secret")
        },
      }),
    ).toEqual({ ok: false, error: "delivery_failed" })
    expect(memory.stdout() + memory.stderr()).not.toContain("secret-")
    expect(memory.stdout() + memory.stderr()).not.toContain("raw provider")
  })

  test("legacy test without --device does not use direct delivery", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    let direct = false

    const result = await run("test", base(), memoryIO().io, {
      deliver: async () => {
        direct = true
        return { attempted: 1, delivered: 1, failed: 0 }
      },
    })

    expect(result.cmd).toBe("test")
    expect(direct).toBe(false)
  })

  test("production CLI returns failure without exposing malformed stdin", async () => {
    const dir = await tmp()
    const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "cli.ts"), "register", "--stdin"], {
      env: { ...process.env, OPENCODE_TEST_HOME: dir },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    proc.stdin.write("secret malformed input\n")
    proc.stdin.end()

    const [exit, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    expect(exit).toBe(1)
    expect(stdout).toBe('{"ok":false,"error":"invalid_input"}\n')
    expect(stdout + stderr).not.toContain("secret malformed input")
  })

  test("CLI supports injected IO without changing process exit state", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const before = process.exitCode
    const memory = memoryIO("malformed\n")

    expect(await main(["register", "--stdin"], memory.io)).toBe(1)
    expect(process.exitCode).toBe(before)
    expect(memory.stdout()).toBe('{"ok":false,"error":"invalid_input"}\n')
  })

})
