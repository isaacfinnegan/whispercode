# OpenCode Ntfy Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone OpenCode plugin in this repository that publishes session notifications through any ntfy server and add Android-only `opencode://open-session` handling so notification taps open the correct WhisperCode session.

**Architecture:** The external plugin observes OpenCode compatibility events, maintains a root-session active/error state machine, and serializes bounded HTTP publishes to ntfy. It sends privacy-limited payloads whose click URI contains only the configured WhisperCode server URL and session ID. Android native code validates the deep-link transport envelope; shared WhisperCode TypeScript performs the complete parameter and routing validation before converting the URI to the existing canonical server-keyed session route. The standalone plugin and WhisperCode integration are separate execution tracks with separate repositories, verification, and commits.

**Tech Stack:** Bun 1.3.10, TypeScript, `@opencode-ai/plugin` 1.18.5, ntfy JSON publish API, SolidJS routing, Tauri 2, Rust, Kotlin, Robolectric, Bun tests.

---

## Scope Boundaries

This is an umbrella plan coordinating two independently executable tracks:

- **Track A, Tasks 1-7:** build and verify the standalone `/Users/isaac/Projects/opencode-nfty` repository.
- **Track B, Tasks 8-10:** modify WhisperCode in a clean worktree after Track A's click-link contract tests pass.

Do not interleave the tracks or create a commit containing files from both repositories. Track A is useful without Track B for ordinary ntfy delivery; Track B is useful independently for validated `opencode://open-session` links. This `/Users/isaac/Projects/opencode-nfty` workspace is the standalone plugin target. The prior `opencode-ntfy` sibling path is not used by this implementation.

Do not modify:

- `packages/opencode/**`
- `packages/push/**`, `packages/push-provider/**`, or `packages/push-relay/**`
- native push, FCM, APNs, relay, or notification settings code
- iOS, web, Protocol, Server `HttpApi`, generated clients, or desktop application behavior; the mobile bridge's `desktop.rs` compile-time unavailable-command stubs are the only desktop-named exception
- prompt or response content

Android remote-push removal is complete in commits `b47fb07b7e` and `3497b64a42`. Treat that merged state as the baseline. Do not recreate `NotificationTapHandler`, `pushOpened`, FCM services, push commands, or removed settings. The new deep-link path must remain push-provider-independent.

## Current Baseline

- `MobileBridgePlugin.kt` now contains only voice, network scan, cancellation, sharing, and generic listener support.
- `bridge.ts` and `build.rs` expose only `isWhisperReady`, `startRecording`, `stopRecording`, `scanNetwork`, `cancelScan`, and `share` beyond Tauri's generic permission/listener commands.
- The Android bridge Gradle module retains JUnit but no longer includes Robolectric or Android-resource unit-test configuration.
- `MainActivity.kt` has no `onNewIntent`; the manifest has only launcher/Leanback filters and retains `singleTask` launch mode.
- `android-remote-push-removal.test.ts` protects local notifications and verifies that remote-push files remain deleted.
- The current checkout contains unrelated modified `node_modules` and stale generated push-permission artifacts. Implement WhisperCode tasks in a clean worktree and never stage those artifacts.

## Environment Contract

```sh
OPENCODE_NTFY_URL="https://ntfy.example.com"
OPENCODE_NTFY_TOPIC="opencode-private-topic"
OPENCODE_NTFY_TOKEN="tk_optional_access_token"
OPENCODE_NTFY_APP_SERVER_URL="https://code.example.com"
```

- `OPENCODE_NTFY_URL`, `OPENCODE_NTFY_TOPIC`, and `OPENCODE_NTFY_APP_SERVER_URL` are required.
- `OPENCODE_NTFY_TOKEN` is optional and is sent only as `Authorization: Bearer ...`.
- Both URLs must use HTTP(S), must not contain credentials, and are normalized by removing trailing `/` characters.
- The topic must be one nonempty path segment.
- Tokens never appear in command arguments, links, logs, diagnostics, thrown messages, or test snapshots.

## File Structure

### Standalone project: `/Users/isaac/Projects/opencode-nfty`

- `package.json`: package metadata, scripts, CLI entry, and OpenCode plugin dependency.
- `tsconfig.json`: strict Bun TypeScript configuration.
- `src/config.ts`: environment parsing, normalization, and secret-safe validation results.
- `src/notification.ts`: notification kinds, copy, title sanitation, priorities, tags, and click URI construction.
- `src/publish.ts`: bounded ntfy JSON publisher with optional Bearer authentication.
- `src/events.ts`: root-session state, active-to-idle completion detection, error suppression, and cooldowns.
- `src/plugin.ts`: OpenCode hook, session metadata hydration, serialized queue, warning policy, and bounded disposal.
- `src/cli.ts`: `check`, `send-test`, and `print-link` commands.
- `src/*.test.ts`: focused Bun tests for each boundary.
- `skills/opencode-ntfy/SKILL.md`: setup and troubleshooting skill, not runtime logic.
- `README.md`: installation, environment, privacy, CLI, and troubleshooting documentation.

### WhisperCode

