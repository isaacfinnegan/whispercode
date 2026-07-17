# Backend-Hosted Push Design

## Goal

Deliver Android push notifications directly from each OpenCode backend that WhisperCode connects to, without an externally hosted relay and without changes to `packages/opencode` or public OpenCode server APIs.

## Scope

The first release supports multiple OpenCode backends controlled by the WhisperCode operator. Each backend receives the same Firebase service-account credential through its own private deployment configuration.

The design deliberately does not implement third-party backend support. It preserves a backend-local registration and sender contract so a third party can opt in later with its own FCM credentials or a separately trusted broker.

## Non-Goals

- Do not add routes, commands, types, or generated clients to `packages/opencode`.
- Do not expose the Firebase service-account credential to Android, the WhisperCode web renderer, or the pairing command output.
- Do not require a public relay service, port, database, or deployment beside an OpenCode backend.
- Do not migrate existing external-relay registrations automatically. Users enable direct delivery again after upgrading.
- Do not implement iOS direct delivery in this change.

## Architecture

```text
WhisperCode Android app
  │
  │ authenticated OpenCode HTTP connection and PTY
  │ one-time registration payload over PTY standard input
  ▼
OpenCode backend
  └─ @whisperopencode/push plugin
       ├─ stores backend-local device registrations
       ├─ observes OpenCode session events
       └─ calls FCM HTTP v1 with its private service-account credential
                                                     │
                                                     ▼
                                                Firebase Cloud Messaging
                                                     │
                                                     ▼
                                             Android app, running or closed
```

The Android app is never the runtime sender. It registers an FCM token while it is online. The running OpenCode backend plugin later sends directly to FCM when it observes a notification-worthy event. FCM owns eventual delivery while the app is backgrounded or its process is not running.

Each OpenCode backend has its own registry. A device registered with backend A never receives an event from backend B unless it is independently registered with B. Registering the same Android device with two authenticated backends creates one independent backend-local record in each registry; completion and approval events published by different backends each produce only their corresponding backend send.

## Backend Plugin

`packages/push` becomes the direct sender and remains an ordinary OpenCode plugin. It uses only the existing plugin event hook and its already-installed CLI; it does not need an OpenCode HTTP extension point.

The plugin adds backend-local commands:

```text
opencode-push register --stdin
opencode-push unregister --device <id>
opencode-push status
opencode-push test --device <id>
```

`register --stdin` reads exactly one JSON object from standard input, validates its bounded fields, persists or updates the registration, prints a non-sensitive status result, and exits. It never echoes the FCM token. The app invokes this command through the existing authenticated PTY endpoint.

The registration record contains only what the plugin needs to deliver and filter pushes:

```ts
type DevicePreferences = {
  complete: boolean
  approval: boolean
  question: boolean
  error: boolean
}

type DeviceRegistration = {
  id: string
  provider: "fcm"
  token: string
  tokenGeneration: number
  prefs: DevicePreferences
  active: boolean
  createdAt: number
  updatedAt: number
  lastSuccessAt?: number
  lastError?: { code: string; at: number }
}
```

Registrations live in the existing push plugin state directory with `0600` file permissions. Malformed JSON and input larger than the registration limit are rejected before registry state is written. The FCM token and Firebase private key are never included in command arguments, PTY URLs or create bodies, plugin logs, CLI output, Android diagnostics, persisted app state, sanitized status data, or surfaced UI and transport errors.

The plugin reuses the FCM HTTP v1 delivery behavior already established in `packages/push-relay`: high-priority data payloads, short request timeout, `UNREGISTERED` and `SENDER_ID_MISMATCH` deactivation, and non-fatal handling of transient delivery failures. The implementation moves or shares this adapter through a fork-owned package boundary without making `packages/push` depend on an externally deployed relay.

Each controlled backend is configured privately with the same credentials:

```text
WHISPEROPENCODE_PUSH_FCM_PROJECT_ID=<Firebase project id>
WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON=<service-account JSON>
```

Absent or invalid configuration disables direct push on only that backend. It must not interfere with normal OpenCode execution.

## App Registration

Android continues to obtain and refresh its FCM token natively. The native bridge exposes a one-time registration payload only after notification permission is granted and a token is available. It is consumed by the app's server-registration flow, not displayed or persisted in renderer-visible diagnostics.

For every authenticated OpenCode HTTP server connection:

1. The app checks whether that server has an active direct-push registration for the current device/token generation.
2. If not, it opens a short-lived authenticated PTY running `opencode-push register --stdin`.
3. The app sends one registration JSON line to PTY standard input over the WebSocket and leaves input open while it waits for the non-sensitive status response. PTY deletion and cleanup terminate the PTY parent and child after the response or on failure.
4. The app records server-scoped success or sanitized failure state locally.
5. The app retries transient failures after the next successful connection or native FCM token refresh.

