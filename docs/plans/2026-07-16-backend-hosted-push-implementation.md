# Backend-Hosted Push Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Android push notifications directly from every authenticated, operator-controlled OpenCode backend without requiring a separately deployed push relay.

**Architecture:** The Android wrapper exposes a stable device ID, current FCM token generation, token, and preferences to the fork-owned app. The app registers that payload with each authenticated backend by starting the existing `opencode-push register --stdin` command through the authenticated PTY API and writing one JSON line over the PTY WebSocket. The fork-owned push plugin persists registrations locally and sends event notifications directly through a shared FCM HTTP v1 adapter; the existing relay mode remains available as legacy compatibility but is no longer the Android setup path.

**Tech Stack:** Bun/TypeScript, SolidJS, OpenCode plugin hooks and authenticated PTY APIs, Kotlin/Tauri Android bridge, Firebase Cloud Messaging HTTP v1, `google-auth-library`, JSON owner-only state files, Robolectric/MockWebServer, Bun tests.

---

## Scope Boundaries

Do not modify:

- `packages/opencode/**`
- public Protocol or Server `HttpApi` definitions
- generated SDK/client files
- desktop or iOS implementations
- OpenCode server authentication or PTY protocol

The implementation may modify only fork-owned push packages, fork-owned app divergence files, Android wrapper/plugin files, package manifests/lockfile, and push documentation.

Keep the external relay implementation and its commands working for existing installations. Direct backend delivery is the Android default, not a destructive migration of relay state.

## File Structure

- `packages/push-provider/`: shared provider-neutral push result/message types and the FCM HTTP v1 adapter used by both direct backend delivery and the legacy relay.
- `packages/push/src/device.ts`: owner-only local device registry, idempotent registration, preference updates, deactivation, and sanitized status projection.
- `packages/push/src/direct.ts`: direct event-to-FCM fan-out and failure classification.
- `packages/push/src/cmd.ts`: `register --stdin`, `unregister --device`, `status`, and `test --device` CLI surfaces.
- `packages/push/src/index.ts`: plugin event hook chooses direct delivery when local registrations exist while retaining relay compatibility.
- `packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt`: stable direct-push device ID and token generation persistence.
- `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`: private native command returning the one-time registration payload.
- `packages/android/src/entry-android.tsx`: maps the private native command into a fork-owned app platform method.
- `packages/app/src/utils/push-host.ts`: authenticated PTY command transport with stdin JSON and sanitized output.
- `packages/app/src/context/push-host.tsx`: per-server automatic registration, retry/unregister state, and selected-server test action.
- `packages/app/src/components/settings-mobile-notifications.tsx`: per-server direct-delivery status and test controls.

### Task 1: Extract a Shared FCM Provider Adapter

**Files:**
- Create: `packages/push-provider/package.json`
- Create: `packages/push-provider/tsconfig.json`
- Create: `packages/push-provider/src/index.ts`
- Create: `packages/push-provider/src/fcm.ts`
- Create: `packages/push-provider/src/fcm.test.ts`
- Modify: `packages/push-relay/package.json`
- Modify: `packages/push-relay/src/fcm.ts`
- Modify: `packages/push-relay/src/push.ts`
- Modify: `bun.lock`

- [ ] **Step 1: Write shared adapter contract tests**

Create tests that prove data-only FCM payloads, OAuth/network failures, invalid-token classification, and secret-free errors:

```ts
import { describe, expect, test } from "bun:test"
import { createFcmAdapter } from "./fcm"

describe("createFcmAdapter", () => {
  test("sends a data-only Android notification", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const adapter = createFcmAdapter({
      projectID: "whispercode-pushes",
      accessToken: async () => "access-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init })
        return new Response(JSON.stringify({ name: "projects/p/messages/1" }), { status: 200 })
      },
    })

    const result = await adapter.send("fcm-token", {
      deviceID: "device-1",
      title: "Response ready",
      body: "Tap to return",
      href: "/workspace/session/ses_1",
      kind: "complete",
      deliveryID: "delivery-1",
    })

    expect(result).toEqual({ ok: true, invalid: false, code: "ok" })
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
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

  test("marks UNREGISTERED tokens invalid without returning the token", async () => {
    const adapter = createFcmAdapter({
      projectID: "whispercode-pushes",
      accessToken: async () => "access-token",
      fetch: async () =>
        new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), {
          status: 404,
        }),
    })
    expect(
      await adapter.send("secret-token", {
        deviceID: "device-1",
        title: "Test",
        body: "Test body",
        kind: "test",
        deliveryID: "delivery-2",
      }),
    ).toEqual({
      ok: false,
      invalid: true,
      code: "fcm_unregistered",
    })
  })
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `rtk bun test packages/push-provider/src/fcm.test.ts`

Expected: FAIL because `packages/push-provider/src/fcm.ts` does not exist.

- [ ] **Step 3: Implement the shared package and adapter**

Create the package manifest and TypeScript config:

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "@whispercode/push-provider",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "bun test src", "typecheck": "tsgo --noEmit" },
  "dependencies": { "google-auth-library": "10.5.0" },
  "devDependencies": {
    "@tsconfig/bun": "catalog:",
    "@types/bun": "catalog:",
    "@types/node": "catalog:",
    "@typescript/native-preview": "catalog:",
    "typescript": "catalog:"
  }
}
```

