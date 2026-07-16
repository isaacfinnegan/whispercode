export type PushMessage = {
  deviceID: string
  title: string
  body: string
  href?: string
  kind?: "complete" | "approval" | "question" | "error" | "test"
  deliveryID?: string
}

export type PushResult = {
  ok: boolean
  invalid: boolean
  code: string
}

export type PushAdapter = {
  send(token: string, message: PushMessage): Promise<PushResult>
}

export { createFcmAdapter, createGoogleAccessToken } from "./fcm"
