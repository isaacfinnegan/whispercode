import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  install,
  pair,
  parse,
  run,
  status,
  test as ping,
  unpair,
  type CLIIO,
  type Opts,
} from "./cmd"
import { main } from "./cli"

const base = (): Opts => ({ plugin: "@whisperopencode/push", json: true })
const dirs: string[] = []

async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function memoryIO() {
  let stdout = ""
  let stderr = ""
  const io: CLIIO = {
    stdout: { write: (value) => void (stdout += value) },
    stderr: { write: (value) => void (stderr += value) },
  }
  return { io, stdout: () => stdout, stderr: () => stderr }
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

describe("push cli", () => {
  test("rejects removed direct backend commands", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO()

    for (const cmd of ["register", "unregister"]) {
      expect(await run(cmd, parse([cmd]), memory.io)).toEqual({ ok: false, error: "unknown_command" })
    }
    expect(await fs.readdir(process.env.OPENCODE_TEST_HOME)).toEqual([])
  })

  test("status --json reports relay-shaped state without direct diagnostics", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO()

    const result = await run("status", parse(["status", "--json"]), memory.io)

    expect(result).toMatchObject({ ok: true, cmd: "status", mode: "local", relay: null })
    expect(result).not.toHaveProperty("devices")
    expect(JSON.parse(memory.stdout())).toMatchObject({ cmd: "status", mode: "local" })
  })

  test("test --device in local mode records the item without delivery", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const memory = memoryIO()

    const result = await run("test", parse(["test", "--device", "device-1", "--json"]), memory.io)

    expect(result).toMatchObject({ ok: true, cmd: "test", mode: "local", publish: null, result: null })
  })

  test("CLI supports injected IO without changing process exit state", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const before = process.exitCode
    const memory = memoryIO()

    expect(await main(["register", "--stdin"], memory.io)).toBe(1)
    expect(process.exitCode).toBe(before)
    expect(memory.stdout()).toContain("opencode-push <install|pair|status|test|unpair|devices|remove-device>")
  })
})
