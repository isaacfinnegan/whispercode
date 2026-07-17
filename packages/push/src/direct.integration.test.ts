import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { PushMessage } from "@whispercode/push-provider"
import { loadDevices, register } from "./device"

const dirs: string[] = []
const token = "direct-security-token".padEnd(32, "x")
const privateKey = "-----BEGIN PRIVATE KEY-----direct-security-secret-----END PRIVATE KEY-----"
const sent: PushMessage[] = []
const adapterTokens: string[] = []

mock.module("@whispercode/push-provider", () => ({
  createFcmAdapter: () => ({
    send: async (value: string, message: PushMessage) => {
      adapterTokens.push(value)
      sent.push(message)
      throw new Error(privateKey)
    },
  }),
}))

const { default: plugin } = await import("./index")

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  delete process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID
  delete process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
  sent.splice(0)
  adapterTokens.splice(0)
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("direct delivery integration security", () => {
  test("sanitizes exact backend credential and token sent through registry and adapter boundaries", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "push-direct-security-"))
    dirs.push(home)
    process.env.OPENCODE_TEST_HOME = home
    process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID = "security-project"
    process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "push@example.test",
      private_key: privateKey,
    })
    await register({
      id: "device-1",
      provider: "fcm",
      token,
      tokenGeneration: 1,
      prefs: { complete: true, approval: true, question: true, error: true },
    })
    const logs: unknown[] = []
    const original = console.error
    console.error = (...values) => logs.push(values)

    try {
      const hooks = await plugin({} as never)
      await hooks.event?.({
        event: { type: "session.idle", properties: { sessionID: "security-session" } },
      } as never)
    } finally {
      console.error = original
    }

    expect(sent).toEqual([expect.objectContaining({ deviceID: "device-1", kind: "complete" })])
    expect(adapterTokens).toEqual([token])
    const status = (await loadDevices()).devices[0]?.lastError
    expect(status).toMatchObject({ code: "delivery_failed", at: expect.any(Number) })
    const publicArtifacts = JSON.stringify({ logs, status, sent })
    expect(publicArtifacts).not.toContain(token)
    expect(publicArtifacts).not.toContain(privateKey)
  })
})
