import { GoogleAuth } from "google-auth-library"
import type { PushAdapter, PushMessage, PushResult } from "./index"

type Credentials = Record<string, unknown> & { project_id?: string }

type Opts = {
  projectID?: string
  serviceAccountJSON?: string
  accessToken?: () => Promise<string | null | undefined>
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  timeout?: number
}

type FcmError = {
  error?: {
    status?: unknown
    details?: unknown
  }
}

export function createFcmAdapter(opts?: Opts): PushAdapter {
  const serviceAccountJSON = opts?.serviceAccountJSON ?? process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
  const credentials = parseCredentials(serviceAccountJSON)
  const projectID = opts?.projectID ?? process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID ?? credentials?.project_id
  const accessToken = opts?.accessToken ?? createGoogleAccessToken(serviceAccountJSON)
  const fetch = opts?.fetch ?? globalThis.fetch

  return {
    async send(token, message) {
      if (!projectID || !accessToken) return { ok: false, invalid: false, code: "fcm_unconfigured" }

      try {
        const authorization = await accessToken()
        if (!authorization) return transportError()
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectID)}/messages:send`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${authorization}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ message: payload(token, message) }),
            signal: AbortSignal.timeout(opts?.timeout ?? 15_000),
          },
        )
        if (response.ok) return { ok: true, invalid: false, code: "ok" }
        if (response.status === 408 || response.status >= 500) return transportError()

        const body = (await response.json().catch(() => undefined)) as FcmError | undefined
        return classify(response.status, body)
      } catch {
        return transportError()
      }
    },
  }
}

export function createGoogleAccessToken(serviceAccountJSON?: string) {
  const credentials = parseCredentials(serviceAccountJSON ?? process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON)
  if (!credentials) return

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  })
  return async () => (await auth.getAccessToken()) ?? ""
}

function payload(token: string, message: PushMessage) {
  const data: Record<string, string> = {
    device_id: message.deviceID,
    title: message.title,
    body: message.body,
  }
  if (message.href !== undefined) data.href = message.href
  if (message.kind !== undefined) data.kind = message.kind
  if (message.deliveryID !== undefined) data.delivery_id = message.deliveryID

  return {
    token,
    data,
    android: { priority: "high" },
  }
}

function classify(status: number, body?: FcmError): PushResult {
  const state = typeof body?.error?.status === "string" ? body.error.status : undefined
  const details = Array.isArray(body?.error?.details) ? body.error.details : []
  const codes = details.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return []
    if (!("@type" in detail) || detail["@type"] !== "type.googleapis.com/google.firebase.fcm.v1.FcmError") return []
    const code = "errorCode" in detail ? detail.errorCode : undefined
    return typeof code === "string" ? [code] : []
  })
  const code = codes.find((value) => value === "UNREGISTERED" || value === "SENDER_ID_MISMATCH") ?? state

  if (code === "UNREGISTERED") return { ok: false, invalid: true, code: "fcm_unregistered" }
  if (code === "SENDER_ID_MISMATCH") return { ok: false, invalid: true, code: "fcm_sender_id_mismatch" }
  if (codes.includes("INVALID_ARGUMENT") || tokenViolation(details)) {
    return { ok: false, invalid: true, code: "fcm_invalid_argument" }
  }
  if (state === "INVALID_ARGUMENT") return { ok: false, invalid: false, code: "fcm_invalid_argument" }
  if (state) return { ok: false, invalid: false, code: `fcm_${normalize(state)}` }
  return { ok: false, invalid: false, code: `fcm_http_${status}` }
}

function tokenViolation(details: unknown[]) {
  return details.some((detail) => {
    if (!detail || typeof detail !== "object" || !("fieldViolations" in detail)) return false
    if (!Array.isArray(detail.fieldViolations)) return false
    return detail.fieldViolations.some((violation) => {
      if (!violation || typeof violation !== "object" || !("field" in violation)) return false
      return violation.field === "message.token"
    })
  })
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function transportError(): PushResult {
  return { ok: false, invalid: false, code: "fcm_transport_error" }
}

function parseCredentials(value?: string): Credentials | undefined {
  if (!value) return
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
    return parsed as Credentials
  } catch {
    return
  }
}