The existing PTY WebSocket protocol already accepts client input, so this requires no server route. The FCM token is never sent in a URL, HTTP query, command argument, process list, or command output.

When the user disables mobile notifications or removes a server, the app invokes `opencode-push unregister` through the same authenticated PTY path. The backend deletes that device's registration. If the backend is unavailable, the app retains a pending unregister operation and retries after reconnecting.

## Per-Server UI State

Push state is split into:

- Device state: Android permission, native FCM token availability, and token refresh state.
- Server registration state: one result per OpenCode server identity, including registered, pending, unavailable, or error.

The Mobile Notifications settings surface lists the connected server registrations and displays a sanitized reason when registration failed. It does not refer to Apple, APNs, or an external relay.

“Send Test” targets the currently selected backend through `opencode-push test --device <id>`. It is enabled only when that backend has an active registration and FCM is configured there.

## Delivery Behavior

The plugin continues to filter session events into these categories:

- completion
- approval
- question
- error
- explicit test

It applies each device's preferences before sending. The FCM payload includes only the delivery identifier, backend-local device identifier, event kind, short title/body, and an optional approved route. It does not include prompt text, tool output, credentials, filesystem paths, or service-account material.

An invalid FCM token deactivates that backend-local registration. Network, OAuth, FCM 408, and 5xx failures are recorded as transient backend-local status and do not interrupt a running OpenCode session. The backend can retry a later event; it does not block session processing for notification delivery.

If an OpenCode backend is stopped, it cannot send. If the Android app is stopped or offline, FCM handles delivery once it can reach the device. Android force-stop behavior remains an operating-system limitation: delivery resumes only after the user opens the app again.

## Security

- Firebase service-account credentials exist only in private environment configuration on controlled backends.
- The app-to-backend registration channel requires the existing authenticated OpenCode connection and PTY authorization.
- Registration payloads are input-only and one-time; neither command arguments nor output contain the FCM token.
- Backend state files use owner-only permissions and redact sensitive values from diagnostics.
- Server-scoped registrations prevent a backend from addressing devices that have not registered with it.
- Future third-party servers must supply their own sender credential or an explicitly trusted broker. They never receive the operator's shared Firebase service account.

## Compatibility And Migration

The external `packages/push-relay` remains available for existing deployments during the transition but is no longer the default Android path. A backend with explicit `mode: "relay"` continues relay check-in and publishing and is never silently converted to direct delivery. Existing relay URL, channel, secret, and device data are retained; direct registration does not migrate or delete them. A first successful Android direct registration selects direct delivery only for the non-relay backend that accepted it. There is no automatic migration or cleanup. The app stops presenting a relay URL or relay pairing command for direct-backend registration.

The current `@whisperopencode/push` plugin installation remains compatible: the app can ensure it is present in a backend's OpenCode plugin configuration using existing `/global/config`, `/global/dispose`, and PTY APIs. A backend running an older push plugin reports a clear upgrade-required registration error.

The future third-party extension point is the CLI contract, not an upstream HTTP API: a backend advertises a compatible `opencode-push register --stdin` command and manages its own delivery credentials. The initial app implementation only auto-registers against operator-controlled servers selected by an explicit trust policy.

## Testing

Tests must cover:

- plugin registration validation, idempotent token replacement, preference updates, removal, and `0600` persistence;
- FCM payload construction, missing configuration, transient failures, and invalid-token deactivation;
- event preference filtering and non-blocking session-event handling;
- PTY registration transport using standard input, including proof that no FCM token appears in command arguments or captured output;
- app server-scoped registration state, auto-registration after connection/token refresh, retry behavior, unregister behavior, and Send Test target selection;
- Android native one-time payload creation and token-refresh signaling;
- an integration fixture that runs two controlled authenticated backend boundaries with independent plugin registries, registers the same fake Android device through bounded standard input, publishes completion and approval events on separate backends, and observes exactly one corresponding mock FCM send from each;
- aggregate security assertions covering command arguments, PTY create bodies and URLs, plugin logs, CLI output, backend registry permissions, app persistence, diagnostics, and surfaced errors;
- coexistence assertions proving explicit relay delivery and retained relay data without automatic mode conversion, migration, or deletion.

## Implementation Boundaries

Primary changes belong in fork-owned code:

- `packages/push/**`
- `packages/push-relay/**` only when extracting or sharing the FCM adapter
- `packages/app/**`
- `packages/android/**`
- Android mobile bridge sources under `packages/android/src-tauri/mobile-bridge/**`

Do not modify:

- `packages/opencode/**`
- public Protocol or Server `HttpApi` definitions
- generated SDK clients
- desktop or iOS code
- upstream OpenCode API contracts