- `packages/app/src/pages/layout/deep-links.ts`: strict parser and collector for `opencode://open-session`.
- `packages/app/src/pages/layout/helpers.test.ts`: parser security and compatibility tests.
- `packages/app/src/pages/layout.tsx`: acknowledge queued links and process open-session links before the local-server-only project link guard.
- `packages/android/src/deep-link-native.ts`: native event queueing and readiness helper.
- `packages/android/src/deep-link-native.test.ts`: listener, queue, and command-order tests.
- `packages/android/src/bridge.ts`: private deep-link readiness command mappings.
- `packages/android/src/bridge.test.ts`: retain the remote-push rejection checks while admitting only the two new deep-link commands.
- `packages/android/src/android-remote-push-removal.test.ts`: run unchanged as a regression guard.
- `packages/android/src/entry-android.tsx`: install the `deepLinkOpened` listener and dispatch `opencode:deep-link`.
- `packages/android/src-tauri/mobile-bridge/build.rs`: register the two deep-link readiness commands.
- `packages/android/src-tauri/mobile-bridge/src/{commands,mobile,desktop,lib}.rs`: expose mobile commands, unavailable desktop stubs, and Tauri registration.
- `packages/android/src-tauri/mobile-bridge/permissions/default.toml`: grant only those two commands through the default capability.
- `packages/android/src-tauri/mobile-bridge/android/build.gradle.kts`: restore Robolectric test support only; do not restore push dependencies.
- `packages/android/src-tauri/mobile-bridge/android/src/main/java/DeepLinkHandler.kt`: push-independent URI validation and cold-start buffering.
- `packages/android/src-tauri/mobile-bridge/android/src/test/java/DeepLinkHandlerTest.kt`: warm/cold intent and rejection tests.
- `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`: expose readiness and `deepLinkOpened` event only.
- `packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt`: forward launch and new intents to `DeepLinkHandler`.
- `packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml`: register the exact custom scheme and host.

## Notification Contract

| Kind | ntfy title prefix | Message | Priority | Tag |
| --- | --- | --- | --- | --- |
| `complete` | `Response ready` | `Tap to return to WhisperCode` | 3 | `white_check_mark` |
| `error` | `Session failed` | `Tap to return to WhisperCode` | 4 | `warning` |
| `approval` | `Permission approval required` | `Tap to review in WhisperCode` | 4 | `lock` |
| `question` | `Input required` | `Tap to answer in WhisperCode` | 4 | `question` |

Append a sanitized session title to the title prefix when available. Cap the complete title, including the prefix and `: ` separator, at 100 Unicode code points. Do not include prompts, responses, filesystem paths, credentials, or tokens.

### Task 1: Scaffold the Standalone Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Verify the target contains only the approved plan**

Run from `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk git status --short
```

Expected: only the approved plan is untracked. If unrelated files are present, stop and ask before modifying them.

- [ ] **Step 2: Create the project directories**

Run from `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk mkdir -p src skills/opencode-ntfy
```

Expected: source and skill directories exist in the initialized standalone repository.

- [ ] **Step 3: Add package and TypeScript configuration**

Create `package.json`:

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "opencode-ntfy",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "license": "MIT",
  "exports": { ".": "./src/plugin.ts" },
  "bin": { "opencode-ntfy": "./src/cli.ts" },
  "scripts": {
    "check": "bun run src/cli.ts check",
    "test": "bun test src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@opencode-ai/plugin": "1.18.5" },
  "devDependencies": {
    "@types/bun": "1.3.13",
    "@types/node": "24.12.2",
    "typescript": "5.8.2"
  },
  "engines": { "bun": ">=1.3.10" }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun", "node"],
    "allowImportingTsExtensions": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Install dependencies**

Run from `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk bun install
```

Expected: `bun.lock` is created and install succeeds without peer-dependency errors affecting the plugin API.

- [ ] **Step 5: Verify the pinned plugin and SDK contracts**

Run from `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk read node_modules/@opencode-ai/plugin/dist/index.d.ts
rtk read node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts
rtk read node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts
```

Expected: `Plugin` returns hooks containing `event({ event })`; session create/update/delete events carry `properties.info`; session status/idle/error and `permission.updated` match the table in Task 5; and `Session.get` accepts `Options<SessionGetData>` where the ID is `path.id`. The 1.18.5 event union is not expected to contain `question.asked`, so Task 5 handles that single event through an `unknown` structural compatibility boundary. If any declared known shape differs, stop and revise the fixtures and adapter before writing runtime code; do not use an unchecked cast to force the plan's assumed shape.

- [ ] **Step 6: Commit the scaffold**

```sh
rtk git add package.json tsconfig.json bun.lock
rtk git commit -m "chore: scaffold opencode ntfy plugin"
```

### Task 2: Parse and Validate Environment Configuration

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Cover this public contract:

```ts
export type Config = {
  endpoint: URL
  topic: string
  token?: string
  appServerURL: string
}

export type ConfigResult =
  | { ok: true; value: Config }
  | { ok: false; issues: string[] }

export function readConfig(env: Record<string, string | undefined>): ConfigResult
```

Add tests proving:

```ts
expect(
  readConfig({
    OPENCODE_NTFY_URL: "https://ntfy.example.com///",
    OPENCODE_NTFY_TOPIC: "private-topic",
    OPENCODE_NTFY_TOKEN: "secret-token",
    OPENCODE_NTFY_APP_SERVER_URL: "https://code.example.com/",
  }),
).toEqual({
  ok: true,
  value: {
    endpoint: new URL("https://ntfy.example.com"),
    topic: "private-topic",
    token: "secret-token",
    appServerURL: "https://code.example.com",
  },
})
```

Also assert rejection of missing required variables, non-HTTP protocols, embedded URL credentials, ntfy URL query/fragment, app-server query/fragment, topics containing `/`, whitespace-only topics, and values that include the token in no issue string.

- [ ] **Step 2: Run the focused tests and verify RED**

Run from `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk bun test src/config.test.ts
```

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement minimal strict parsing**

Use one URL parser that checks `http:` or `https:`, rejects username/password/search/hash, strips trailing slashes from `pathname`, and returns field-name-only errors such as `OPENCODE_NTFY_URL must be an HTTP(S) URL without credentials, query, or fragment`. Never interpolate raw values into issues.

Topic validation must use:

```ts
const validTopic = (value: string) => value.length > 0 && value.length <= 256 && !/[\s/?#]/.test(value)
```

Return all issues in stable variable order so `check` output and tests are deterministic.

- [ ] **Step 4: Run tests and typecheck**

```sh
rtk bun test src/config.test.ts
rtk bun run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```sh
rtk git add src/config.ts src/config.test.ts
rtk git commit -m "feat: validate ntfy environment"
```

### Task 3: Build Privacy-Safe Notification Payloads

**Files:**
- Create: `src/notification.ts`
- Create: `src/notification.test.ts`

- [ ] **Step 1: Write failing payload tests**

Define and test:

```ts
export type Kind = "complete" | "error" | "approval" | "question" | "test"

