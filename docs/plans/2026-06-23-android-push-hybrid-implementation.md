# Android Push FCM Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete reliable Android push notifications by adding first-class FCM delivery to the existing push relay and correcting the partially implemented Android bridge without changing underlying opencode behavior.

**Architecture:** Keep the current pairing routes, channel credentials, event publisher, and iOS/APNs behavior intact. Add a provider discriminator and an FCM adapter inside `packages/push-relay`, then make the fork-owned Android bridge use the relay's existing device endpoints and canonical mobile push shapes. Changes stay in `packages/push-relay`, `packages/android`, and the already fork-specific mobile push utility in `packages/app`; `packages/opencode`, public Protocol/Server APIs, generated SDKs, desktop packages, and the push CLI contract remain unchanged.

**Tech Stack:** Bun, TypeScript, SQLite, Google FCM HTTP v1, `google-auth-library`, Kotlin, Android SDK, Firebase Messaging, WorkManager, Robolectric, MockWebServer, SolidJS, Tauri.

---

## Current State

The original plan was not checked off, but its Android scaffolding has already landed. Firebase and Android manifest configuration, encrypted preferences, FCM reception, token work, native commands, Rust command mappings, and Android platform mapping all exist. This plan supersedes the original task list and treats those files as a defective baseline to correct, not work to recreate.

The relay is currently APNs-only. Android sends an FCM registration token in `apns_token`, and the relay later submits that token to APNs. That cannot deliver an Android notification. The Android bridge also calls endpoints that do not exist, parses incorrect response keys, returns incomplete state events, and does not await the Android 13 notification permission result.

## Upstream-Minimization Boundary

The implementation MUST NOT modify:

- `packages/opencode/**`
- public Protocol or Server `HttpApi` definitions
- `packages/client/src/generated/**` or `packages/client/src/generated-effect/**`
- desktop, desktop-electron, iOS, SDK, or VS Code packages
- the push CLI install, claim, check-in, or event-publish request shapes
- existing APNs request fields or APNs environment behavior

One narrowly scoped `packages/app` edit is allowed because `packages/app/src/utils/push-pair.ts` is already marked as a WhisperCode upstream-divergence file. That edit is limited to replacing Apple-specific user-facing registration text with provider-neutral mobile wording. All Android integration behavior belongs in `packages/android`.

No public API or SDK generation is required by this plan.

## Compatibility Contract

Existing iOS and legacy callers continue to send:

```json
{
  "apns_token": "...",
  "apns_env": "production"
}
```

The relay interprets an omitted `push_provider` as `"apns"` and derives the effective token from `apns_token`.

Android sends:

```json
{
  "push_provider": "fcm",
  "push_token": "..."
}
```

The existing routes remain unchanged:

- `POST /v1/pair/start`
- `GET /v1/pair/{id}`
- `PUT /v1/device/token`
- `PUT /v1/device/preferences`
- `POST /v1/device/test`
- `DELETE /v1/device`

The SQLite migration keeps legacy `apns_token` columns to avoid a destructive table rebuild. New FCM rows duplicate the effective FCM token into the legacy non-null column while all new selection, deduplication, and delivery logic uses `push_provider` plus `push_token`. Existing rows are backfilled as `push_provider = 'apns'` and `push_token = apns_token`.

## File Map

- Create `packages/push-relay/src/push.ts`: provider-neutral adapter types shared by APNs, FCM, and relay dispatch.
- Create `packages/push-relay/src/fcm.ts`: FCM HTTP v1 adapter and payload generation.
- Create `packages/push-relay/src/fcm.test.ts`: FCM payload, auth, invalid-token, disabled, and timeout tests.
- Modify `packages/push-relay/src/apns.ts`: import the shared adapter types without changing APNs behavior.
- Modify `packages/push-relay/src/store.ts`: additive provider/token migration and provider-aware deduplication.
- Modify `packages/push-relay/src/server.ts`: accept both token envelopes and route each delivery to the correct adapter.
- Modify `packages/push-relay/src/server.test.ts`: APNs compatibility, migration, FCM pairing, mixed-device fan-out, and invalid-token tests.
- Modify `packages/push-relay/src/index.ts`: pass FCM environment configuration into the relay.
- Modify `packages/push-relay/package.json`: add `google-auth-library`.
- Create `packages/push-relay/README.md`: document FCM credentials and deployment verification.
- Create `packages/android/src-tauri/mobile-bridge/android/src/main/java/PushRelayClient.kt`: the sole Android relay HTTP boundary.
- Create `packages/android/src-tauri/mobile-bridge/android/src/test/java/PushRelayClientTest.kt`: exact route/body/response tests.
- Create `packages/android/src-tauri/mobile-bridge/android/src/test/java/SecurePreferencesManagerTest.kt`: credential, token, relay, and clearing semantics.
- Modify `packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt`: separate current token, pending-sync state, pair metadata, diagnostics, and credential clearing.
- Modify `packages/android/src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt`: use the correct relay request and preserve relay URL on auth failure.
- Modify `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`: await permission, return canonical state/pair shapes, and use `PushRelayClient`.
- Modify `packages/android/src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt`: require a paired matching channel and avoid sensitive logs.
- Modify `packages/android/src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt`: listener-ready buffering and plugin-reference cleanup.
- Create `packages/android/src-tauri/mobile-bridge/android/src/main/res/drawable/ic_stat_notification.xml`: monochrome notification status icon.
- Modify `packages/android/src-tauri/mobile-bridge/android/build.gradle.kts`: Android unit-test dependencies.
- Modify `packages/android/src/bridge.ts`: preserve native rejections for async push commands.
- Modify `packages/android/src/entry-android.tsx`: consume foreground/open events without changing shared app contracts.
- Modify `packages/app/src/utils/push-pair.ts`: provider-neutral mobile registration messages only.
- Modify `packages/app/src/utils/push-pair.test.ts`: assert provider-neutral messages.