```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

Define the stable provider boundary in `src/index.ts`:

```ts
export type PushMessage = {
  deviceID: string
  title: string
  body: string
  href?: string
  kind: "complete" | "approval" | "question" | "error" | "test"
  deliveryID: string
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
```

Implement `createFcmAdapter` so it catches OAuth, fetch, DNS, timeout, HTTP 408, and HTTP 5xx failures as `{ ok:false, invalid:false, code:"fcm_transport_error" }`, never includes tokens or service-account data in errors, omits collapse keys, and maps `UNREGISTERED`, token-specific `INVALID_ARGUMENT`, and `SENDER_ID_MISMATCH` responses to `invalid:true`. Implement `createGoogleAccessToken` with `google-auth-library` and the existing environment-compatible service-account JSON shape.

- [ ] **Step 4: Point the legacy relay at the shared adapter**

Change relay-local files to re-export shared types/adapter without changing relay behavior:

```ts
export type { PushAdapter, PushMessage as PushMsg, PushResult as PushRes } from "@whispercode/push-provider"
export { createFcmAdapter, createGoogleAccessToken } from "@whispercode/push-provider"
```

Add `"@whispercode/push-provider": "workspace:*"` to the relay and remove its direct `google-auth-library` dependency after the shared package owns it.

- [ ] **Step 5: Run provider and relay verification**

Run:

```sh
rtk bun test packages/push-provider/src
rtk bun run --cwd packages/push-provider typecheck
rtk bun run --cwd packages/push-relay test
rtk bun run --cwd packages/push-relay typecheck
```

Expected: all tests pass and relay behavior remains unchanged.

- [ ] **Step 6: Commit the shared provider extraction**

```sh
rtk git add packages/push-provider packages/push-relay/package.json packages/push-relay/src/fcm.ts packages/push-relay/src/push.ts bun.lock
rtk git commit -m "refactor(push): share FCM provider adapter"
```

### Task 2: Add an Owner-Only Backend Device Registry

**Files:**
- Create: `packages/push/src/device.ts`
- Create: `packages/push/src/device.test.ts`
- Modify: `packages/push/src/path.ts`

- [ ] **Step 1: Write registry behavior tests**

Cover first registration, idempotent update, preference update, unregister, invalid-token deactivation, sanitized status, and file mode:

```ts
test("registers and updates one device without duplicating it", async () => {
  await register({
    id: "device-1",
    provider: "fcm",
    token: "token-a",
    tokenGeneration: 1,
    prefs: { complete: true, approval: true, question: true, error: true },
  })
  await register({
    id: "device-1",
    provider: "fcm",
    token: "token-b",
    tokenGeneration: 2,
    prefs: { complete: false, approval: true, question: true, error: true },
  })

  const data = await loadDevices()
  expect(data.devices).toHaveLength(1)
  expect(data.devices[0].token).toBe("token-b")
  expect(data.devices[0].tokenGeneration).toBe(2)
  expect(await status()).toEqual([
    expect.objectContaining({ id: "device-1", active: true, tokenGeneration: 2 }),
  ])
  expect(JSON.stringify(await status())).not.toContain("token-b")
})
```

- [ ] **Step 2: Run the registry tests and verify RED**

Run: `rtk bun test packages/push/src/device.test.ts`

Expected: FAIL because the registry module is missing.

- [ ] **Step 3: Add registry types and atomic persistence**

Use this exact persisted shape:

```ts
export type DeviceRegistration = {
  id: string
  provider: "fcm"
  token: string
  tokenGeneration: number
  prefs: { complete: boolean; approval: boolean; question: boolean; error: boolean }
  active: boolean
  createdAt: number
  updatedAt: number
  lastSuccessAt?: number
  lastError?: { code: string; at: number }
}

type DeviceFile = { version: 1; devices: DeviceRegistration[] }
```

Persist to `path.join(stateDir(), "whisperopencode-push-devices.json")` via a same-directory temporary file, `chmod 0o600`, and atomic rename. Reject IDs longer than 128 bytes, tokens outside 32..8192 bytes, non-integer/negative generations, unknown providers, and non-boolean preferences. Never log or return `token` from `status()`.

- [ ] **Step 4: Run registry tests and package tests**

Run:

```sh
rtk bun test packages/push/src/device.test.ts
rtk bun test packages/push/src
```

Expected: all tests pass.

- [ ] **Step 5: Commit the device registry**

```sh
rtk git add packages/push/src/device.ts packages/push/src/device.test.ts packages/push/src/path.ts
rtk git commit -m "feat(push): persist backend device registrations"
```

### Task 3: Implement Direct Backend-to-FCM Delivery

**Files:**
- Create: `packages/push/src/direct.ts`
- Create: `packages/push/src/direct.test.ts`
- Modify: `packages/push/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Write direct fan-out tests**

```ts
test("sends only to active devices that enabled the event kind", async () => {
  const sent: string[] = []
  const result = await deliverDirect(item("complete"), {
    devices: async () => [enabled, { ...disabled, prefs: { ...disabled.prefs, complete: false } }],
    adapter: { send: async (token) => (sent.push(token), { ok: true, invalid: false, code: "ok" }) },
    update: async () => undefined,
  })
  expect(sent).toEqual([enabled.token])
  expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0 })
})

test("deactivates only invalid tokens and keeps transient failures active", async () => {
  const updates: Array<{ id: string; active: boolean; code: string }> = []
  const devices = [
    { ...enabled, id: "invalid", token: "invalid-token" },
    { ...enabled, id: "transient", token: "transient-token" },
  ]
  await deliverDirect(item("complete"), {
    devices: async () => devices,
    adapter: {
      send: async (token) =>
        token === "invalid-token"
          ? { ok: false, invalid: true, code: "fcm_unregistered" }
          : { ok: false, invalid: false, code: "fcm_transport_error" },
    },
    update: async (id, result) => updates.push({ id, active: !result.invalid, code: result.code }),
  })
  expect(updates).toEqual([
    { id: "invalid", active: false, code: "fcm_unregistered" },
    { id: "transient", active: true, code: "fcm_transport_error" },
  ])
})
```

- [ ] **Step 2: Run the direct-delivery tests and verify RED**

Run: `rtk bun test packages/push/src/direct.test.ts`

Expected: FAIL because `deliverDirect` is missing.

- [ ] **Step 3: Implement message projection and delivery**

Map existing event items without adding private prompt content:

```ts
const copy = {
  complete: { title: "Response ready", body: "Tap to return to WhisperCode" },
  approval: { title: "Approval needed", body: "Open WhisperCode to respond" },
  question: { title: "Question waiting", body: "Open WhisperCode to respond" },
  error: { title: "Session error", body: "Open WhisperCode for details" },
  test: { title: "WhisperCode test", body: "Backend push delivery is working" },
} as const
```

Use `deliveryID = item.event_id` and set `deviceID` separately for each registration. The current backend item has no approved route that avoids filesystem data, so omit `href` in this release; a notification tap opens or resumes WhisperCode without a fabricated route. Process devices with `Promise.allSettled`, and ensure plugin event handling never throws because one provider request failed.

- [ ] **Step 4: Add package dependencies and verify**

Add `"@whispercode/push-provider": "workspace:*"` to `packages/push/package.json`, then run:

```sh
rtk bun install
rtk bun test packages/push/src/direct.test.ts
rtk bun test packages/push/src
```

Expected: all tests pass.

- [ ] **Step 5: Commit direct delivery**

```sh
rtk git add packages/push/src/direct.ts packages/push/src/direct.test.ts packages/push/package.json bun.lock
rtk git commit -m "feat(push): deliver backend events directly to FCM"
```

### Task 4: Add Secure Registration and Management CLI Commands

**Files:**
- Modify: `packages/push/src/cmd.ts`
- Modify: `packages/push/src/cmd.test.ts`
- Modify: `packages/push/src/cli.ts`

- [ ] **Step 1: Write CLI contract tests**

Test one-line stdin registration and sanitized JSON output:

```ts
test("register --stdin consumes one JSON line and never echoes the token", async () => {
  const io = memoryIO(JSON.stringify(registration) + "\n")
  await run(["register", "--stdin"], io)
  expect(io.stdout).toContain('"ok":true')
  expect(io.stdout).toContain('"device":"device-1"')
  expect(io.stdout).not.toContain(registration.token)
})

test("unregister --device deactivates only the selected device", async () => {
  await run(["unregister", "--device", "device-1"], memoryIO())
  expect((await status()).find((item) => item.id === "device-1")?.active).toBe(false)
})
```

Also cover malformed JSON, oversized input (maximum 16 KiB), missing newline, unknown fields, `status --json`, and `test --device`.

- [ ] **Step 2: Run the CLI tests and verify RED**

Run: `rtk bun test packages/push/src/cmd.test.ts`

Expected: FAIL because direct registration commands are not implemented.

- [ ] **Step 3: Implement exact command contracts**

Accept this registration JSON only:

```ts
type RegisterInput = {
  version: 1
  device: string
  provider: "fcm"
  token: string
  token_generation: number
  prefs: { complete: boolean; approval: boolean; question: boolean; error: boolean }
}
```

Commands and safe output:

```text
opencode-push register --stdin
{"ok":true,"device":"device-1","token_generation":2}

opencode-push unregister --device device-1
{"ok":true,"device":"device-1","active":false}

opencode-push status --json
{"mode":"direct","configured":true,"devices":[{"id":"device-1","active":true,"token_generation":2}]}

opencode-push test --device device-1
{"ok":true,"device":"device-1"}
```

Read exactly one line from stdin, stop after 16 KiB, parse/validate before persistence, and ensure caught errors return stable codes without raw input.

- [ ] **Step 4: Run CLI and package tests**

Run:

```sh
rtk bun test packages/push/src/cmd.test.ts
rtk bun test packages/push/src
```

Expected: all tests pass.

- [ ] **Step 5: Commit CLI registration**

```sh
rtk git add packages/push/src/cmd.ts packages/push/src/cmd.test.ts packages/push/src/cli.ts
rtk git commit -m "feat(push): add direct device registration commands"
```

### Task 5: Connect the Plugin Event Hook to Direct Delivery

**Files:**
- Modify: `packages/push/src/index.ts`
- Create: `packages/push/src/index.test.ts`
- Modify: `packages/push/src/config.ts`
- Modify: `packages/push/src/config.test.ts`
- Modify: `packages/push/README.md`

- [ ] **Step 1: Write plugin mode-selection tests**

```ts
test("direct registrations receive events without an external relay", async () => {
  const plugin = await createPlugin({ direct: fakeDirect, relay: fakeRelay })
  await plugin.event!({ event: idleEvent("ses_1") })
  expect(fakeDirect.items).toHaveLength(1)
  expect(fakeRelay.items).toHaveLength(0)
})

test("legacy relay mode remains available when explicitly configured", async () => {
  const plugin = await createPlugin({ direct: fakeDirect, relay: fakeRelay, mode: "relay" })
  await plugin.event!({ event: idleEvent("ses_1") })
  expect(fakeRelay.items).toHaveLength(1)
  expect(fakeDirect.items).toHaveLength(0)
})
```

- [ ] **Step 2: Run plugin tests and verify RED**

Run: `rtk bun test packages/push/src/index.test.ts packages/push/src/config.test.ts`

Expected: FAIL because the plugin does not select direct delivery.

- [ ] **Step 3: Implement direct-first mode selection**

Use these rules:

```ts
if (config.mode === "relay") await relay.publish(item)
else if (await devices.hasActive()) await direct.deliver(item)
```

Registration sets local mode to `direct`; existing explicit `relay` mode is preserved. Missing FCM environment configuration records a sanitized `fcm_not_configured` status and does not block the OpenCode event hook. Load service-account JSON only inside the backend process from `WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON`; never write it to disk.

- [ ] **Step 4: Document backend environment configuration**

Document:

```sh
export WHISPEROPENCODE_PUSH_FCM_PROJECT_ID="whispercode-pushes"
export WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON="$(< /secure/path/firebase-service-account.json)"
```

State that each controlled backend needs the same credential, the JSON must not be committed or logged, and third-party backends must use their own Firebase project or an explicitly trusted broker.

- [ ] **Step 5: Run push package verification**

Run:

```sh
rtk bun test packages/push/src
rtk bun run --cwd packages/push typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 6: Commit plugin integration**

```sh
rtk git add packages/push/src/index.ts packages/push/src/index.test.ts packages/push/src/config.ts packages/push/src/config.test.ts packages/push/README.md
rtk git commit -m "feat(push): send notifications from OpenCode backends"
```

### Task 6: Expose a Stable Android Registration Payload

**Files:**
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/test/java/SecurePreferencesManagerTest.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/test/java/PushStateTest.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/src/mobile.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/src/commands.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/src/lib.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/build.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/permissions/default.toml`

- [ ] **Step 1: Write persistence and payload tests**

```kotlin
@Test
fun directRegistrationIdentityIsStableAndTokenGenerationChangesOnlyWithToken() {
    val prefs = manager()
    val id = prefs.getOrCreateDirectDeviceId()
    prefs.saveFcmToken("token-a")
    assertEquals(1L, prefs.getFcmTokenGeneration())
    prefs.saveFcmToken("token-a")
    assertEquals(1L, prefs.getFcmTokenGeneration())
    prefs.saveFcmToken("token-b")
    assertEquals(2L, prefs.getFcmTokenGeneration())
    assertEquals(id, manager().getOrCreateDirectDeviceId())
}
```

Test that the command returns full booleans and token only in the command result, while normal diagnostics/state omit the token.

- [ ] **Step 2: Run JBR tests and verify RED**

Run from `packages/android/src-tauri/gen/android`:

```sh
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  rtk ./gradlew :tauri-plugin-mobile-bridge:testDebugUnitTest --tests '*SecurePreferencesManagerTest' --tests '*PushStateTest'
```

Expected: FAIL because direct registration APIs do not exist.

- [ ] **Step 3: Add stable native identity and generation**

Persist encrypted keys `push.direct_device_id` and `push.fcm_token_generation`. Generate the ID once with `UUID.randomUUID().toString()`. Increment generation only when a nonblank token differs from the stored token. Preserve both across relay credential clearing and relay URL changes.

- [ ] **Step 4: Add a private Android-only command**

Implement `getPushRegistration` with this JSON result:

```json
{
  "version": 1,
  "device": "stable-uuid",
  "provider": "fcm",
  "token": "current-fcm-token",
  "token_generation": 2,
  "prefs": { "complete": true, "approval": true, "question": true, "error": true }
}
```

Reject with stable codes `push_permission_required` or `push_registration_pending` when unavailable. Add the Android-only Rust forwarder/command, command-generation entry, and default permission. Do not expose it to desktop/iOS or shared generated APIs.

- [ ] **Step 5: Run native verification**

```sh
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  rtk ./gradlew :tauri-plugin-mobile-bridge:testDebugUnitTest --rerun-tasks
rtk cargo check --manifest-path packages/android/src-tauri/mobile-bridge/Cargo.toml
```

Expected: tests and cargo check pass.

- [ ] **Step 6: Commit native registration support**

Stage only the listed Kotlin/Rust sources, `build.rs`, and `permissions/default.toml`; never stage generated permission references/schemas/command TOMLs, Firebase credentials, build outputs, `node_modules`, or generated Cargo locks.

```sh
rtk git add \
  packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt \
  packages/android/src-tauri/mobile-bridge/android/src/test/java/SecurePreferencesManagerTest.kt \
  packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt \
  packages/android/src-tauri/mobile-bridge/android/src/test/java/PushStateTest.kt \
  packages/android/src-tauri/mobile-bridge/src/mobile.rs \
  packages/android/src-tauri/mobile-bridge/src/commands.rs \
  packages/android/src-tauri/mobile-bridge/src/lib.rs \
  packages/android/src-tauri/mobile-bridge/build.rs \
  packages/android/src-tauri/mobile-bridge/permissions/default.toml
rtk git commit -m "feat(android): expose backend push registration"
```

### Task 7: Add Authenticated PTY Registration Transport

**Files:**
- Create: `packages/app/src/utils/push-host-install.ts`
- Create: `packages/app/src/utils/push-host-install.test.ts`
- Create: `packages/app/src/utils/push-host.ts`
- Create: `packages/app/src/utils/push-host.test.ts`
- Modify: `packages/app/src/utils/push-plugin.ts`
- Modify: `packages/app/src/context/platform.tsx`
- Modify: `packages/android/src/bridge.ts`
- Modify: `packages/android/src/entry-android.tsx`
- Modify: `packages/android/src/push-native.ts`
- Modify: `packages/android/src/push-native.test.ts`

- [ ] **Step 1: Write transport and native mapping tests**

```ts
test("register sends the token only in PTY stdin", async () => {
  const trace = createPtyTrace()
  await registerPushHost({
    server: connection,
    payload: registration,
    fetch: trace.fetch,
    socket: trace.socket,
  })
  expect(trace.command).toBe("npx")
  expect(trace.args).toEqual([
    "--yes",
    "--prefix",
    ".",
    "--package=@whisperopencode/push",
    "opencode-push",
    "register",
    "--stdin",
  ])
  expect(JSON.stringify(trace.createBody)).not.toContain(registration.token)
  expect(trace.websocketURL).not.toContain(registration.token)
  expect(trace.stdin).toBe(JSON.stringify(registration) + "\n")
  expect(trace.output).not.toContain(registration.token)
})
```

Cover authentication headers, command timeout, output cap, malformed output, PTY deletion in `finally`, unregister, status, and test commands. Map command-not-found or an unrecognized `register` command to `push_plugin_upgrade_required` so an older backend plugin produces an actionable, sanitized status.

- [ ] **Step 2: Run app/Android tests and verify RED**

```sh
rtk bun run --cwd packages/app test:unit -- ./src/utils/push-host-install.test.ts ./src/utils/push-host.test.ts
rtk bun run --cwd packages/android test
```

Expected: FAIL because the transport and platform command are missing.

- [ ] **Step 3: Map the native payload into the app platform**

Add a fork-owned optional platform method:

```ts
export type PushRegistration = {
  version: 1
  device: string
  provider: "fcm"
  token: string
  token_generation: number
  prefs: PushPrefs
}

getPushRegistration?(): Promise<PushRegistration>
```

Map Android bridge `getPushRegistration` to native `get_push_registration`; validate the payload strictly in `push-native.ts`. Do not place it in `PushState`, diagnostics, local storage, telemetry, or console logs.

- [ ] **Step 4: Ensure the fork-owned plugin is active on the backend**

Before registration, read the existing authenticated `/global/config`, add `@whisperopencode/push` with the existing `addPush()` helper when absent, patch the config, and use the existing host refresh/reconnect behavior. Extract this into `push-host-install.ts` rather than duplicating it inside the coordinator. Tests must prove an already-installed plugin causes no config write and a newly added plugin is available before PTY registration starts.

Add an argv builder to `push-plugin.ts` so the token is never interpolated into a shell command:

```ts
export function runPush(args: string[], tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") return { command: "bunx", args: [PushPlugin.spec, ...args] }
  return {
    command: "npx",
    args: ["--yes", "--prefix", ".", `--package=${PushPlugin.spec}`, PushPlugin.bin, ...args],
  }
}
```

- [ ] **Step 5: Implement the PTY helper**

Use the current authenticated server connection and existing `/pty` lifecycle. Start a short-lived PTY with an argv array, connect to `/pty/{id}/connect`, write one JSON line only after open, parse one bounded JSON response, close, and delete the PTY in `finally`. Cap output at 32 KiB and timeout after 15 seconds. Redact the registration token from every thrown message before it reaches UI state.

- [ ] **Step 6: Run transport verification**

```sh
rtk bun run --cwd packages/app test:unit -- ./src/utils/push-host-install.test.ts ./src/utils/push-host.test.ts
rtk bun run --cwd packages/app typecheck
rtk bun run --cwd packages/android test
rtk bun run --cwd packages/android typecheck
```

Expected: tests/typechecks pass.

- [ ] **Step 7: Commit transport integration**

```sh
rtk git add packages/app/src/utils/push-host-install.ts packages/app/src/utils/push-host-install.test.ts packages/app/src/utils/push-host.ts packages/app/src/utils/push-host.test.ts packages/app/src/utils/push-plugin.ts packages/app/src/context/platform.tsx packages/android/src/bridge.ts packages/android/src/entry-android.tsx packages/android/src/push-native.ts packages/android/src/push-native.test.ts
rtk git commit -m "feat(app): register push devices through backend PTY"
```

### Task 8: Coordinate Automatic Per-Server Registration

**Files:**
- Create: `packages/app/src/context/push-host.tsx`
- Create: `packages/app/src/context/push-host.test.ts`
- Modify: `packages/app/src/app.tsx`

- [ ] **Step 1: Write pure coordinator tests**

```ts
test("registers once per authenticated server and token generation", async () => {
  const state = createPushHostState()
  expect(shouldRegister(state, { server: "https://one", generation: 2, allowed: true })).toBe(true)
  state.success("https://one", 2)
  expect(shouldRegister(state, { server: "https://one", generation: 2, allowed: true })).toBe(false)
  expect(shouldRegister(state, { server: "https://two", generation: 2, allowed: true })).toBe(true)
  expect(shouldRegister(state, { server: "https://one", generation: 3, allowed: true })).toBe(true)
})

test("queues unregister when a server is unavailable", async () => {
  const state = createPushHostState()
  state.success("https://one", 2)
  state.unregisterFailed("https://one", { code: "host_unavailable", message: "Backend unavailable" })
  expect(state.get("https://one")?.status).toBe("unregistering")
  expect(shouldRetryUnregister(state.get("https://one")!, Date.now() + 30_000)).toBe(true)
})
```

- [ ] **Step 2: Run coordinator tests and verify RED**

Run: `rtk bun run --cwd packages/app test:unit -- ./src/context/push-host.test.ts`

Expected: FAIL because the context does not exist.

- [ ] **Step 3: Implement persisted per-server state**

Persist only nonsecret metadata:

```ts
type HostPushState = {
  server: string
  device: string
  tokenGeneration: number
  status: "pending" | "registering" | "active" | "error" | "unregistering"
  updatedAt: number
  retryAt?: number
  lastError?: { code: string; message: string }
}
```

Do not persist the FCM token. Normalize server identity with `ServerConnection.key`. Back off retry intervals at 5s, 30s, 2m, and 10m; resume on online/focus/`opencode:resume` and server health recovery. Coalesce concurrent attempts by server key.

- [ ] **Step 4: Mount the coordinator and define lifecycle rules**

Replace `PushRelayProvider`/`PushPairProvider` in the shared shell with `PushHostProvider` for Android direct mode. Retain legacy providers only for iOS or an explicitly configured legacy relay. Automatic registration requires: Android platform, authorized permission, native token available, authenticated healthy server, and notifications enabled. Removing a server or disabling all push preferences calls unregister; failed unregister remains pending without deleting local metadata.

For this operator-controlled release, adding and successfully authenticating a server in WhisperCode is the explicit trust decision that allows automatic registration; do not add a second prompt. Preserve the server-keyed state boundary so a future third-party-server release can add a stricter trust policy without changing the backend CLI contract.

- [ ] **Step 5: Run coordinator and app verification**

```sh
rtk bun run --cwd packages/app test:unit -- ./src/context/push-host.test.ts
rtk bun run --cwd packages/app typecheck
```

Expected: tests/typecheck pass.

- [ ] **Step 6: Commit automatic host registration**

```sh
rtk git add packages/app/src/context/push-host.tsx packages/app/src/context/push-host.test.ts packages/app/src/app.tsx
rtk git commit -m "feat(app): register push with each OpenCode backend"
```

### Task 9: Replace Relay Pairing UI with Per-Server Status

**Files:**
- Modify: `packages/app/src/components/settings-mobile-notifications.tsx`
- Modify: `packages/app/src/components/settings-mobile-notifications.test.ts`
- Modify: `packages/app/src/components/settings-mobile-notifications-data.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/utils/push-test.ts`
- Modify: `packages/app/src/utils/push-test.test.ts`

- [ ] **Step 1: Write settings and test-action regressions**

```ts
test("Android settings show selected backend registration status", () => {
  const summary = hostSummary({
    server: "https://backend.example",
    status: "active",
    configured: true,
  })
  expect(summary.title).toBe("Push delivery active")
  expect(summary.body).toContain("backend.example")
})

test("Send Test targets the selected backend", async () => {
  const calls: string[] = []
  await sendHostPushTest({ selected: "https://backend.example", test: async (server) => calls.push(server) })
  expect(calls).toEqual(["https://backend.example"])
})
```

- [ ] **Step 2: Run UI utility tests and verify RED**

```sh
rtk bun run --cwd packages/app test:unit -- ./src/components/settings-mobile-notifications.test.ts ./src/utils/push-test.test.ts
```

Expected: FAIL because host status/test behavior is missing.

- [ ] **Step 3: Implement Android direct-delivery settings**

For Android, show:

- native permission/token state
- selected backend name
- `Registering`, `Active`, `Retrying`, `Backend missing FCM credentials`, or sanitized failure
- preference toggles whose changes re-register the selected backend
- `Send Test` enabled only when selected backend status is active
- `Retry` and `Unregister` actions

Remove relay URL and pair/claim controls from the Android branch. Keep iOS legacy UI unchanged. Never render token, service-account data, PTY output, or raw backend stack traces.

- [ ] **Step 4: Route test push through the selected backend**

`sendPushTest` must call `PushHostContext.test(serverKey)` for Android direct mode. Preserve the native/relay path only for iOS/legacy mode. A failed backend test must return a stable sanitized message such as `Backend push delivery is not configured`.

- [ ] **Step 5: Run app tests and typecheck**

```sh
rtk bun run --cwd packages/app test:unit -- ./src/components/settings-mobile-notifications.test.ts ./src/utils/push-test.test.ts ./src/context/push-host.test.ts
rtk bun run --cwd packages/app typecheck
```

Expected: tests/typecheck pass.

- [ ] **Step 6: Commit per-server settings**

```sh
rtk git add packages/app/src/components/settings-mobile-notifications.tsx packages/app/src/components/settings-mobile-notifications.test.ts packages/app/src/components/settings-mobile-notifications-data.ts packages/app/src/i18n/en.ts packages/app/src/utils/push-test.ts packages/app/src/utils/push-test.test.ts
rtk git commit -m "feat(app): show backend push delivery status"
```

### Task 10: Add Security, Migration, and Multi-Server Integration Coverage

**Files:**
- Create: `packages/app/src/utils/push-host.integration.test.ts`
- Create: `packages/push/src/direct.integration.test.ts`
- Modify: `packages/push/src/cmd.test.ts`
- Modify: `packages/app/src/context/push-host.test.ts`
- Modify: `packages/push/README.md`
- Modify: `docs/specs/2026-07-16-backend-hosted-push-design.md`

- [ ] **Step 1: Add a two-server integration test**

```ts
test("one Android device registers independently with two backends", async () => {
  const one = fakeBackend("one")
  const two = fakeBackend("two")
  await coordinator.register(one.connection, registration)
  await coordinator.register(two.connection, registration)
  expect(one.devices()).toEqual(["device-1"])
  expect(two.devices()).toEqual(["device-1"])
  await one.publish(event("complete"))
  await two.publish(event("approval"))
  expect(one.fcm).toHaveLength(1)
  expect(two.fcm).toHaveLength(1)
})
```

- [ ] **Step 2: Add security assertions**

Assert the exact token and service-account private key do not appear in command argv, PTY URL/create body, plugin logs, CLI output, persisted app state, `status`, diagnostics, or thrown UI errors. Assert backend registry mode is `0600` and malformed/oversized stdin is rejected before writing state.

- [ ] **Step 3: Add legacy coexistence tests**

Prove an existing explicit `mode:"relay"` installation keeps using relay delivery and is not silently converted. Prove first successful Android direct registration selects direct mode only on that backend. Document that relay data is retained and no automatic migration/deletion occurs.

- [ ] **Step 4: Run integration verification**

```sh
rtk bun test packages/push/src
rtk bun run --cwd packages/push typecheck
rtk bun run --cwd packages/app test:unit -- ./src/utils/push-host.integration.test.ts ./src/context/push-host.test.ts
rtk bun run --cwd packages/app typecheck
```

Expected: all tests/typechecks pass.

- [ ] **Step 5: Commit integration coverage and docs**

```sh
rtk git add packages/app/src/utils/push-host.integration.test.ts packages/app/src/context/push-host.test.ts packages/push/src/direct.integration.test.ts packages/push/src/cmd.test.ts packages/push/README.md docs/specs/2026-07-16-backend-hosted-push-design.md
rtk git commit -m "test(push): cover direct multi-server delivery"
```

### Task 11: Full Verification and Signed Android Build

**Files:**
- Verify only; expected source edits are fixes discovered by these checks.

- [ ] **Step 1: Run all package test and typecheck gates**

```sh
rtk bun test packages/push-provider/src
rtk bun run --cwd packages/push-provider typecheck
rtk bun run --cwd packages/push-relay test
rtk bun run --cwd packages/push-relay typecheck
rtk bun test packages/push/src
rtk bun run --cwd packages/push typecheck
rtk bun run --cwd packages/android test
rtk bun run --cwd packages/android typecheck
rtk bun run --cwd packages/android build
rtk bun run --cwd packages/app test:unit
rtk bun run --cwd packages/app typecheck
rtk cargo check --manifest-path packages/android/src-tauri/mobile-bridge/Cargo.toml
```

Expected: every command exits zero.

- [ ] **Step 2: Run Android JVM tests with Android Studio JBR**

From `packages/android/src-tauri/gen/android`:

```sh
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  rtk ./gradlew :tauri-plugin-mobile-bridge:testDebugUnitTest --rerun-tasks
```

Expected: BUILD SUCCESSFUL with zero failed tests.

- [ ] **Step 3: Run final change and secret checks**

```sh
rtk git diff --check
rtk git status --short
```

Verify no Firebase client JSON, service-account JSON, token, keystore, generated build output, `node_modules`, generated Cargo lock, or unrelated pre-existing dirty file is staged. Run GitNexus `detect_changes` against `dev`; review every affected process and stop on unexpected HIGH/CRITICAL scope.

- [ ] **Step 4: Build and send the release-key-signed debug APK**

Run from repository root:

```sh
rtk ./packages/android/build-and-install.sh
```

Expected: CLI/frontend/arm64 debug APK build succeeds and Tailscale sends `app-arm64-debug.apk` to `pixel-10-pro-fold`. Accept the script’s normal Android version-sync commit; do not amend it.

- [ ] **Step 5: Verify APK certificate and artifact hash**

Use Android SDK `apksigner verify --print-certs` with Android Studio JBR. Expected certificate SHA-256:

```text
34279101caa764d382584ac4717b8cbfc53743b0e88efb50923ef628af19f68a
```

Record the APK SHA-256 and exact artifact path in the completion report.

- [ ] **Step 6: Perform controlled end-to-end device verification**

On two controlled backends configured with the same Firebase service account:

1. Install the sent APK and grant notification permission.
2. Connect/authenticate backend A and wait for `Active` status.
3. Connect/authenticate backend B and wait for `Active` status.
4. Close the Android app without force-stopping it.
5. Trigger a test from backend A and verify notification delivery/tap routing.
6. Trigger a test from backend B and verify independent delivery.
7. Disable one preference and verify that event kind is suppressed after re-registration.
8. Unregister backend A and verify backend B remains active.
9. Rotate the FCM token by reinstalling/clearing app data, reconnect, and verify both backends update idempotently.

If service credentials or backend access are unavailable, report this matrix as blocked; do not claim physical FCM success from automated tests alone.

---

## Completion Criteria

- No `packages/opencode/**`, public HTTP API, generated SDK, desktop, or iOS changes.
- Android registers automatically with each authenticated backend without exposing its FCM token outside the bounded PTY stdin message.
- Each backend persists its own owner-only device registry and sends directly to FCM while the app is offline/closed.
- Multiple controlled backends operate independently with the same operator-managed Firebase project.
- Invalid tokens deactivate only the affected backend registration; transient errors do not block OpenCode events.
- Android settings report selected-backend status and Send Test targets that backend.
- Existing explicit relay installations remain functional and are not silently migrated.
- All automated checks, secret scans, signed debug build, and available physical-device checks are recorded with fresh evidence.