export type NotificationInput = {
  kind: Kind
  topic: string
  appServerURL: string
  sessionID?: string
  sessionTitle?: string
}

export type NtfyPayload = {
  topic: string
  title: string
  message: string
  priority: 3 | 4
  tags: string[]
  click?: string
}

export function isSessionID(value: string): boolean
export function makeClickURL(server: string, sessionID: string): string
export function makeNotification(input: NotificationInput): NtfyPayload
```

Assert exact complete output:

```ts
expect(
  makeNotification({
    kind: "complete",
    topic: "private-topic",
    appServerURL: "https://code.example.com",
    sessionID: "ses_abc123",
    sessionTitle: "Fix authentication",
  }),
).toEqual({
  topic: "private-topic",
  title: "Response ready: Fix authentication",
  message: "Tap to return to WhisperCode",
  priority: 3,
  tags: ["white_check_mark"],
  click:
    "opencode://open-session?server=https%3A%2F%2Fcode.example.com&session=ses_abc123",
})
```

Test all four production kinds, `test`, reserved-character server URL encoding, missing or invalid session IDs omitting `click`, accepted `[A-Za-z0-9_-]` session IDs, control/newline removal from titles, whitespace collapse, fallback titles, and truncation of the complete prefix-plus-separator-plus-session title to 100 code points without splitting surrogate pairs.

- [ ] **Step 2: Run RED**

```sh
rtk bun test src/notification.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement payload construction**

Construct click URIs with `URL` and `searchParams`, not string interpolation:

```ts
export const isSessionID = (value: string) => value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value)

export function makeClickURL(server: string, sessionID: string) {
  const url = new URL("opencode://open-session")
  url.searchParams.set("server", server)
  url.searchParams.set("session", sessionID)
  return url.toString()
}
```

Call `makeClickURL` only when `isSessionID(input.sessionID)` is true; otherwise omit `click`. Sanitize the optional title with `Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())`. Compute the suffix budget as `100 - Array.from(prefix).length - 2`, slice the sanitized title to that many code points, and append `: ${suffix}` only when the sliced suffix is nonempty. The prefix alone is the fallback, and the resulting complete title must never exceed 100 code points.

- [ ] **Step 4: Run GREEN**

```sh
rtk bun test src/notification.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
rtk git add src/notification.ts src/notification.test.ts
rtk git commit -m "feat: build ntfy notification payloads"
```

### Task 4: Implement the Bounded Ntfy HTTP Client

**Files:**
- Create: `src/publish.ts`
- Create: `src/publish.test.ts`

- [ ] **Step 1: Write failing HTTP tests**

Define:

```ts
export type PublishResult =
  | { ok: true }
  | { ok: false; code: "http_error" | "network_error" | "timeout"; status?: number }

export async function publish(
  config: Config,
  payload: NtfyPayload,
  deps?: { fetch?: typeof fetch; timeoutMs?: number },
): Promise<PublishResult>
```

Use an injected fake `fetch` to assert POST to the normalized ntfy base URL, `Content-Type: application/json`, exact JSON body, optional Bearer header, no Authorization header without a token, non-2xx status-only errors, network errors, and timeout classification. Assert `JSON.stringify(result)` and thrown messages never contain `secret-token`.

- [ ] **Step 2: Run RED**

```sh
rtk bun test src/publish.test.ts
```

Expected: FAIL because `src/publish.ts` does not exist.

- [ ] **Step 3: Implement one-attempt publishing**

Use an `AbortController`, a default `10_000` ms timer, and `finally` cleanup. Return structured errors; do not throw response bodies, automatically retry, or read potentially secret-bearing error text.

```ts
const response = await request(config.endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  },
  body: JSON.stringify(payload),
  signal: controller.signal,
})
```

- [ ] **Step 4: Run GREEN**

```sh
rtk bun test src/publish.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
rtk git add src/publish.ts src/publish.test.ts
rtk git commit -m "feat: publish notifications through ntfy"
```

### Task 5: Detect Notification-Worthy Session Events

**Files:**
- Create: `src/events.ts`
- Create: `src/events.test.ts`

- [ ] **Step 1: Write the state-machine tests**

Define a framework-independent boundary:

```ts
export type SessionMeta = { root: boolean; title?: string }
export type Candidate = { kind: Exclude<Kind, "test">; sessionID?: string; requestID?: string }
export type EventState = ReturnType<typeof createEventState>

export function createEventState(now?: () => number): {
  remember(sessionID: string, meta: SessionMeta): void
  forget(sessionID: string): void
  ingest(event: unknown): Candidate | undefined
  metadata(sessionID: string): SessionMeta | undefined
}
```

Tests must prove:

- `busy` or `retry` followed by `idle` produces one root completion.
- bare/no-op idle produces nothing.
- child sessions never produce notifications.
- active error produces one error and suppresses the following completion.
- a new busy/retry clears stale error state.
- permission and question events produce root candidates with request IDs.
- unknown root metadata produces no candidate until the plugin hydrates metadata.
- deprecated `session.idle` can complete an active session but is deduplicated against preceding `session.status idle`.
- cooldowns are 30 seconds for completion/error and 15 seconds for approval/question.
- deletion clears all session state.

Pin fixtures to the OpenCode 1.18.5 runtime shapes:

| Event | Required properties |
| --- | --- |
| `session.created`, `session.updated`, `session.deleted` | `{ info: { id, parentID?, title } }` |
| `session.status` | `{ sessionID, status: { type: "busy" | "retry" | "idle", ... } }` |
| `session.idle` | `{ sessionID }` |
| `session.error` | `{ sessionID?, error? }` |
| `permission.updated` | `{ id, sessionID, ... }`; use `id` as `requestID` |
| `question.asked` compatibility event | `{ id, sessionID, ... }`; use `id` as `requestID` |

