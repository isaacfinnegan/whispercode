import { GoogleAuth } from "google-auth-library"
import type { PushAdapter, PushMsg, PushRes } from "./push"

type Mode = "mock" | "disabled" | "live"

type Opts = {
  mode?: Mode
  project?: string
  serviceAccount?: string
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  accessToken?: () => Promise<string>
}

export function createAdapter(opts?: Opts): PushAdapter {
  const serviceAccount = opts?.serviceAccount ?? process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
  const account = parse(serviceAccount)
  const project = opts?.project ?? process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID ?? account?.project_id
  const mode = opts?.mode ?? (project && serviceAccount ? "live" : "disabled")
  const fetch = opts?.fetch ?? globalThis.fetch
  const accessToken = opts?.accessToken ?? token(serviceAccount)

  return {
    async send(msg) {
      if (mode === "mock") return { sent: true, mode }
      if (mode !== "live" || !project || !accessToken)
        return { sent: false, mode: "disabled", code: "fcm_unconfigured" }
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ message: payload(msg) }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return { sent: true, mode }
      const body = (await res.json().catch(() => null)) as { error?: { status?: unknown } } | null
      const code = typeof body?.error?.status === "string" ? body.error.status : `http_${res.status}`
      return { sent: false, mode, code, invalid: code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH" }
    },
    close() {},
  }
}

export function payload(msg: PushMsg) {
  const data: Record<string, string> = {
    v: "1",
    delivery_id: msg.delivery,
    channel_id: msg.channel,
    kind: msg.kind,
    title: "OpenCode",
    body: msg.kind === "test" ? `Test notification ${msg.delivery.slice(-6)}` : "Session needs attention",
  }
  if (msg.session) data.session_id = msg.session
  return {
    token: msg.token,
    data,
    android: { priority: "high", ...(msg.collapse ? { collapse_key: msg.collapse } : {}) },
  }
}

function parse(value?: string) {
  if (!value) return
  try {
    return JSON.parse(value) as { project_id?: string }
  } catch {
    return
  }
}

function token(serviceAccount?: string) {
  if (!serviceAccount) return
  const credentials = parse(serviceAccount)
  if (!credentials) return
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] })
  return async () => (await auth.getAccessToken()) ?? ""
}