---

### Task 1: Lock the APNs Compatibility Baseline

**Files:**

- Modify: `packages/push-relay/src/server.test.ts`

- [ ] **Step 1: Run the current relay tests before making relay changes**

Run:

```bash
rtk bun run --cwd packages/push-relay test
```

Expected: PASS. Record any pre-existing failure before proceeding; do not weaken assertions to hide it.

- [ ] **Step 2: Add an explicit legacy request compatibility test**

Add a test that starts a pair using only `apns_token`, then asserts the stored provider defaults to APNs. Task 4 adds the adapter-routing assertion after provider dispatch exists:

```ts
test("legacy apns requests default to the apns provider", async () => {
  const next = await tmp()
  const db = new Store({ file: next.file })
  try {
    const pair = db.start(
      { apns_token: "legacy-token", device_name: "iPhone", app_version: "1.0.0" },
      "https://relay.example",
    )
    const row = db.db
      .prepare("SELECT push_provider, push_token FROM pair_request WHERE id = ?")
      .get(pair.pair_id) as { push_provider: string; push_token: string }
    expect(row).toEqual({ push_provider: "apns", push_token: "legacy-token" })
  } finally {
    db.close()
    await fs.rm(next.dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run the new test and verify it fails before the migration exists**

Run:

```bash
rtk bun test --cwd packages/push-relay src/server.test.ts -t "legacy apns requests default"
```

Expected: FAIL because `push_provider` and `push_token` do not exist yet.

- [ ] **Step 4: Commit the failing compatibility test**

```bash
rtk git add packages/push-relay/src/server.test.ts
rtk git commit -m "test(push-relay): lock apns compatibility"
```

---

### Task 2: Add a Provider-Neutral Adapter Contract and FCM Adapter

**Files:**

- Create: `packages/push-relay/src/push.ts`
- Create: `packages/push-relay/src/fcm.ts`
- Create: `packages/push-relay/src/fcm.test.ts`
- Modify: `packages/push-relay/src/apns.ts`
- Modify: `packages/push-relay/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add the relay-local authentication dependency**

Add this runtime dependency to `packages/push-relay/package.json`; do not edit the root workspace catalog:

```json
"dependencies": {
  "google-auth-library": "10.5.0"
}
```

Run:

```bash
rtk bun install
```

Expected: `bun.lock` updates and no package outside dependency metadata changes.

- [ ] **Step 2: Define the shared adapter types**

Create `packages/push-relay/src/push.ts`:

```ts
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
```

Update `apns.ts` to import these types and re-export them temporarily if any current test import requires it. Do not alter `payload`, JWT generation, host selection, or invalid-token rules.

- [ ] **Step 3: Write failing FCM adapter tests**

Create `fcm.test.ts` with injected authentication and fetch boundaries. Cover the exact FCM body and permanent token rejection:

```ts
import { describe, expect, test } from "bun:test"
import { createAdapter, payload } from "./fcm"

describe("push fcm", () => {
  test("builds a data-only Android payload", () => {
    expect(
      payload({
        delivery: "dlv_abcdef",
        token: "tok",
        kind: "test",
        channel: "ch_1",
        collapse: "test:device",
      }),
    ).toEqual({
      message: {
        token: "tok",
        data: {
          v: "1",
          delivery_id: "dlv_abcdef",
          channel_id: "ch_1",
          kind: "test",
          title: "OpenCode",
          body: "Test notification abcdef",
        },
        android: { priority: "high", collapse_key: "test:device" },
      },
    })
  })

  test("marks unregistered tokens invalid", async () => {
    const fcm = createAdapter({
      mode: "live",
      project: "project-1",
      accessToken: async () => "access",
      fetch: async () =>
        Response.json(
          { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
          { status: 404 },
        ),
    })
    expect(await fcm.send({ delivery: "dlv_1", token: "dead", kind: "complete", channel: "ch_1" })).toEqual({
      sent: false,
      mode: "live",
      code: "UNREGISTERED",
      invalid: true,
    })
  })
})
```

- [ ] **Step 4: Run the FCM tests and verify they fail**

Run:

```bash
rtk bun test --cwd packages/push-relay src/fcm.test.ts
```

Expected: FAIL because `src/fcm.ts` does not exist.

- [ ] **Step 5: Implement the minimal FCM HTTP v1 adapter**

Implement `createAdapter` with these fixed rules:

- Modes are `mock`, `disabled`, and `live`, matching APNs.
- Live endpoint is `https://fcm.googleapis.com/v1/projects/{project}/messages:send`.
- Authorization is `Bearer {OAuth access token}`.
- Default credentials come only from `WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON`.
- Project ID comes from `WHISPEROPENCODE_PUSH_FCM_PROJECT_ID` or the service-account JSON's `project_id`.
- Scope is `https://www.googleapis.com/auth/firebase.messaging`.
- The adapter uses `GoogleAuth` only behind an injectable `accessToken` function.
- `UNREGISTERED` and `SENDER_ID_MISMATCH` set `invalid: true`.
- `QUOTA_EXCEEDED`, `UNAVAILABLE`, `INTERNAL`, HTTP 429, and HTTP 5xx remain retryable and do not invalidate the device.
- Requests time out after 15 seconds through `AbortSignal.timeout`.
- Logs and return values never contain registration tokens or service-account JSON.

The exported payload must remain data-only so `WhisperFirebaseMessagingService` controls foreground and background behavior:

```ts
export function payload(msg: PushMsg) {
  const text = msg.kind === "test" ? `Test notification ${msg.delivery.slice(-6)}` : "Session needs attention"
  return {
    message: {
      token: msg.token,
      data: {
        v: "1",
        delivery_id: msg.delivery,
        channel_id: msg.channel,
        kind: msg.kind,
        title: "OpenCode",
        body: text,
        ...(msg.session ? { session_id: msg.session } : {}),
      },
      android: {
        priority: "high",
        ...(msg.collapse ? { collapse_key: msg.collapse } : {}),
      },
    },
  }
}
```

- [ ] **Step 6: Run adapter tests and typecheck**

Run:

```bash
rtk bun test --cwd packages/push-relay src/fcm.test.ts src/apns.test.ts
rtk bun run --cwd packages/push-relay typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the adapter**

```bash
rtk git add packages/push-relay/package.json packages/push-relay/src/push.ts packages/push-relay/src/fcm.ts packages/push-relay/src/fcm.test.ts packages/push-relay/src/apns.ts bun.lock
rtk git commit -m "feat(push-relay): add fcm delivery adapter"
```

---

### Task 3: Add the Backward-Compatible Provider Migration

**Files:**

- Modify: `packages/push-relay/src/store.ts`
- Modify: `packages/push-relay/src/server.test.ts`

- [ ] **Step 1: Add migration tests for existing databases**

Create a database with the current schema, insert an APNs pair and device, close it, reopen it through `Store`, and assert:

```ts
expect(pair.push_provider).toBe("apns")
expect(pair.push_token).toBe("old-pair-token")
expect(device.push_provider).toBe("apns")
expect(device.push_token).toBe("old-device-token")
```

Also add a test that two devices in one channel may use the same token text when their providers differ, while duplicate tokens within the same provider are still collapsed.

- [ ] **Step 2: Run migration tests and verify they fail**

Run:

```bash
rtk bun test --cwd packages/push-relay src/server.test.ts -t "provider migration"
```

Expected: FAIL because provider columns and provider-aware uniqueness do not exist.

- [ ] **Step 3: Extend input and send types**

Use a compatibility union at the HTTP/store boundary:

```ts
export type PushTokenInput =
  | { push_provider: "fcm"; push_token: string; apns_token?: never; apns_env?: never }
  | { push_provider?: "apns"; push_token?: never; apns_token: string; apns_env?: string }

export type Send = {
  accepted: boolean
  provider?: PushProvider
  suppressed?: boolean
  reason?: string
  delivery_id?: string
  device_id?: string
  token?: string
  channel_id?: string
  session_id?: string | null
  kind?: string
  collapse_id?: string
  apns_env?: string
}
```

Add one normalization function and use it from both pair start and token update:

```ts
function push(input: PushTokenInput) {
  if (input.push_provider === "fcm") return { provider: "fcm" as const, token: input.push_token }
  return { provider: "apns" as const, token: input.apns_token }
}
```

- [ ] **Step 4: Add the additive SQLite migration**

Add `push_provider` and `push_token` to both `CREATE TABLE IF NOT EXISTS` definitions so new databases start with the final schema. For existing databases, follow the file's current idempotent `try { ALTER TABLE ... } catch {}` migration pattern, then backfill and replace the index in a transaction:

```sql
ALTER TABLE pair_request ADD COLUMN push_provider TEXT NOT NULL DEFAULT 'apns';
ALTER TABLE pair_request ADD COLUMN push_token TEXT;
ALTER TABLE device ADD COLUMN push_provider TEXT NOT NULL DEFAULT 'apns';
ALTER TABLE device ADD COLUMN push_token TEXT;
UPDATE pair_request SET push_token = apns_token WHERE push_token IS NULL;
UPDATE device SET push_token = apns_token WHERE push_token IS NULL;
```

Drop `device_channel_token_active_idx` and replace it with:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS device_channel_provider_token_active_idx
ON device(channel_id, push_provider, push_token)
WHERE revoked_at IS NULL;
```

Keep the old non-null `apns_token` columns populated with the effective token for FCM rows. This is intentional compatibility storage, not a delivery signal.

- [ ] **Step 5: Make all token identity operations provider-aware**

Update `start`, both `claim` branches, `putToken`, `test`, `publish`, `repair`, `same`, and `prune` so identity is `(channel_id, push_provider, push_token)`. Every `Send` created by `test` or `publish` must include `provider`.

`listDevices` adds `push_provider` but does not expose `push_token` or `apns_token`:

