import { describe, expect, test } from "bun:test"
import { cut, fcm, merge } from "./config"

describe("push config", () => {
  test("dedupes package entries by package name", () => {
    const list = merge(["@whisperopencode/push@0.1.0"], "@whisperopencode/push@0.x")
    expect(list).toEqual(["@whisperopencode/push@0.x"])
  })

  test("rewrites pinned package entry to unpinned spec", () => {
    const list = merge(["@whisperopencode/push@0.1.0"], "@whisperopencode/push")
    expect(list).toEqual(["@whisperopencode/push"])
  })

  test("removes package entries by package name", () => {
    const list = cut(["@whisperopencode/push@0.x", "foo@1.0.0"], "@whisperopencode/push")
    expect(list).toEqual(["foo@1.0.0"])
  })

  test("loads backend FCM credentials only from the secure environment", () => {
    const serviceAccountJSON = JSON.stringify({
      client_email: "push@example.com",
      private_key: "private-key",
    })
    expect(
      fcm({
        WHISPEROPENCODE_PUSH_FCM_PROJECT_ID: "project-1",
        WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON: serviceAccountJSON,
      }),
    ).toEqual({ projectID: "project-1", serviceAccountJSON })
  })

  test.each([
    {},
    { WHISPEROPENCODE_PUSH_FCM_PROJECT_ID: "project-1" },
    {
      WHISPEROPENCODE_PUSH_FCM_PROJECT_ID: "project-1",
      WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON: "not-json",
    },
  ])("rejects missing or malformed backend FCM configuration", (env) => {
    expect(fcm(env)).toBeUndefined()
  })

  test.each([
    ["whitespace project ID", " ", "push@example.com", "private-key"],
    ["whitespace client email", "project-1", "\t", "private-key"],
    ["whitespace private key", "project-1", "push@example.com", "\n"],
  ])("rejects structurally unusable backend FCM configuration: %s", (_name, project, email, key) => {
    expect(
      fcm({
        WHISPEROPENCODE_PUSH_FCM_PROJECT_ID: project,
        WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: email,
          private_key: key,
        }),
      }),
    ).toBeUndefined()
  })
})
