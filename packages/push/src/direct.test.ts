import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { PushMessage, PushResult } from "@whispercode/push-provider"
import { deliverDirect } from "./direct"
import {
  loadDevices,
  recordError,
  register,
  type DevicePreferences,
  type DeviceRegistration,
  type DeviceRegistrationInput,
} from "./device"
import type { Item, Kind } from "./state"

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-direct-"))
  dirs.push(dir)
  process.env.OPENCODE_TEST_HOME = dir
}

function item(kind: Kind): Item {
  return {
    v: 1,
    event_id: `event-${kind}`,
    kind,
    session_id: "private/session/path",
    request_id: "private prompt content",
    occurred_at: 1,
    collapse_id: `private:${kind}`,
  }
}

function device(id: string, value: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    id,
    provider: "fcm",
    token: `${id}-token`.padEnd(32, "x"),
    tokenGeneration: 1,
    prefs,
    active: true,
    createdAt: 1,
    updatedAt: 1,
    ...value,
  }
}

function input(id: string): DeviceRegistrationInput {
  const value = device(id)
  return {
    id: value.id,
    provider: value.provider,
    token: value.token,
    tokenGeneration: value.tokenGeneration,
    prefs: value.prefs,
  }
}

describe("direct push delivery", () => {
  test("sends once only to active devices that enabled the event kind", async () => {
    const enabled = device("enabled")
    const disabled = device("disabled", { prefs: { ...prefs, complete: false } })
    const inactive = device("inactive", { active: false })
    const sent: string[] = []
    const updated: string[] = []

    const result = await deliverDirect(item("complete"), {
      devices: async () => [enabled, enabled, disabled, inactive],
      adapter: {
        send: async (token) => {
          sent.push(token)
          return { ok: true, invalid: false, code: "ok" }
        },
      },
      update: async (id) => {
        updated.push(id)
      },
    })

    expect(sent).toEqual([enabled.token])
    expect(updated).toEqual([enabled.id])
    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0 })
  })

  test("delivers tests to every active device regardless of event preferences", async () => {
    const active = device("active", {
      prefs: { complete: false, approval: false, question: false, error: false },
    })
    const sent: string[] = []

    const result = await deliverDirect(item("test"), {
      devices: async () => [active, device("inactive", { active: false })],
      adapter: {
        send: async (token) => {
          sent.push(token)
          return { ok: true, invalid: false, code: "ok" }
        },
      },
      update: async () => undefined,
    })

    expect(sent).toEqual([active.token])
    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0 })
  })

  test("returns deterministic zeros for an empty registry", async () => {
    const result = await deliverDirect(item("complete"), {
      devices: async () => [],
      adapter: { send: async () => ({ ok: true, invalid: false, code: "ok" }) },
      update: async () => undefined,
    })

    expect(result).toEqual({ attempted: 0, delivered: 0, failed: 0 })
  })

  test("counts a provider success as delivered when its registry update throws", async () => {
    const registration = device("success-update-error")

    const result = await deliverDirect(item("complete"), {
      devices: async () => [registration],
      adapter: { send: async () => ({ ok: true, invalid: false, code: "ok" }) },
      update: async () => {
        throw new Error(`private update failure ${registration.token}`)
      },
    })

    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0 })
    expect(JSON.stringify(result)).not.toContain(registration.token)
    expect(JSON.stringify(result)).not.toContain("private update failure")
  })

  test("counts a provider failure as failed when its registry update throws", async () => {
    const registration = device("failure-update-error")

    const result = await deliverDirect(item("complete"), {
      devices: async () => [registration],
      adapter: { send: async () => ({ ok: false, invalid: false, code: "fcm_transport_error" }) },
      update: async () => {
        throw new Error(`private update failure ${registration.token}`)
      },
    })

    expect(result).toEqual({ attempted: 1, delivered: 0, failed: 1 })
    expect(JSON.stringify(result)).not.toContain(registration.token)
    expect(JSON.stringify(result)).not.toContain("private update failure")
  })

  test("projects approved copy and identifiers without href or private item data", async () => {
    const copy: Record<Kind, [string, string]> = {
      complete: ["Response ready", "Tap to return to WhisperCode"],
      approval: ["Approval needed", "Open WhisperCode to respond"],
      question: ["Question waiting", "Open WhisperCode to respond"],
      error: ["Session error", "Open WhisperCode for details"],
      test: ["WhisperCode test", "Backend push delivery is working"],
    }

    for (const kind of Object.keys(copy) as Kind[]) {
      const messages: PushMessage[] = []
      const registration = device(`device-${kind}`)
      await deliverDirect(item(kind), {
        devices: async () => [registration],
        adapter: {
          send: async (_token, message) => {
            messages.push(message)
            return { ok: true, invalid: false, code: "ok" }
          },
        },
        update: async () => undefined,
      })

      expect(messages).toEqual([
        {
          deviceID: registration.id,
          deliveryID: `event-${kind}`,
          kind,
          title: copy[kind][0],
          body: copy[kind][1],
        },
      ])
      expect(JSON.stringify(messages)).not.toContain("private")
      expect(messages[0]).not.toHaveProperty("href")
    }
  })

  test("records success and clears the previous registry error", async () => {
    await home()
    await register(input("success"))
    await recordError("success", "previous_error")

    const result = await deliverDirect(item("complete"), {
      adapter: { send: async () => ({ ok: true, invalid: false, code: "provider_detail" }) },
    })
    const saved = (await loadDevices()).devices[0]!

    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0 })
    expect(saved.active).toBe(true)
    expect(saved.lastSuccessAt).toEqual(expect.any(Number))
    expect(saved.lastError).toBeUndefined()
  })

  test("deactivates invalid tokens but keeps transient and thrown failures active", async () => {
    await home()
    await Promise.all([register(input("invalid")), register(input("transient")), register(input("thrown"))])
    let started = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const result = await deliverDirect(item("complete"), {
      adapter: {
        send: (token): Promise<PushResult> => {
          started++
          if (started === 3) release()
          if (token.startsWith("thrown")) throw new Error(`secret provider detail ${token}`)
          return gate.then(() => {
            if (token.startsWith("invalid")) {
              return { ok: false, invalid: true, code: `secret provider detail ${token}` }
            }
            return { ok: false, invalid: false, code: `secret provider detail ${token}` }
          })
        },
      },
    })
    const saved = (await loadDevices()).devices.sort((a, b) => a.id.localeCompare(b.id))

    expect(result).toEqual({ attempted: 3, delivered: 0, failed: 3 })
    expect(saved.map((value) => ({ id: value.id, active: value.active, code: value.lastError?.code }))).toEqual([
      { id: "invalid", active: false, code: "invalid_token" },
      { id: "thrown", active: true, code: "delivery_failed" },
      { id: "transient", active: true, code: "delivery_failed" },
    ])
    expect(JSON.stringify(saved)).not.toContain("secret provider detail")
  })
})
