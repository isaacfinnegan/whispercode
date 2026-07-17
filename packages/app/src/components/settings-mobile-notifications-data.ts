// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 for WhisperCode mobile push setup.
// Preserve these diagnostic row helpers when upstream changes settings rendering.

import type { PairState, PushDiag, PushState } from "@/context/platform"

type HostSummaryInput = {
  server?: string
  status?: "pending" | "registering" | "active" | "error" | "unregistering"
  retryAt?: number
  code?: string
  message?: string
}

type HostSummaryCopy = {
  unavailable: string
  registering: string
  active: string
  retrying: string
  missing: string
  failed: string
  unregistering: string
  select: string
}

const hostCopy: HostSummaryCopy = {
  unavailable: "Backend unavailable",
  registering: "Registering",
  active: "Active",
  retrying: "Retrying",
  missing: "Backend missing FCM credentials",
  failed: "Push delivery failed",
  unregistering: "Unregistering",
  select: "Select a backend",
}

export function hostSummary(input: HostSummaryInput, copy: HostSummaryCopy = hostCopy) {
  const body = input.server ?? copy.select
  if (!input.server) return { variant: "warning" as const, title: copy.unavailable, body }
  if (input.status === "active") return { variant: "success" as const, title: copy.active, body }
  if (input.status === "unregistering") return { variant: "info" as const, title: copy.unregistering, body }
  if (input.status === "error" && ["fcm_unconfigured", "fcm_not_configured"].includes(input.code ?? "")) {
    return { variant: "warning" as const, title: copy.missing, body }
  }
  if (input.status === "error" && input.retryAt !== undefined) {
    return { variant: "warning" as const, title: copy.retrying, body }
  }
  if (input.status === "error") return { variant: "error" as const, title: copy.failed, body }
  return { variant: "info" as const, title: copy.registering, body }
}

type Pair = {
  status?: PairState
  id?: string
  expires?: string
  channel?: string
  device?: string
}

type Input = {
  push?: PushState
  info?: PushDiag
  pair: Pair
  paired: boolean
  run: boolean
  phase?: string
  relay?: string
  fallback: string
}

function mark(value: boolean | undefined) {
  if (value === true) return "yes"
  if (value === false) return "no"
  return "unknown"
}

function clip(value?: string) {
  if (!value) return "-"
  if (value.length <= 24) return value
  return `${value.slice(0, 12)}...${value.slice(-8)}`
}

export function diagRows(input: Input) {
  const state =
    input.pair.status === "active"
      ? "active"
      : (input.pair.status ?? input.info?.pairStatus ?? (input.push?.paired ? "active" : "unpaired"))

  return [
    `permission: ${input.push?.permission ?? "unknown"}`,
    `allowed: ${mark(input.push?.allowed)}`,
    `registered: ${mark(input.push?.registered)}`,
    `token: ${mark(input.info?.token ?? input.push?.registered)}`,
    `token_pending: ${mark(input.info?.tokenPending)}`,
    `paired: ${mark(input.paired)}`,
    `pair: ${state}`,
    `pair_id: ${clip(input.info?.pairID ?? input.pair.id)}`,
    `pair_expires: ${input.info?.pairExpires ?? input.pair.expires ?? "-"}`,
    `channel: ${clip(input.push?.channel ?? input.pair.channel)}`,
    `device: ${clip(input.info?.device ?? input.pair.device)}`,
    `run: ${mark(input.run)}`,
    `phase: ${input.phase ?? "-"}`,
    `relay: ${input.info?.relay ?? input.relay ?? input.fallback}`,
    `last_code: ${input.info?.lastCode ?? "-"}`,
    `last_error: ${input.info?.lastError ?? "-"}`,
  ]
}
