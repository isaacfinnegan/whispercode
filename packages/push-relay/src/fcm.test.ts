import { describe, expect, test } from "bun:test"
import { createAdapter } from "./fcm"

describe("push fcm", () => {
  test("sends an authenticated data-only HTTP v1 message", async () => {
    const seen: Array<{ url: string; auth: string | null; body: unknown }> = []
    const fcm = createAdapter({
      mode: "live",
      project: "project_1",
      serviceAccount: JSON.stringify({ project_id: "project_1" }),
      accessToken: async () => "access_1",
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          auth: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)),
        })
        return Response.json({ name: "projects/project_1/messages/1" })
      },
    })

    await expect(
      fcm.send({
        delivery: "dlv_abcdef",
        token: "fcm_token",
        kind: "complete",
        channel: "ch_1",
        session: "ses_1",
        collapse: "complete:ses_1",
      }),
    ).resolves.toEqual({ sent: true, mode: "live" })
    expect(seen).toEqual([
      {
        url: "https://fcm.googleapis.com/v1/projects/project_1/messages:send",
        auth: "Bearer access_1",
        body: {
          message: {
            token: "fcm_token",
            data: {
              v: "1",
              delivery_id: "dlv_abcdef",
              channel_id: "ch_1",
              kind: "complete",
              title: "OpenCode",
              body: "Session needs attention",
              session_id: "ses_1",
            },
            android: { priority: "high", collapse_key: "complete:ses_1" },
          },
        },
      },
    ])
  })

  test("marks an unregistered token invalid", async () => {
    const fcm = createAdapter({
      mode: "live",
      project: "project_1",
      serviceAccount: JSON.stringify({ project_id: "project_1" }),
      accessToken: async () => "access_1",
      fetch: async () => Response.json({ error: { status: "UNREGISTERED" } }, { status: 404 }),
    })

    await expect(fcm.send({ delivery: "dlv_1", token: "fcm_token", kind: "test", channel: "ch_1" })).resolves.toEqual({
      sent: false,
      mode: "live",
      code: "UNREGISTERED",
      invalid: true,
    })
  })
})