```ts
return rows.map((device) => ({
  device_id: String(device.id),
  device_name: device.device_name == null ? null : String(device.device_name),
  push_provider: device.push_provider === "fcm" ? "fcm" : "apns",
  apns_env: device.push_provider === "fcm" ? null : String(device.apns_env ?? "production"),
  prefs: loadPrefs(device.prefs_json ?? null),
  error_code: device.error_code == null ? null : String(device.error_code),
  active: device.revoked_at == null,
  created_at: device.created_at == null ? null : Number(device.created_at),
}))
```

- [ ] **Step 6: Run store and server tests**

Run:

```bash
rtk bun test --cwd packages/push-relay src/server.test.ts
rtk bun run --cwd packages/push-relay typecheck
```

Expected: PASS, including the legacy APNs compatibility test from Task 1.

- [ ] **Step 7: Commit the migration**

```bash
rtk git add packages/push-relay/src/store.ts packages/push-relay/src/server.test.ts
rtk git commit -m "feat(push-relay): persist push providers"
```

---

### Task 4: Route FCM and APNs Deliveries Without Changing Existing Routes

**Files:**

- Modify: `packages/push-relay/src/server.ts`
- Modify: `packages/push-relay/src/server.test.ts`
- Modify: `packages/push-relay/src/index.ts`

- [ ] **Step 1: Write failing FCM route and mixed fan-out tests**

Add tests that prove:

- `POST /v1/pair/start` accepts `{push_provider:"fcm",push_token:"fcm-1",device_name,app_version}`.
- `PUT /v1/device/token` accepts the same FCM envelope plus device credentials.
- A channel with one APNs device and one FCM device invokes each adapter once.
- An FCM `UNREGISTERED` response deactivates only the FCM device.
- Omitting `push_provider` still routes to APNs.
- An unknown provider returns HTTP 400 with `error: "bad_push_provider"`.

Inject a fake FCM adapter through relay options instead of making network requests.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
rtk bun test --cwd packages/push-relay src/server.test.ts -t "fcm|mixed provider|bad push provider"
```

Expected: FAIL because route validation and provider dispatch are not implemented.

- [ ] **Step 3: Extend relay options without changing callers**

Add optional FCM settings and an adapter injection seam:

```ts
type Opts = {
  // existing APNs and relay options remain unchanged
  fcmMode?: "mock" | "disabled" | "live"
  fcmProject?: string
  fcmServiceAccount?: string
  fcmAdapter?: PushAdapter
}
```

Create one FCM adapter in `createRelay`, close it in `stop`, and keep the existing APNs sandbox/production adapters.

- [ ] **Step 4: Validate both token envelopes**

For pair start and token update, validate with this rule instead of always requiring `apns_token`:

```ts
function needPush(body: Record<string, unknown>) {
  const provider = body.push_provider ?? "apns"
  if (provider !== "apns" && provider !== "fcm") throw new RelayErr(400, "bad_push_provider")
  if (provider === "fcm") return need(body, ["push_token"])
  need(body, ["apns_token"])
}
```

- [ ] **Step 5: Dispatch by provider**

Select FCM only when the stored `Send.provider` is `"fcm"`; all missing/legacy values go to APNs:

```ts
const adapter = body.provider === "fcm" ? adapters.fcm : adapters.apns[env]
const result = await adapter.send({ delivery: id, token, channel, kind, session, collapse })
```

Keep mark/deactivate behavior shared. Include `provider` in structured delivery logs, and remove `provider`, token, channel, session, kind, and APNs environment from public delivery responses.

- [ ] **Step 6: Wire deployment environment variables**

Pass these values from `index.ts`:

```ts
fcmProject: process.env.WHISPEROPENCODE_PUSH_FCM_PROJECT_ID,
fcmServiceAccount: process.env.WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON,
fcmMode: process.env.WHISPEROPENCODE_PUSH_FCM_MODE as "mock" | "disabled" | "live" | undefined,
```

Do not read or log credentials anywhere else.

- [ ] **Step 7: Run the full relay suite and typecheck**

Run:

```bash
rtk bun run --cwd packages/push-relay test
rtk bun run --cwd packages/push-relay typecheck
```

Expected: PASS. Existing APNs sandbox, production, pairing, preferences, replay, cleanup, and rate-limit tests remain green.

- [ ] **Step 8: Commit provider routing**

```bash
rtk git add packages/push-relay/src/server.ts packages/push-relay/src/server.test.ts packages/push-relay/src/index.ts
rtk git commit -m "feat(push-relay): route android notifications through fcm"
```

---

### Task 5: Add a Tested Android Relay Client

**Files:**

- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/PushRelayClient.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/test/java/PushRelayClientTest.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/build.gradle.kts`

- [ ] **Step 1: Add Android unit-test dependencies**

Add:

```kotlin
testOptions {
    unitTests.isIncludeAndroidResources = true
}
```

and:

```kotlin
testImplementation("junit:junit:4.13.2")
testImplementation("org.robolectric:robolectric:4.13.2")
testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
```

- [ ] **Step 2: Write failing relay contract tests**

Use `MockWebServer` to assert these exact requests:

```kotlin
val pairBody = JSONObject(pairRequest.body.readUtf8())
assertEquals("POST", pairRequest.method)
assertEquals("/v1/pair/start", pairRequest.path)
assertEquals("fcm", pairBody.getString("push_provider"))
assertEquals("token-1", pairBody.getString("push_token"))

assertEquals("PUT", tokenRequest.method)
assertEquals("/v1/device/token", tokenRequest.path)

assertEquals("PUT", prefsRequest.method)
assertEquals("/v1/device/preferences", prefsRequest.path)

assertEquals("POST", testRequest.method)
assertEquals("/v1/device/test", testRequest.path)

assertEquals("DELETE", deleteRequest.method)
assertEquals("/v1/device", deleteRequest.path)
```

Also test that a relay error body such as `{"error":"bad_device_secret"}` becomes a typed result containing HTTP status and code, not a string or `null`.

- [ ] **Step 3: Run the focused Android test and verify it fails**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest --tests '*PushRelayClientTest' --no-daemon
```

Expected: FAIL because `PushRelayClient` does not exist.

- [ ] **Step 4: Implement the single HTTP boundary**

`PushRelayClient` owns URL construction, JSON bodies, 10-second connect/read timeouts, response parsing, and error-code extraction. Define explicit results:

```kotlin
data class PushCredentials(val channelId: String, val deviceId: String, val deviceSecret: String)
data class RelayError(val status: Int?, val code: String, val message: String?)
sealed interface RelayResult<out T> {
    data class Ok<T>(val value: T) : RelayResult<T>
    data class Err(val error: RelayError) : RelayResult<Nothing>
}
```

Expose only these methods:

```kotlin
fun beginPair(relay: String, token: String, device: String, version: String): RelayResult<JSONObject>
fun getPair(relay: String, pairId: String): RelayResult<JSONObject>
fun putToken(relay: String, credentials: PushCredentials, token: String): RelayResult<JSONObject>
fun putPreferences(relay: String, credentials: PushCredentials, prefs: JSONObject): RelayResult<JSONObject>
fun test(relay: String, credentials: PushCredentials): RelayResult<JSONObject>
fun delete(relay: String, credentials: PushCredentials): RelayResult<JSONObject>
```

Every authenticated body contains `channel_id`, `device_id`, and `device_secret`. Pair and token bodies contain `push_provider: "fcm"` and `push_token`; no Android request sends `apns_env`.

- [ ] **Step 5: Run the Android relay tests**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 6: Commit the relay client**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/build.gradle.kts packages/android/src-tauri/mobile-bridge/android/src/main/java/PushRelayClient.kt packages/android/src-tauri/mobile-bridge/android/src/test/java/PushRelayClientTest.kt
rtk git commit -m "test(android): cover push relay contracts"
```

---

### Task 6: Correct Android Push Persistence and State Semantics

**Files:**

- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/test/java/SecurePreferencesManagerTest.kt`

- [ ] **Step 1: Write failing persistence tests**

Test these invariants with Robolectric:

- Current FCM token and pending-sync flag are separate values.
- Clearing credentials preserves the relay URL and current FCM token.
- Changing relay URL clears credentials and pending pair metadata.
- Pair ID, token, command, expiry, and status survive manager recreation.
- Diagnostic code and message can be set and cleared without storing registration tokens in the message.

Representative assertions:

```kotlin
prefs.saveFcmToken("fcm-1", pending = true)
prefs.saveCredentials("ch-1", "dev-1", "secret-1")
prefs.clearCredentials()
assertEquals("fcm-1", prefs.getFcmToken())
assertTrue(prefs.isTokenPending())
assertEquals("https://relay.example", prefs.getRelayUrl())
assertNull(prefs.getDeviceSecret())
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest --tests '*SecurePreferencesManagerTest' --no-daemon
```

Expected: FAIL because the existing manager has one pending-token field and only destructive `clearAll`.

- [ ] **Step 3: Implement explicit storage operations**

Add storage for:

```text
push.fcm_token
push.token_pending
push.pair_id
push.pair_token
push.pair_command
push.pair_expires
push.pair_status
push.last_code
push.last_error
```

Replace broad `clearAll()` calls with:

```kotlin
fun clearCredentials()
fun clearPair()
fun resetForRelay(relayUrl: String?)
```

`resetForRelay` clears credentials and pair metadata, saves the normalized relay URL, keeps the FCM token, and marks it pending when a token exists so it can sync after re-pairing. Full clearing remains private and is used only for unrecoverable KeyStore recreation.

- [ ] **Step 4: Validate relay URLs before persistence**

Accept `https://` URLs. Accept `http://localhost`, `http://127.0.0.1`, and `http://10.0.2.2` for development. Reject credentials, fragments, unsupported schemes, and non-local cleartext hosts with `invalid_relay_url`.

- [ ] **Step 5: Run persistence and relay-client tests**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest --no-daemon
```

Expected: PASS.

- [ ] **Step 6: Commit persistence corrections**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt packages/android/src-tauri/mobile-bridge/android/src/test/java/SecurePreferencesManagerTest.kt
rtk git commit -m "fix(android): separate push token and pairing state"
```

---

### Task 7: Correct Native Push Commands and Permission Completion

**Files:**

- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/test/java/PushStateTest.kt`

- [ ] **Step 1: Write failing pure state-shape tests**

Extract only pure state and pair JSON construction from the command methods. Assert a complete push state:

```json
{
  "supported": true,
  "permission": "denied",
  "allowed": false,
  "registered": true,
  "paired": false,
  "generic": false,
  "diag": {
    "token": true,
    "tokenPending": true,
    "relay": "https://relay.example",
    "pairID": "pair_1",
    "pairStatus": "claimed",
    "lastCode": "bad_device_secret"
  }
}
```

Assert canonical `PairInfo` keys:

```json
{
  "id": "pair_1",
  "status": "active",
  "token": "ptok_1",
  "command": "npx ...",
  "expires": "2026-07-14T12:00:00.000Z",
  "channel": "ch_1",
  "device": "dev_1"
}
```

- [ ] **Step 2: Run state tests and verify they fail**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest --tests '*PushStateTest' --no-daemon
```

Expected: FAIL because current state events are partial and pair keys are relay-shaped.

- [ ] **Step 3: Make notification permission completion authoritative**

`requestPushPermission` must resolve exactly once after both operations finish:

1. Android 13+ permission callback reports granted or denied.
2. Firebase token retrieval reports a token or a registration error.

On Android 12 and earlier, skip the runtime prompt and treat notification permission as authorized. Track whether Android 13+ permission has previously been requested so a missing grant is `not-determined` before the first request and `denied` after denial. Never report `registered: true` unless a current FCM token exists.

If the Tauri plugin base class cannot receive `onRequestPermissionsResult` directly, use the generated Android activity's existing callback forwarding seam; do not add a new public Rust or TypeScript command.

- [ ] **Step 4: Replace command HTTP code with `PushRelayClient`**

Implement these exact mappings:

- `beginPushPairing`: parse `pair_id`, `pair_token`, `expires_at`, `install_command`; persist all four; return `id`, `token`, `expires`, `command`, `status: "pending"`.
- `getPushPairing`: return persisted metadata for pending/claimed/expired/failed; on active, persist credentials and return `channel` and `device`.
- `setPushCredentials`: persist credentials, mark the current token pending, schedule token sync, and return complete state.
- `clearPushPairing`: send authenticated JSON `DELETE /v1/device`; clear local credentials after success or `device_not_found`; preserve the relay and FCM token.
- `setPushRelayURL`: validate and reset relay-scoped state only when the normalized URL changes.
- `testPush`: call `POST /v1/device/test`; return `{success:true}` only when relay response has `sent:true`.
- `setPushPreferences`: call `PUT /v1/device/preferences` with all four booleans.

Remove `executeAsyncHttpRequest` after all push commands use `PushRelayClient`; do not move unrelated voice, scan, or share code.

- [ ] **Step 5: Emit complete state and stable errors**

`pushStateChanged` must emit the same object as `getPushState`. Store relay failures as `diag.lastCode` and a sanitized `diag.lastError`. Reject invokes with stable codes such as `missing_fcm_token`, `invalid_relay_url`, `relay_unreachable`, `pair_not_found`, and `bad_device_secret`; do not include credentials, tokens, or raw service responses.

- [ ] **Step 6: Run Android unit tests and compile**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest :app:assembleDebug --no-daemon
```

Expected: PASS.

- [ ] **Step 7: Commit native command corrections**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt packages/android/src-tauri/mobile-bridge/android/src/test/java/PushStateTest.kt
rtk git commit -m "fix(android): align push commands with relay contracts"
```

---

### Task 8: Correct Token Sync and Notification Reception

**Files:**

- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/test/java/TokenSyncWorkerTest.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/test/java/PushMessagePolicyTest.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/res/drawable/ic_stat_notification.xml`

- [ ] **Step 1: Write failing token-worker tests**

Assert that the worker:

- Calls `PUT /v1/device/token` through `PushRelayClient`.
- Sends credentials plus `push_provider: "fcm"` and `push_token`.
- Clears only `tokenPending` on success.
- Clears credentials but preserves relay/token on `bad_device_secret` or `device_not_found`.
- Retries HTTP 408, 429, and 5xx or network failures.
- Fails without retry for malformed local input.

- [ ] **Step 2: Write failing message-policy tests**

Extract a pure decision function and test:

```kotlin
assertEquals(Ignore, decideMessage(localChannel = null, incomingChannel = "ch-1", foreground = false))
assertEquals(Ignore, decideMessage(localChannel = "ch-1", incomingChannel = "ch-2", foreground = false))
assertEquals(Emit, decideMessage(localChannel = "ch-1", incomingChannel = "ch-1", foreground = true))
assertEquals(Notify, decideMessage(localChannel = "ch-1", incomingChannel = "ch-1", foreground = false))
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest --tests '*TokenSyncWorkerTest' --tests '*PushMessagePolicyTest' --no-daemon
```

Expected: FAIL because current worker uses `/v1/device` and unpaired message handling accepts notifications.

- [ ] **Step 4: Correct token scheduling and sync**

On every `onNewToken`, save the current token with `pending = true` and enqueue unique work with `ExistingWorkPolicy.REPLACE`; the latest token supersedes obsolete queued token work. The worker reads the current persisted token at execution time rather than trusting stale input data.

When no credentials exist, return success while leaving `tokenPending = true`. Successful pairing or credential restoration schedules a new worker.

- [ ] **Step 5: Harden incoming notification handling**

Require all of these before emitting or displaying:

- Local `channel_id`, `device_id`, and `device_secret` exist.
- Incoming `channel_id` exactly equals local `channel_id`.
- Payload `v` is `"1"`.
- `title`, `body`, and optional `href` fit documented maximum lengths of 100, 500, and 2,048 characters.

Do not log title, body, href, FCM token, channel, device ID, or secrets. Before `notify`, check `NotificationManagerCompat.areNotificationsEnabled()` and Android 13 permission. Use `ic_stat_notification` as a monochrome small icon and derive a stable notification ID from `delivery_id` so duplicate FCM delivery replaces rather than multiplies the notification.

- [ ] **Step 6: Make tap delivery listener-ready**

`NotificationTapHandler` must keep at most one pending href, hold a weak plugin reference, and clear it during plugin destruction. For a cold start, expose the pending href once as an extra field on the native `getPushState` result; `normalizePush` ignores that extra field while Android entry code validates and handles it directly. For a warm app, retain the existing `pushOpened` event. This avoids adding a public Rust command, opencode event, or shared platform method.

- [ ] **Step 7: Run Android tests and debug build**

Run:

```bash
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest :app:assembleDebug --no-daemon
```

Expected: PASS.

- [ ] **Step 8: Commit background behavior corrections**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt packages/android/src-tauri/mobile-bridge/android/src/test packages/android/src-tauri/mobile-bridge/android/src/main/res/drawable/ic_stat_notification.xml
rtk git commit -m "fix(android): harden push background delivery"
```

