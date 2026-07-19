import { createFcmAdapter, type PushAdapter, type PushMessage, type PushResult } from "@whispercode/push-provider"
import { deactivate, loadDevices, recordError, recordSuccess, type DeviceRegistration } from "./device.js"
import type { Item } from "./state.js"

const copy = {
  complete: { title: "Response ready", body: "Tap to return to WhisperCode" },
  approval: { title: "Approval needed", body: "Open WhisperCode to respond" },
  question: { title: "Question waiting", body: "Open WhisperCode to respond" },
  error: { title: "Session error", body: "Open WhisperCode for details" },
  test: { title: "WhisperCode test", body: "Backend push delivery is working" },
} as const

export const DIRECT_CONCURRENCY = 8

export type DirectResult = {
  attempted: number
  delivered: number
  failed: number
}

export type DirectDependencies = {
  devices: () => Promise<DeviceRegistration[]>
  adapter: PushAdapter
  update: (deviceID: string, tokenGeneration: number, result: PushResult) => Promise<unknown>
}

export async function deliverDirect(item: Item, deps?: Partial<DirectDependencies>): Promise<DirectResult> {
  const devices = await (deps?.devices ?? (async () => (await loadDevices()).devices))()
  const adapter = deps?.adapter ?? createFcmAdapter()
  const update =
    deps?.update ??
    (async (deviceID: string, tokenGeneration: number, result: PushResult) => {
      if (result.ok) return await recordSuccess(deviceID, tokenGeneration)
      if (result.invalid) return await deactivate(deviceID, result.code, tokenGeneration)
      return await recordError(deviceID, result.code, tokenGeneration)
    })
  const unique = new Map<string, DeviceRegistration>()

  devices.forEach((device) => {
    if (!device.active) return
    if (item.kind !== "test" && !device.prefs[item.kind]) return
    if (!unique.has(device.id)) unique.set(device.id, device)
  })

  const targets = [...unique.values()]
  const outcomes = new Array<boolean>(targets.length)
  let cursor = 0
  await Promise.allSettled(
    Array.from({ length: Math.min(DIRECT_CONCURRENCY, targets.length) }, async () => {
      while (cursor < targets.length) {
        const index = cursor++
        const device = targets[index]!
        const message: PushMessage = {
          deviceID: device.id,
          deliveryID: item.event_id,
          kind: item.kind,
          ...copy[item.kind],
        }
        const result = await Promise.resolve()
          .then(() => adapter.send(device.token, message))
          .catch((): PushResult => ({ ok: false, invalid: false, code: "delivery_failed" }))
        const safe: PushResult = result.ok
          ? { ok: true, invalid: false, code: "ok" }
          : result.invalid
            ? { ok: false, invalid: true, code: "invalid_token" }
            : { ok: false, invalid: false, code: "delivery_failed" }
        await Promise.resolve()
          .then(() => update(device.id, device.tokenGeneration, safe))
          .catch(() => undefined)
        outcomes[index] = safe.ok
      }
    }),
  )
  const delivered = outcomes.filter(Boolean).length

  return {
    attempted: targets.length,
    delivered,
    failed: targets.length - delivered,
  }
}