`@opencode-ai/sdk` 1.18.5 declares the first six shapes but does not include `question.asked` in its static `Event` union. Keep `ingest(event: unknown)` and validate that compatibility event structurally; do not cast the hook's full event union or inspect question text/options. Task 10 must confirm that the installed OpenCode host actually emits this event before question notifications can be marked complete.

Use event objects with compatibility `properties`, for example:

```ts
state.ingest({
  type: "session.status",
  properties: { sessionID: "ses_1", status: { type: "busy" } },
})
```

- [ ] **Step 2: Run RED**

```sh
rtk bun test src/events.test.ts
```

Expected: FAIL because `src/events.ts` does not exist.

- [ ] **Step 3: Implement the minimal state machine**

Store only:

```ts
type StoredSession = {
  root: boolean
  title?: string
  active: boolean
  errored: boolean
}
```

Use collapse keys `${kind}:${sessionID ?? "global"}:${requestID ?? ""}` and injected time for deterministic cooldown tests. Session created/updated events call `remember` from `properties.info`; session deleted calls `forget(properties.info.id)`. Do not persist state to disk in v1.

- [ ] **Step 4: Run GREEN**

```sh
rtk bun test src/events.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
rtk git add src/events.ts src/events.test.ts
rtk git commit -m "feat: detect session notification events"
```

### Task 6: Compose the OpenCode Plugin Lifecycle

**Files:**
- Create: `src/plugin.ts`
- Create: `src/plugin.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Test the default export as an OpenCode `Plugin` with injected internal dependencies. Prove:

- invalid config disables delivery and emits exactly one sanitized warning;
- events are processed and publishes occur serially;
- session metadata is cached from created/updated events;
- unknown session metadata is hydrated with `client.session.get({ path: { id: sessionID } })` before ingesting status/error/permission/question events;
- failed hydration suppresses the event rather than assuming a root session;
- publish failure does not reject the hook;
- events after disposal are ignored;
- disposal waits for pending work for at most one second;
- generated payloads contain title/session routing metadata but no event body, prompt, directory, or token.

Assert this exported test seam without exporting runtime secrets:

```ts
export type PluginDeps = {
  env?: Record<string, string | undefined>
  publish?: typeof publish
  warn?: (message: string) => void
  now?: () => number
}

type ExpectedPluginModule = {
  createPlugin: (deps?: PluginDeps) => Plugin
  default: Plugin
}

expectTypeOf(await import("./plugin.ts")).toMatchTypeOf<ExpectedPluginModule>()
```

- [ ] **Step 2: Run RED**

```sh
rtk bun test src/plugin.test.ts
```

Expected: FAIL because `src/plugin.ts` does not exist.

- [ ] **Step 3: Implement serialized, failure-isolated hooks**

Use one promise chain and a stopped flag:

```ts
let run = Promise.resolve()
let stopped = false

const enqueue = (work: () => Promise<void>) => {
  if (stopped) return run
  run = run.then(work).catch(() => undefined)
  return run
}
```

Before state ingestion, extract a session ID from the pinned shapes above. If metadata is absent, call `client.session.get({ path: { id: sessionID } })`, require `response.data`, and remember `{ root: !data.parentID, title: data.title }`. This call shape comes from `@opencode-ai/sdk` 1.18.5's generated `SessionGetData`; lock it with a lifecycle test that asserts the exact argument. Never fetch for deleted events or events without a session ID.

On a candidate, call `makeNotification` with cached title and await exactly one `publish`. Disposal sets `stopped`, snapshots `run`, and races it against a one-second timer.

- [ ] **Step 4: Run the plugin suite**

```sh
rtk bun test src/plugin.test.ts src/events.test.ts src/publish.test.ts src/notification.test.ts src/config.test.ts
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
rtk git add src/plugin.ts src/plugin.test.ts
rtk git commit -m "feat: add reliable opencode ntfy plugin"
```

### Task 7: Add CLI, Setup Skill, and Operator Documentation

**Files:**
- Create: `src/cli.ts`
- Create: `src/cli.test.ts`
- Create: `skills/opencode-ntfy/SKILL.md`
- Create: `README.md`

- [ ] **Step 1: Write failing CLI tests**

Define `run(argv, env, io)` and test:

```ts
export type IO = {
  out(message: string): void
  err(message: string): void
}

export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  io: IO,
): Promise<number>
```

Required behavior:

- `check`: exit 0 and print normalized URL/topic/app server plus `token: configured|not configured`; invalid config exits 1 with field-only issues.
- `print-link <session-id>`: exit 0 and print the encoded `opencode://open-session` URI; missing, empty, oversized, or non-`[A-Za-z0-9_-]` IDs exit 2.
- `send-test [session-id]`: publish a `test` payload and exit 0 on success, 1 on delivery/config failure.
- unknown command: print usage and exit 2.
- no output contains the token.

- [ ] **Step 2: Run RED**

```sh
rtk bun test src/cli.test.ts
```

Expected: FAIL because `src/cli.ts` does not exist.

- [ ] **Step 3: Implement CLI dispatch and executable entrypoint**

After exporting `run`, add:

```ts
#!/usr/bin/env bun

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), process.env, {
    out: console.log,
    err: console.error,
  })
}
```

Do not accept a token flag or print raw HTTP response bodies.

- [ ] **Step 4: Write setup-only skill**

Use this exact frontmatter:

```md
---
name: opencode-ntfy
description: Configure, validate, test, and troubleshoot the standalone opencode-ntfy notification plugin. Use when installing ntfy notifications, checking OPENCODE_NTFY_* variables, sending a test notification, or validating an Android session link.
---
```

The body must instruct agents to run `opencode-ntfy check`, `opencode-ntfy send-test`, and `opencode-ntfy print-link`; redact tokens; never put secrets in `opencode.json`; and remind users to restart OpenCode after plugin/config changes. It must explicitly state that the skill does not trigger notifications.

- [ ] **Step 5: Write README installation and privacy guidance**

