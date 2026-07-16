import { describe, expect, test } from "bun:test"
import { createFcmAdapter } from "./fcm"

const message = {
  deviceID: "device-1",
  title: "Response ready",
  body: "Tap to return",
  href: "/workspace/session/ses_1",
  kind: "complete" as const,
  deliveryID: "delivery-1",
}

describe("createFcmAdapter", () => {
  test("sends string-only data in a data-only high-priority Android message", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const adapter = createFcmAdapter({
      projectID: "whispercode-pushes",
      accessToken: async () => "access-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} })
        return Response.json({ name: "projects/p/messages/1" })
      },
    })

    await expect(adapter.send("fcm-token", message)).resolves.toEqual({ ok: true, invalid: false, code: "ok" })
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.url).toBe("https://fcm.googleapis.com/v1/projects/whispercode-pushes/messages:send")
    expect(new Headers(request.init.headers).get("authorization")).toBe("Bearer access-token")
    expect(JSON.parse(String(request.init.body))).toEqual({
      message: {
        token: "fcm-token",
        data: {
          device_id: "device-1",
          title: "Response ready",
          body: "Tap to return",
          href: "/workspace/session/ses_1",
          kind: "complete",
          delivery_id: "delivery-1",
        },
        android: { priority: "high" },
      },
    })
  })

  test("omits absent optional data and collapse keys", async () => {
    let body: unknown
    const adapter = createFcmAdapter({
      projectID: "project-1",
      accessToken: async () => "access-token",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json({ name: "message-1" })
      },
    })

    await adapter.send("fcm-token", { deviceID: "device-1", title: "Title", body: "Body" })
    expect(body).toEqual({
      message: {
        token: "fcm-token",
        data: { device_id: "device-1", title: "Title", body: "Body" },
        android: { priority: "high" },
      },
    })
  })

  test.each([
    ["oauth", async () => Promise.reject(new Error("service-account-secret")), async () => Response.json({})],
    ["network", async () => "access-token", async () => Promise.reject(new Error("fcm-token"))],
    ["HTTP 408", async () => "access-token", async () => new Response("timeout", { status: 408 })],
    ["HTTP 500", async () => "access-token", async () => new Response("failure", { status: 500 })],
  ])("returns a sanitized transport result for %s failures", async (_name, accessToken, fetch) => {
    const adapter = createFcmAdapter({ projectID: "project-1", accessToken, fetch })
    const result = await adapter.send("fcm-token", message)

    expect(result).toEqual({ ok: false, invalid: false, code: "fcm_transport_error" })
    expect(JSON.stringify(result)).not.toContain("fcm-token")
    expect(JSON.stringify(result)).not.toContain("service-account-secret")
  })

  test.each([
    ["UNREGISTERED", "fcm_unregistered"],
    ["SENDER_ID_MISMATCH", "fcm_sender_id_mismatch"],
    ["INVALID_ARGUMENT", "fcm_invalid_argument"],
  ])("marks token-specific %s responses invalid", async (errorCode, code) => {
    const adapter = createFcmAdapter({
      projectID: "project-1",
      accessToken: async () => "access-token",
      fetch: async () =>
        Response.json(
          {
            error: {
              status: "INVALID_ARGUMENT",
              details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }],
            },
          },
          { status: 400 },
        ),
    })

    await expect(adapter.send("secret-registration-token", message)).resolves.toEqual({
      ok: false,
      invalid: true,
      code,
    })
  })

  test("marks message.token field violations invalid", async () => {
    const adapter = createFcmAdapter({
      projectID: "project-1",
      accessToken: async () => "access-token",
      fetch: async () =>
        Response.json(
          {
            error: {
              status: "INVALID_ARGUMENT",
              details: [{ fieldViolations: [{ field: "message.token", description: "secret-registration-token" }] }],
            },
          },
          { status: 400 },
        ),
    })

    await expect(adapter.send("secret-registration-token", message)).resolves.toEqual({
      ok: false,
      invalid: true,
      code: "fcm_invalid_argument",
    })
  })

  test("does not trust INVALID_ARGUMENT errorCode from arbitrary details", async () => {
    const adapter = createFcmAdapter({
      projectID: "project-1",
      accessToken: async () => "access-token",
      fetch: async () =>
        Response.json(
          {
            error: {
              status: "INVALID_ARGUMENT",
              details: [{ "@type": "example.com/UnrelatedError", errorCode: "INVALID_ARGUMENT" }],
            },
          },
          { status: 400 },
        ),
    })

    await expect(adapter.send("secret-registration-token", message)).resolves.toEqual({
      ok: false,
      invalid: false,
      code: "fcm_invalid_argument",
    })
  })

  test("does not over-classify generic INVALID_ARGUMENT responses", async () => {
    const adapter = createFcmAdapter({
      projectID: "project-1",
      accessToken: async () => "access-token",
      fetch: async () => Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 }),
    })

    await expect(adapter.send("secret-registration-token", message)).resolves.toEqual({
      ok: false,
      invalid: false,
      code: "fcm_invalid_argument",
    })
  })

  test.each([null, undefined, ""])("does not fetch when OAuth returns %p", async (token) => {
    let calls = 0
    const adapter = createFcmAdapter({
      projectID: "project-1",
      accessToken: async () => token,
      fetch: async () => {
        calls++
        return Response.json({ name: "message-1" })
      },
    })

    await expect(adapter.send("secret-registration-token", message)).resolves.toEqual({
      ok: false,
      invalid: false,
      code: "fcm_transport_error",
    })
    expect(calls).toBe(0)
  })
})