---

### Task 9: Preserve Native Errors and Connect Android-Only Events

**Files:**

- Modify: `packages/android/src/bridge.ts`
- Modify: `packages/android/src/entry-android.tsx`
- Create: `packages/android/src/push-native.ts`
- Create: `packages/android/src/push-native.test.ts`

- [ ] **Step 1: Extract and test Android-only push normalization**

Move `normalizePush`, `normalizeDiag`, and `normalizePair` into `push-native.ts` and export them. Add tests that reject partial `pushStateChanged` payloads, accept complete native state, and preserve canonical pair fields.

- [ ] **Step 2: Add a failing bridge rejection test**

Wrap `invoke` behind an injectable local function and assert that a native rejection for a known async push command rejects with its message instead of resolving `null`. Unknown commands may continue returning `null`.

- [ ] **Step 3: Run Android TypeScript tests and verify they fail**

Add a package test script if absent:

```json
"test": "bun test src"
```

Run:

```bash
rtk bun run --cwd packages/android test
```

Expected: FAIL until normalizers are exported and bridge errors are preserved.

- [ ] **Step 4: Preserve known-command errors**

Change `sendAsync` to reject invoke failures for mapped commands:

```ts
sendAsync: <T = unknown>(method: string, params?: unknown) => {
  const command = resolve(method)
  if (!command) return Promise.resolve(null)
  return invoke<T>(`plugin:mobile-bridge|${command}`, params as Record<string, unknown>).then((value) => value ?? null)
},
```

Call sites that intentionally ignore best-effort failures must add their own `.catch(() => null)`; setup, pairing, test, preference, and delete paths must surface the rejection.

- [ ] **Step 5: Consume foreground and tap events in Android entry code**

Keep event handling Android-local:

- `pushStateChanged`: normalize the complete state and update the Android platform signal.
- `pushReceived`: refresh push state and dispatch the existing `opencode:resume` signal so the active session refreshes; do not display a second notification.
- `pushOpened`: validate an optional `href` as an app-relative path or approved `opencode://` deep link before navigating; reject arbitrary `javascript:`, `file:`, and external HTTP URLs. The current relay sends no route href, so a missing href only resumes and refreshes the app; do not invent a route from `session_id`.
- Register listeners before signaling native tap readiness, and unregister all listeners in `onCleanup`.

Do not modify the shared `Platform` interface.

- [ ] **Step 6: Run Android tests, typecheck, and build**

Run:

```bash
rtk bun run --cwd packages/android test
rtk bun run --cwd packages/android typecheck
rtk bun run --cwd packages/android build
```

Expected: PASS.

- [ ] **Step 7: Commit Android entry integration**

```bash
rtk git add packages/android/package.json packages/android/src/bridge.ts packages/android/src/entry-android.tsx packages/android/src/push-native.ts packages/android/src/push-native.test.ts
rtk git commit -m "fix(android): connect native push events"
```

---

### Task 10: Make Existing Mobile Pairing Copy Provider-Neutral

**Files:**

- Modify: `packages/app/src/utils/push-pair.ts`
- Modify: `packages/app/src/utils/push-pair.test.ts`

- [ ] **Step 1: Add failing provider-neutral copy assertions**

Update focused tests to assert that registration failures say `mobile push registration` and settings guidance says `device Settings`. Assert that no user-facing result contains `Apple`, `APNs`, or `iPhone`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
rtk bun run --cwd packages/app test:unit -- ./src/utils/push-pair.test.ts
```

Expected: FAIL on current Apple-specific messages.

- [ ] **Step 3: Change only user-facing wording**

Keep `PushIssueCode` values unchanged to avoid changing shared callers. Replace text as follows:

```text
Apple push registration -> mobile push registration
iPhone Settings -> device Settings
re-pair this iPhone -> re-pair this device
```

Do not rename exported types, issue codes, functions, or platform methods in this task.

- [ ] **Step 4: Run focused app tests**

Run:

```bash
rtk bun run --cwd packages/app test:unit -- ./src/utils/push-pair.test.ts ./src/context/push-pair.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the copy correction**