Document:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/isaac/Projects/opencode-nfty/src/plugin.ts"]
}
```

Also document the four environment variables, all CLI commands, notification kinds, custom click URI format, Android-only v1 limitation, root-session/error semantics, no-retry behavior, and the privacy boundary. Tell users to merge the plugin entry into `~/.config/opencode/opencode.json`, preserve existing fields, validate against `https://opencode.ai/config.json`, and restart OpenCode.

- [ ] **Step 6: Run all standalone checks**

```sh
rtk bun test src
rtk bun run typecheck
rtk bun run src/cli.ts check
```

Expected: tests/typecheck pass; `check` exits according to the shell’s actual environment without printing a token.

- [ ] **Step 7: Commit**

```sh
rtk git add src/cli.ts src/cli.test.ts skills/opencode-ntfy/SKILL.md README.md
rtk git commit -m "docs: add ntfy setup and diagnostics"
```

### Task 8: Add Strict Shared Open-Session Parsing

**Precondition:** Create a clean WhisperCode worktree from `dev` and verify that it contains merge commit `3497b64a42`. Carry this plan into that worktree. Do not implement Android changes in the dirty primary checkout.

**Files:**
- Modify: `packages/app/src/pages/layout/deep-links.ts`
- Modify: `packages/app/src/pages/layout/helpers.test.ts`
- Modify: `packages/app/src/pages/layout.tsx`

- [ ] **Step 1: Run GitNexus impact before editing symbols**

From the clean WhisperCode worktree, run:

```sh
rtk git merge-base --is-ancestor 3497b64a42 HEAD
rtk git status --short
rtk read packages/app/src/pages/layout/deep-links.ts
rtk read packages/app/src/pages/layout.tsx
rtk read packages/app/src/pages/layout/helpers.test.ts
```

Expected: the ancestor check exits 0, status is clean except for the carried plan, `deep-links.ts` contains the existing project/new-session parser and pending queue helpers, `layout.tsx` contains the local-server guard, and the helper test command in this task exists. If a file, symbol, or test harness differs, stop and revise this task against the checked-out baseline instead of applying the snippets by resemblance.

Then run upstream GitNexus impact for `parseDeepLink`, `handleDeepLinks`, and `sessionHref`. Warn before proceeding if any result is HIGH or CRITICAL.

- [ ] **Step 2: Write failing parser tests**

Add imports for `acknowledgePendingDeepLinks`, `collectOpenSessionDeepLinks`, and `parseOpenSessionDeepLink`. Assert:

```ts
expect(
  parseOpenSessionDeepLink(
    "opencode://open-session?server=https%3A%2F%2Fcode.example.com%2F&session=ses_abc123",
  ),
).toEqual({ server: "https://code.example.com", session: "ses_abc123" })
```

Reject wrong scheme/host, including `https://open-session?...`, outer-link credentials/port/fragment, missing/empty values, duplicate `server` or `session`, unknown parameters, URL length over 2048, server length over 1024, session length over 256, session IDs outside `[A-Za-z0-9_-]`, server credentials, non-HTTP(S) server, server query/fragment, and malformed encoding. The session restriction is required because `sessionHref` places the ID into a route segment. Confirm existing open-project/new-session tests remain unchanged.

Also prove queue acknowledgement removes only delivered occurrences and leaves links whose event was not observed. Add a duplicate case where two identical pending links and one delivered link leave one pending occurrence:

```ts
const target = {
  __OPENCODE__: {
    deepLinks: ["opencode://open-session?server=https%3A%2F%2Fa&session=one", "opencode://open-project?directory=/b"],
  },
} as Window & { __OPENCODE__?: { deepLinks?: string[] } }

acknowledgePendingDeepLinks(target, ["opencode://open-session?server=https%3A%2F%2Fa&session=one"])
expect(target.__OPENCODE__?.deepLinks).toEqual(["opencode://open-project?directory=/b"])
```

```ts
const duplicate = "opencode://open-session?server=https%3A%2F%2Fa&session=one"
target.__OPENCODE__!.deepLinks = [duplicate, duplicate]
acknowledgePendingDeepLinks(target, [duplicate])
expect(target.__OPENCODE__?.deepLinks).toEqual([duplicate])
```

- [ ] **Step 3: Run RED**

Run from `packages/app`:

```sh
rtk bun test --preload ./happydom.ts ./src/pages/layout/helpers.test.ts -t "layout deep links"
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 4: Implement strict parsing**

Add:

```ts
export type OpenSessionDeepLink = { server: string; session: string }

export const parseOpenSessionDeepLink = (input: string): OpenSessionDeepLink | undefined => {
  if (input.length > 2048) return
  const url = parseUrl(input)
  if (!url || url.protocol !== "opencode:" || url.hostname !== "open-session") return
  if (url.pathname !== "" && url.pathname !== "/") return
  if (url.username || url.password || url.port || url.hash) return
  if ([...url.searchParams.keys()].some((key) => key !== "server" && key !== "session")) return
  const servers = url.searchParams.getAll("server")
  const sessions = url.searchParams.getAll("session")
  if (servers.length !== 1 || sessions.length !== 1) return
  const session = sessions[0]?.trim()
  if (!session || session.length > 256 || !/^[A-Za-z0-9_-]+$/.test(session)) return
  const rawServer = servers[0]?.trim()
  if (!rawServer || rawServer.length > 1024) return
  try {
    const server = new URL(rawServer)
    if (server.protocol !== "http:" && server.protocol !== "https:") return
    if (server.username || server.password || server.search || server.hash) return
    server.pathname = server.pathname.replace(/\/+$/, "")
    return { server: server.toString().replace(/\/$/, ""), session }
  } catch {
    return
  }
}

export const collectOpenSessionDeepLinks = (urls: string[]) =>
  urls.map(parseOpenSessionDeepLink).filter((link): link is OpenSessionDeepLink => !!link)

