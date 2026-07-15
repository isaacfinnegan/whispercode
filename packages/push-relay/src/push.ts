export type PushProvider = "apns" | "fcm"

export type PushMsg = {
  delivery: string
  token: string
  kind: string
  channel: string
  session?: string | null
  collapse?: string | null
}

export type PushRes = {
  sent: boolean
  mode: "mock" | "disabled" | "live"
  code?: string
  invalid?: boolean
}

export type PushAdapter = {
  send(msg: PushMsg): Promise<PushRes>
  close(): void
}
