import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const dirs: string[] = []
const token = "integration-fcm-token".padEnd(32, "x")
const privateKey = "-----BEGIN PRIVATE KEY-----integration-secret-----END PRIVATE KEY-----"
const prefs = { complete: true, approval: true, question: true, error: true }

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function backend(name: string) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), `push-${name}-`))
  dirs.push(home)
  const password = `${name}-operator-password`
  const cli = path.join(import.meta.dir, "cli.ts")
  const registry = path.join(home, ".local", "state", "opencode", "whisperopencode-push-devices.json")

  return {
    home,
    password,
    registry,
    async register(auth: string, payload: Record<string, unknown>) {
      if (auth !== password) return { status: 401, stdout: "", stderr: "", argv: [] as string[] }
      const argv = [process.execPath, cli, "register", "--stdin"]
      const proc = Bun.spawn(argv, {
        env: { ...process.env, OPENCODE_TEST_HOME: home },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      proc.stdin.write(`${JSON.stringify(payload)}\n`)
      proc.stdin.end()
      const [status, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return { status, stdout, stderr, argv }
    },
    async publish(kind: "complete" | "approval") {
      const event =
        kind === "complete"
          ? { type: "session.idle", properties: { sessionID: `${name}-session` } }
          : { type: "permission.asked", properties: { id: `${name}-request`, sessionID: `${name}-session` } }
      const script = String.raw`
        import { mock } from "bun:test"
        const sent = []
        mock.module("@whispercode/push-provider", () => ({
          createFcmAdapter: () => ({
            send: async (value, message) => {
              sent.push({ tokenMatched: value === process.env.EXPECTED_TOKEN, message })
              return { ok: true, invalid: false, code: "ok" }
            },
          }),
        }))
        const { default: plugin } = await import(${JSON.stringify(path.join(import.meta.dir, "index.ts"))})
        const hooks = await plugin({})
        await hooks.event({ event: ${JSON.stringify(event)} })
        process.stdout.write(JSON.stringify(sent))
      `
      const argv = [process.execPath, "-e", script]
      const proc = Bun.spawn(argv, {
        cwd: import.meta.dir,
        env: {
          ...process.env,
          OPENCODE_TEST_HOME: home,
          EXPECTED_TOKEN: token,
          WHISPEROPENCODE_PUSH_FCM_PROJECT_ID: "integration-project",
          WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
            client_email: "push@example.test",
            private_key: privateKey,
          }),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [status, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return {
        status,
        stdout,
        stderr,
        argv,
        sends: JSON.parse(stdout) as Array<{ tokenMatched: boolean; message: { kind: string; deviceID: string } }>,
      }
    },
  }
}

describe("direct multi-server integration", () => {
  test("registers and delivers independently on two authenticated backends without leaking secrets", async () => {
    const one = await backend("one")
    const two = await backend("two")
    const registration = {
      version: 1,
      device: "device-1",
      provider: "fcm",
      token,
      token_generation: 1,
      prefs,
    }

    const rejected = await one.register("wrong-password", registration)
    expect(rejected.status).toBe(401)
    await expect(fs.stat(one.registry)).rejects.toMatchObject({ code: "ENOENT" })

    const registered = await Promise.all([
      one.register(one.password, registration),
      two.register(two.password, registration),
    ])
    expect(registered.map((result) => result.status)).toEqual([0, 0])
    expect(registered.map((result) => JSON.parse(result.stdout))).toEqual([
      { ok: true, device: "device-1", token_generation: 1 },
      { ok: true, device: "device-1", token_generation: 1 },
    ])

    const registries = await Promise.all([one.registry, two.registry].map((file) => fs.readFile(file, "utf8")))
    expect(registries.map((value) => JSON.parse(value).devices.map((device: { id: string }) => device.id))).toEqual([
      ["device-1"],
      ["device-1"],
    ])
    expect(
      await Promise.all([one.registry, two.registry].map((file) => fs.stat(file).then((stat) => stat.mode & 0o777))),
    ).toEqual([0o600, 0o600])

    const [complete, approval] = await Promise.all([one.publish("complete"), two.publish("approval")])
    expect([complete.status, approval.status]).toEqual([0, 0])
    expect(complete.sends).toEqual([
      { tokenMatched: true, message: expect.objectContaining({ kind: "complete", deviceID: "device-1" }) },
    ])
    expect(approval.sends).toEqual([
      { tokenMatched: true, message: expect.objectContaining({ kind: "approval", deviceID: "device-1" }) },
    ])

    const publicArtifacts = JSON.stringify({
      registerArgv: registered.map((result) => result.argv),
      registerOutput: registered.map((result) => [result.stdout, result.stderr]),
      pluginArgv: [complete.argv, approval.argv],
      pluginLogs: [complete.stdout, complete.stderr, approval.stdout, approval.stderr],
    })
    expect(publicArtifacts).not.toContain(token)
    expect(publicArtifacts).not.toContain(privateKey)
  })
})