export const acknowledgePendingDeepLinks = (target: OpenCodeWindow, urls: string[]) => {
  const pending = target.__OPENCODE__?.deepLinks
  if (!pending?.length || urls.length === 0) return
  const delivered = new Map<string, number>()
  for (const url of urls) delivered.set(url, (delivered.get(url) ?? 0) + 1)
  target.__OPENCODE__!.deepLinks = pending.filter((url) => {
    const count = delivered.get(url) ?? 0
    if (count === 0) return true
    delivered.set(url, count - 1)
    return false
  })
}
```

- [ ] **Step 5: Route open-session before the local guard**

Import `sessionHref`. In the custom-event handler, acknowledge queued links before processing them; startup still uses `drainPendingDeepLinks`:

```ts
const handler = (event: Event) => {
  const detail = (event as CustomEvent<{ urls: string[] }>).detail
  const urls = detail?.urls ?? []
  if (urls.length === 0) return
  acknowledgePendingDeepLinks(window, urls)
  handleDeepLinks(urls)
}
```

Process open-session links before the local-only guard:

```ts
for (const link of collectOpenSessionDeepLinks(urls)) {
  navigateWithSidebarReset(sessionHref(ServerConnection.Key.make(link.server), link.session))
}
if (!server.isLocal()) return
```

This preserves local-only behavior for project/new-session links while allowing configured remote servers to resolve through the canonical route.

- [ ] **Step 6: Run focused tests and app typecheck**

Run from `packages/app`:

```sh
rtk bun test --preload ./happydom.ts ./src/pages/layout/helpers.test.ts -t "layout deep links"
rtk bun typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit only shared link changes**

```sh
rtk git add packages/app/src/pages/layout/deep-links.ts packages/app/src/pages/layout/helpers.test.ts packages/app/src/pages/layout.tsx
rtk git commit -m "feat(app): route open-session deep links"
```

### Task 9: Add Push-Independent Android Deep-Link Delivery