```bash
rtk git add packages/app/src/utils/push-pair.ts packages/app/src/utils/push-pair.test.ts
rtk git commit -m "fix(app): use provider-neutral push setup copy"
```

---

### Task 11: Document and Verify Relay Deployment

**Files:**

- Create: `packages/push-relay/README.md`

- [ ] **Step 1: Document FCM configuration**

Document these exact variables without example secrets:

```text
WHISPEROPENCODE_PUSH_FCM_PROJECT_ID
WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON
```

The service account requires only permission to send Firebase Cloud Messaging messages for the Android Firebase project. State that logs must never print the JSON value or registration tokens. Document that missing FCM configuration disables only FCM delivery; APNs remains operational.

- [ ] **Step 2: Add a local mock verification recipe**

Document:

```bash
WHISPEROPENCODE_PUSH_APNS_MODE=mock \
WHISPEROPENCODE_PUSH_FCM_MODE=mock \
rtk bun run --cwd packages/push-relay dev
```

Include the expected `/health` response `{ "ok": true }` and the relay test/typecheck commands.

- [ ] **Step 3: Run complete automated verification**

Run:

```bash
rtk bun run --cwd packages/push-relay test
rtk bun run --cwd packages/push-relay typecheck
rtk bun run --cwd packages/android test
rtk bun run --cwd packages/android typecheck
rtk ./packages/android/src-tauri/gen/android/gradlew --project-dir packages/android/src-tauri/gen/android :mobile-bridge:testDebugUnitTest :app:assembleDebug :app:assembleRelease --no-daemon
rtk bun run --cwd packages/app test:unit -- ./src/utils/push-pair.test.ts ./src/context/push-pair.test.ts
```

Expected: every command passes. Do not substitute a root-level test command.

- [ ] **Step 4: Inspect the release artifact**

Verify the merged release manifest contains `WhisperFirebaseMessagingService`, `POST_NOTIFICATIONS`, and the default notification channel. Verify release log output contains no token, secret, service-account, notification body, or href values.

- [ ] **Step 5: Commit deployment documentation**

```bash
rtk git add packages/push-relay/README.md
rtk git commit -m "docs(push-relay): document fcm deployment"
```

---

### Task 12: Perform End-to-End Device Verification

**Files:**

- Modify only if a verified defect is found: files already listed in Tasks 2-10

- [ ] **Step 1: Deploy relay changes with FCM credentials**

Deploy to a non-production relay first. Confirm `/health`, then pair one existing iOS device and prove APNs test delivery still succeeds before testing Android.

- [ ] **Step 2: Install the Android debug build on a physical Android 13+ device**

Use the repository-supported script:

```bash
rtk ./packages/android/build-and-install.sh
```

Expected: the script builds and transfers the arm64 debug APK without clearing unrelated device data unless the script explicitly documents that behavior.

- [ ] **Step 3: Verify permission outcomes**

Test first prompt grant, first prompt denial, settings re-enable, and Android 12-or-earlier behavior where available. Each outcome must immediately produce the matching complete `PushState` without restarting the app.

- [ ] **Step 4: Verify pairing and relay operations**

Confirm begin, host claim, active polling, preference update, test push, token refresh, relay URL change, and unpair. Confirm Android rows report `push_provider: "fcm"` and iOS rows report `"apns"`.

- [ ] **Step 5: Verify the delivery matrix**

Exercise all cases:

| App state | Expected result |
| --- | --- |
| Foreground | Native event refreshes the app; no tray duplicate |
| Background | One tray notification appears |
| Process killed by OS | One tray notification appears |
| Notification tapped while backgrounded | Existing task resumes and refreshes; an optional validated href opens when present |
| Notification tapped from killed state | App starts and refreshes; a buffered optional href is handled after startup |
| Unpaired device | Message is ignored |
| Wrong channel | Message is ignored |
| Duplicate delivery ID | Existing notification is replaced |

- [ ] **Step 6: Verify token rotation and recovery**

Force an FCM token refresh or reinstall on the test device. Confirm WorkManager updates `/v1/device/token`, the device remains FCM-backed, and a stale token marked `UNREGISTERED` is deactivated without affecting APNs devices in the channel.

- [ ] **Step 7: Run final change-scope analysis**

Run GitNexus change detection before the final implementation commit or pull request:

```text
detect_changes(scope="compare", base_ref="dev")
```

Expected scope: push relay delivery/persistence, Android mobile bridge, Android entry integration, and provider-neutral text in the existing mobile push utility. Any `packages/opencode`, Protocol, Server API, generated SDK, desktop, or iOS implementation change is out of scope and must be removed or separately justified before merge.

## Completion Criteria

- Existing iOS/APNs clients pair, update tokens, receive tests, receive events, and unpair without request-shape changes.
- Android pair and token requests are explicitly identified as FCM.
- FCM tokens are sent only to FCM HTTP v1 and never to APNs.
- Relay migration is additive and preserves existing SQLite data.
- Android uses only existing relay routes and exact credential body fields.
- Permission results, native state events, and pair results use the existing shared app contract.
- Foreground, background, killed-state, tap, token-rotation, invalid-token, and wrong-channel cases are verified.
- Automated relay, Android Kotlin, Android TypeScript, focused app, debug, and release checks pass.
- No files under `packages/opencode`, public Protocol/Server APIs, generated SDKs, desktop packages, or iOS are changed.