**Files:**
- Create: `packages/android/src/deep-link-native.ts`
- Create: `packages/android/src/deep-link-native.test.ts`
- Modify: `packages/android/src/bridge.ts`
- Modify: `packages/android/src/bridge.test.ts`
- Modify: `packages/android/src/entry-android.tsx`
- Modify: `packages/android/src-tauri/mobile-bridge/build.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/src/commands.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/src/mobile.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/src/desktop.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/src/lib.rs`
- Modify: `packages/android/src-tauri/mobile-bridge/permissions/default.toml`
- Regenerate: `packages/android/src-tauri/mobile-bridge/permissions/autogenerated/commands/deep_link_listeners_ready.toml`
- Regenerate: `packages/android/src-tauri/mobile-bridge/permissions/autogenerated/commands/deep_link_listeners_not_ready.toml`
- Regenerate: `packages/android/src-tauri/mobile-bridge/permissions/autogenerated/reference.md`
- Regenerate: `packages/android/src-tauri/mobile-bridge/permissions/schemas/schema.json`
- Modify: `packages/android/src-tauri/mobile-bridge/android/build.gradle.kts`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/DeepLinkHandler.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/test/java/DeepLinkHandlerTest.kt`
- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`
- Modify: `packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt`
- Modify: `packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Test unchanged: `packages/android/src/android-remote-push-removal.test.ts`

- [ ] **Step 1: Confirm the clean post-removal baseline and run impact analysis**

Confirm HEAD contains `3497b64a42`, `rtk git status --short` is clean except for the carried plan, and deleted push files remain absent. Inspect the current `MobileBridgePlugin`, Rust bridge wrappers, `MainActivity`, `entry-android`, bridge commands, manifest, and tests. Verify each file listed in this task exists at the stated path and that `MainActivity` still uses `singleTask`, `entry-android.tsx` already owns native listener startup/cleanup, and the original six bridge commands match `bridge.test.ts`. If any baseline differs, stop and revise the file list, command names, and tests before editing; do not recreate APIs from an older commit.

Run GitNexus upstream impact for `MobileBridgePlugin.load`, `MobileBridgePlugin.onDestroy`, `MainActivity.onCreate`, Rust `init`, and TypeScript `createBridge`. Do not query or base edits on deleted push symbols; `MainActivity.onNewIntent` is intentionally absent at this baseline.

- [ ] **Step 2: Restore only the native test support required for intent tests**

Add Android-resource unit tests and Robolectric without restoring Firebase, WorkManager, encrypted preferences, MockWebServer, or any other removed push dependency:

```kotlin
testOptions {
    unitTests.isIncludeAndroidResources = true
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation(project(":tauri-android"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.13")
}
```

- [ ] **Step 3: Write failing Kotlin handler tests**

Define a new interface and test cold/warm behavior:

```kotlin
internal interface DeepLinkOpenedPlugin {
    fun areDeepLinkListenersReady(): Boolean
    fun emitDeepLinkOpened(uri: String)
}
```

Tests must cover ACTION_VIEW with `opencode://open-session?...`, buffering until readiness then flushing once, immediate warm dispatch, latest-value behavior for two pre-ready links, wrong action, wrong scheme, wrong host, outer credentials, custom port, nonempty path, fragment, oversized URI, missing data, and plugin cleanup. Native validation deliberately covers only the transport envelope; Task 8's shared parser remains authoritative for query names, multiplicity, server URL, and session ID.

- [ ] **Step 4: Run Kotlin RED**

Run from `packages/android/src-tauri/gen/android`:

```sh
rtk ./gradlew :tauri-plugin-mobile-bridge:testDebugUnitTest --tests 'ai.opencode.mobilebridge.DeepLinkHandlerTest' --no-daemon
```

Expected: FAIL because `DeepLinkHandler` does not exist.

- [ ] **Step 5: Implement the native handler**

Use this independent shape:

```kotlin
object DeepLinkHandler {
    private const val MAX_URI_LENGTH = 2048
    private var pendingUri: String? = null
    private var bridgePlugin: WeakReference<DeepLinkOpenedPlugin>? = null

    internal fun setPluginInstance(plugin: DeepLinkOpenedPlugin) {
        bridgePlugin = WeakReference(plugin)
    }

    internal fun clearPluginInstance(plugin: DeepLinkOpenedPlugin) {
        if (bridgePlugin?.get() === plugin) bridgePlugin = null
    }

    fun handleIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        val raw = uri.toString()
        if (raw.length > MAX_URI_LENGTH) return
        if (uri.scheme != "opencode" || uri.host != "open-session") return
        if (uri.userInfo != null || uri.port != -1) return
        if (!uri.path.isNullOrEmpty() && uri.path != "/") return
        if (uri.fragment != null) return
        deliverOrBuffer(raw)
    }

    private fun deliverOrBuffer(uri: String) {
        val plugin = bridgePlugin?.get()
        if (plugin == null || !plugin.areDeepLinkListenersReady()) {
            pendingUri = uri
            return
        }
        plugin.emitDeepLinkOpened(uri)
    }

    internal fun flushPendingUri(plugin: DeepLinkOpenedPlugin) {
        if (bridgePlugin?.get() !== plugin || !plugin.areDeepLinkListenersReady()) return
        val uri = pendingUri ?: return
        pendingUri = null
        plugin.emitDeepLinkOpened(uri)
    }
}
```

- [ ] **Step 6: Add Kotlin bridge readiness and event emission**

Make `MobileBridgePlugin` implement `DeepLinkOpenedPlugin`. Add `private var deepLinkListenersReady = false`. In `load`, set it false and call `DeepLinkHandler.setPluginInstance(this)`. In `onDestroy`, clear the plugin instance and set readiness false before existing voice/scan cleanup. Implement `areDeepLinkListenersReady()` and add commands:

```kotlin
@Command
fun deepLinkListenersReady(invoke: Invoke) {
    deepLinkListenersReady = true
    DeepLinkHandler.flushPendingUri(this)
    invoke.resolve()
}

@Command
fun deepLinkListenersNotReady(invoke: Invoke) {
    deepLinkListenersReady = false
    invoke.resolve()
}
```

Emit only:

```kotlin
override fun emitDeepLinkOpened(uri: String) {
    trigger("deepLinkOpened", JSObject().apply { put("uri", uri) })
}
```

- [ ] **Step 7: Expose the readiness commands through Rust and permissions**

Add both names to `build.rs`:

```rust
"deep_link_listeners_ready",
"deep_link_listeners_not_ready",
```

Add command wrappers in `commands.rs`:

```rust
#[command]
pub(crate) async fn deep_link_listeners_ready<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().deep_link_listeners_ready()
}

#[command]
pub(crate) async fn deep_link_listeners_not_ready<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().deep_link_listeners_not_ready()
}
```

Implement mobile methods with `run_mobile_plugin("deepLinkListenersReady", ())` and `run_mobile_plugin("deepLinkListenersNotReady", ())`. Add matching desktop methods that return the existing `Mobile bridge is unavailable on this platform` error. Register both wrappers in `tauri::generate_handler!` in `lib.rs`.

Grant only:

```toml
"allow-deep-link-listeners-ready",
"allow-deep-link-listeners-not-ready",
```

in `permissions/default.toml`. Regenerate permission artifacts by running from the WhisperCode root:

```sh
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk cargo check --manifest-path packages/android/src-tauri/Cargo.toml
```

Expected: Cargo check passes; only the two new command TOMLs plus corresponding reference/schema updates are generated. No removed push command artifact returns.

- [ ] **Step 8: Forward activity intents and register the exact filter**

Import `android.content.Intent` and `ai.opencode.mobilebridge.DeepLinkHandler`. Call `DeepLinkHandler.handleIntent(intent)` after `super.onCreate` and add:

```kotlin
override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    DeepLinkHandler.handleIntent(intent)
}
```

Add a separate manifest filter:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="opencode" android:host="open-session" />
</intent-filter>
```

Do not add wildcard hosts, paths, HTTPS claims, or `autoVerify`.

- [ ] **Step 9: Write failing TypeScript readiness and bridge tests**

Define in `deep-link-native.ts`:

```ts
export const queueDeepLink = (target: Window, uri: string, emit: (uri: string) => void) => void
export const initializeDeepLinks = (
  ready: Promise<unknown>,
  send: (method: string) => Promise<unknown>,
): Promise<void>
```

Test that queueing initializes `window.__OPENCODE__.deepLinks`, appends the URI, emits `opencode:deep-link`, waits for listener registration before sending `deepLinkListenersReady`, and does not acknowledge if listener registration rejects.

Update `bridge.test.ts` so the retained command list contains the original six operations plus:

```ts
"plugin:mobile-bridge|deep_link_listeners_ready",
"plugin:mobile-bridge|deep_link_listeners_not_ready",
```

Keep every removed remote-push method in the unavailable list and continue expecting no native invocation for them.

- [ ] **Step 10: Run TypeScript RED**

Run from `packages/android`:

```sh
rtk bun test src/deep-link-native.test.ts src/bridge.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 11: Implement TypeScript wiring**

Map bridge commands:

```ts
deepLinkListenersReady: "deep_link_listeners_ready",
deepLinkListenersNotReady: "deep_link_listeners_not_ready",
```

In `entry-android.tsx`, listen for `deepLinkOpened`, require a string `uri`, queue it, dispatch `opencode:deep-link`, emit `opencode:resume`, and acknowledge readiness only after `stopDeepLinkOpened.ready`. Cleanup must send `deepLinkListenersNotReady` and unregister the listener. `queueDeepLink` must store before dispatch; shared `acknowledgePendingDeepLinks` removes the queued value when the layout listener actually observes it. Do not import any native-push helper.

- [ ] **Step 12: Run Android, Rust, and removal-regression checks**

Run from `packages/android`:

```sh
rtk bun test src/deep-link-native.test.ts src/bridge.test.ts src/android-remote-push-removal.test.ts
rtk bun typecheck
```

Run from `packages/android/src-tauri/gen/android`:

```sh
rtk ./gradlew :tauri-plugin-mobile-bridge:testDebugUnitTest --tests 'ai.opencode.mobilebridge.DeepLinkHandlerTest' --no-daemon
```

From the WhisperCode root:

```sh
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk cargo check --manifest-path packages/android/src-tauri/Cargo.toml
```

Expected: all checks pass; the removal regression still proves FCM/relay/tap-handler files remain absent.

- [ ] **Step 13: Commit Android deep-link work**

```sh
rtk git add packages/android/src/deep-link-native.ts packages/android/src/deep-link-native.test.ts packages/android/src/bridge.ts packages/android/src/bridge.test.ts packages/android/src/entry-android.tsx packages/android/src-tauri/mobile-bridge/build.rs packages/android/src-tauri/mobile-bridge/src/commands.rs packages/android/src-tauri/mobile-bridge/src/mobile.rs packages/android/src-tauri/mobile-bridge/src/desktop.rs packages/android/src-tauri/mobile-bridge/src/lib.rs packages/android/src-tauri/mobile-bridge/permissions/default.toml packages/android/src-tauri/mobile-bridge/permissions/autogenerated/commands/deep_link_listeners_ready.toml packages/android/src-tauri/mobile-bridge/permissions/autogenerated/commands/deep_link_listeners_not_ready.toml packages/android/src-tauri/mobile-bridge/permissions/autogenerated/reference.md packages/android/src-tauri/mobile-bridge/permissions/schemas/schema.json packages/android/src-tauri/mobile-bridge/android/build.gradle.kts packages/android/src-tauri/mobile-bridge/android/src/main/java/DeepLinkHandler.kt packages/android/src-tauri/mobile-bridge/android/src/test/java/DeepLinkHandlerTest.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml
rtk git commit -m "feat(android): open session deep links"
```

### Task 10: Verify the End-to-End Feature

**Files:**
- Modify only if verification finds a defect in files already listed above.

- [ ] **Step 1: Run standalone project verification**

From `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk bun test src
rtk bun run typecheck
rtk bun run src/cli.ts check
rtk git status
```

Expected: tests/typecheck pass, check is secret-safe, and the repository contains only expected changes.

- [ ] **Step 2: Run focused WhisperCode verification**

From `packages/app`:

```sh
rtk bun test --preload ./happydom.ts ./src/pages/layout/helpers.test.ts -t "layout deep links"
rtk bun typecheck
```

From `packages/android`:

```sh
rtk bun test src/deep-link-native.test.ts src/bridge.test.ts src/android-remote-push-removal.test.ts
rtk bun typecheck
rtk bun run build
```

From `packages/android/src-tauri/gen/android`:

```sh
rtk ./gradlew :tauri-plugin-mobile-bridge:testDebugUnitTest --tests 'ai.opencode.mobilebridge.DeepLinkHandlerTest' --no-daemon
```

From the WhisperCode root:

```sh
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk cargo check --manifest-path packages/android/src-tauri/Cargo.toml
```

Expected: all commands pass. Do not run tests from the repository root.

- [ ] **Step 3: Inspect changed execution flows**

Run GitNexus `detect_changes({ scope: "all", repo: "whispercode" })`. Confirm only shared deep-link parsing/routing and Android deep-link delivery are affected. Investigate unexpected flows before proceeding.

- [ ] **Step 4: Install plugin and skill locally for manual verification**

Merge the documented file URL into `~/.config/opencode/opencode.json` without removing existing fields. Link or copy `skills/opencode-ntfy` to `~/.config/opencode/skills/opencode-ntfy`. Export the four environment variables in the OpenCode backend environment, then fully restart OpenCode.

Do not commit local config or secrets.

- [ ] **Step 5: Validate links before publishing**

From `/Users/isaac/Projects/opencode-nfty`:

```sh
rtk bun run src/cli.ts check
rtk bun run src/cli.ts print-link ses_manual_test
```

Expected: check succeeds and the printed link contains the configured server plus `ses_manual_test`, but no token.

- [ ] **Step 6: Verify Android cold and warm opens**

With WhisperCode stopped, tap an ntfy test notification and confirm Android launches WhisperCode and navigates to the intended session. Repeat while WhisperCode is running and confirm `onNewIntent` routes without creating a second task. Use a real existing session ID for the final check.

- [ ] **Step 7: Verify the host compatibility event and all four event kinds**

First confirm the installed OpenCode host version emits `permission.updated` when approval is required and emits `question.asked` with string `id` and `sessionID` properties when the question tool waits for input. Then trigger one root-session completion, one session error, one permission approval, and one question. Confirm exact copy/priority/tag, session title inclusion, one notification per event, error-to-idle completion suppression, and session navigation on tap. Confirm child-session and bare-idle events do not notify. If the host does not emit the structural `question.asked` event, do not mark question support or this plan complete; either upgrade to a verified host/plugin SDK pair and update Task 1's pinned versions and fixtures, or explicitly remove `question` from the v1 contract in a separately reviewed plan revision.

- [ ] **Step 8: Verify failure isolation and privacy**

Temporarily use an unreachable ntfy URL. Confirm session execution still completes and the plugin hook does not throw. Restore the URL. Inspect console output and ntfy payloads to confirm no token, credentials, prompt, response, or filesystem path appears.

- [ ] **Step 9: Final repository review**

In both repositories run:

```sh
rtk git status
rtk git diff
rtk git log --oneline -10
```

Expected: only planned files changed, no secrets are staged, and commits are scoped to the standalone plugin or WhisperCode deep-link support.

## Completion Criteria

- The plugin runs independently of WhisperCode and all removed native-push infrastructure.
- Root active-to-idle, active error, permission, and question events produce deduplicated ntfy notifications.
- ntfy failures never affect OpenCode session execution.
- Notification taps cold-start or resume Android WhisperCode at the canonical server/session route.
- Android native code rejects invalid custom-scheme transport envelopes, and shared TypeScript rejects invalid or ambiguous route parameters before navigation.
- Tokens and transcript content never leave their intended boundaries.
- No `packages/opencode`, native push, relay, FCM, APNs, iOS, desktop application behavior, or generated API files are changed; only the mobile bridge's unavailable `desktop.rs` command stubs may change for cross-platform compilation.
