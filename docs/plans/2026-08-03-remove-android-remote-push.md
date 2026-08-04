# Remove Android Remote Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remove Android FCM, native remote-push, and Android direct-host registration while preserving Android local notifications, voice/network/share features, iOS relay push, and backend push packages.

**Architecture:** Remove the Android remote-push surface end to end: Android TypeScript, Tauri Rust commands, Kotlin bridge/services, generated Android Firebase configuration, and shared app direct-host/UI activation. Keep the shared iOS push contract and relay/pairing providers, but enable those providers and remote-push settings only on iOS. Do not modify `packages/opencode`, public APIs, generated SDKs, iOS sources, `packages/push`, `packages/push-relay`, or `packages/push-provider`.

**Tech Stack:** SolidJS/TypeScript, Bun, Tauri/Rust, Kotlin/Android Gradle, Firebase Messaging (removed), GitNexus, Bun tests, Cargo, Gradle.

---

## Files And Boundaries

- Android frontend: `packages/android/src/bridge.ts`, `entry-android.tsx`; delete `push-native.ts` and its test; retain `plugin-notification` and `Platform.notify`.
- Android bridge: `packages/android/src-tauri/mobile-bridge/src/{commands,mobile,desktop,lib}.rs`, `build.rs`, `permissions/default.toml`; preserve only readiness, recording, scanning, cancellation, and sharing.
- Android native: surgically reduce `MobileBridgePlugin.kt`; delete FCM/relay/token/cleanup/tap classes and tests; remove Firebase/WorkManager/security dependencies.
- Android packaging: remove Firebase plugin/dependencies/service metadata and tracked `google-services.json`; retain `POST_NOTIFICATIONS`, activity/provider, Internet, and local notification support.
- Shared app: delete `push-host*` files/tests, remove Android direct settings and registration surface, make provider/settings/prefs synchronization iOS-only, retain iOS pairing/relay/plugin behavior.
- Tests: add Android command/packaging guards and iOS-only settings visibility tests; retain and update iOS push tests.

## Task 1: Preserve State And Isolate Work

- [x] Create local archive tag `archive/android-push-2026-08-03` at the original `dev` HEAD.
- [x] Create branch `fix/remove-android-remote-push` in `.worktrees/remove-android-remote-push` from `dev`.
- [ ] Never stage the original checkout's modified `node_modules` or generated permission artifacts.

## Task 2: Run Impact Gates

- [ ] Run GitNexus upstream impact for Android entry `App`, `createBridge`, Kotlin `MobileBridgePlugin`, Rust `init`, `SettingsMobileNotifications`, `PushHostProvider`, and `sendPushTest`.
- [ ] Stop and report before edits if any result is HIGH or CRITICAL.

## Task 3: Add Android Regression Tests First

**Files:** create `packages/android/src/bridge.test.ts` and `packages/android/src/android-remote-push-removal.test.ts`.

- [ ] Test that only `isWhisperReady`, `startRecording`, `stopRecording`, `scanNetwork`, `cancelScan`, and `share` map to native commands.
- [ ] Test that removed push methods resolve unavailable without invoking native commands.
- [ ] Test that local notification package, Cargo plugin, capability, `Platform.notify`, and `POST_NOTIFICATIONS` remain.
- [ ] Test that deleted push classes/configuration and Firebase/remote-push terms are absent from guarded Android source files.
- [ ] Run focused tests and record expected RED failures before implementation.

## Task 4: Remove Android TypeScript Push Surface

**Files:** modify `packages/android/src/bridge.ts` and `packages/android/src/entry-android.tsx`; delete `packages/android/src/push-native.ts` and `push-native.test.ts`.

- [ ] Reduce the bridge command map to the six retained commands.
- [ ] Remove Android push imports, state, initialization, listeners, teardown, event methods, pairing/preferences/credential methods, and `getPushRegistration`.
- [ ] Preserve voice, storage, HTTP, haptics, sharing, generic listeners, and `Platform.notify`.
- [ ] Run Android tests, typecheck, and frontend build.

## Task 5: Remove Rust Bridge Push Commands

**Files:** modify `commands.rs`, `mobile.rs`, `desktop.rs`, `lib.rs`, `build.rs`, and `permissions/default.toml`.

- [ ] Remove all push functions, payloads, forwarding methods, stubs, invoke registrations, and Android-only command-list logic.
- [ ] Keep generic permission/listener commands and the six retained operations.
- [ ] Regenerate permissions with Cargo; reconcile generated output without staging unrelated pre-existing artifacts.
- [ ] Run `cargo check --manifest-path packages/android/src-tauri/Cargo.toml`.

## Task 6: Remove Kotlin Native Push Implementation

**Files:** modify `MobileBridgePlugin.kt` and `mobile-bridge/android/build.gradle.kts`; delete FCM, relay, token, cleanup, lifecycle, network-retry, tap-handler, secure-preference, icon, and seven push-test files listed in the approved design.

- [ ] Remove Firebase imports/models/helpers, push lifecycle fields, `PushOpenedPlugin`, push commands, token/relay cleanup, and push callbacks.
- [ ] Retain microphone permission, voice recognition, scan/cancel behavior, sharing, generic event callbacks, and cleanup of recording/scanning.
- [ ] Leave only six command methods on the plugin.
- [ ] Remove push-only runtime/test dependencies and stale test setup while retaining core KTX, Tauri Android, and necessary tests.
- [ ] Add/run a native surface test if the remaining Gradle test setup supports it.

## Task 7: Remove Android Firebase Packaging

**Files:** generated root/app Gradle files, app manifest, `MainActivity.kt`, `.gitignore`; delete tracked app `google-services.json`.

- [ ] Remove Google Services classpath/plugin, Firebase BOM/messaging, Firebase service and channel metadata, notification tap imports/callbacks, and `onNewIntent`.
- [ ] Preserve lifecycle behavior that predates FCM, WebView/theme/SSL behavior, activity/provider, Internet, and `POST_NOTIFICATIONS`.
- [ ] Preserve package notification dependency, Rust notification plugin, capability, and local notification code.
- [ ] Build/check Android packaging after native source cleanup.

## Task 8: Make Shared Providers And Platform Contract iOS-Only

**Files:** `packages/app/src/app.tsx`, `context/platform.tsx`, `pages/layout.tsx`, `utils/push-test.ts` and test.

- [ ] Delete Android-only `PushRegistration`/`getPushRegistration` and normalize-registration usage while preserving all iOS push methods.
- [ ] Delete `push-host.tsx`, `push-host.ts`, `push-host-install.ts`, and their tests.
- [ ] Remove `PushHostProvider`; enable relay/pair providers and push preference synchronization only for iOS.
- [ ] Simplify `sendPushTest` to call optional native `testPush` and update tests for success, unavailable, and propagated failure.

## Task 9: Make Settings UI iOS-Only

**Files:** settings component/data/tests, legacy and V2 settings dialogs, `i18n/en.ts`.

- [ ] Add `mobilePushSettingsVisible(platform)` and production `MobilePushSettingsGate` that only renders remote-push settings on iOS.
- [ ] Remove direct/host branches, Android host views/actions, host diagnostics helpers, and direct-host-only translations.
- [ ] Retain iOS permission, native test, pairing, relay, diagnostics, and Android voice settings where applicable.
- [ ] Add pure policy and rendered Android-hidden/iOS-visible tests; update existing settings tests accordingly.

## Task 10: Verify Scope And Behavior

- [ ] Run Android package tests/typecheck/build, Rust check, Gradle bridge tests if retained, and `:app:assembleDebug` with Android Studio JDK.
- [ ] Run focused and full app unit tests plus app typecheck.
- [ ] Run iOS typecheck/build, push tests/typecheck, and push-relay tests/typecheck.
- [ ] Run residue searches proving Android has no Firebase/FCM/remote-push commands or host layer, while local notification and iOS push symbols remain.
- [ ] Run `gitnexus_detect_changes` with `scope: compare`, `base_ref: dev`; inspect status/diff and stage only intended files.

## Task 11: Commit Atomic Changes

- [ ] Commit native Android removal only after native checks pass: `refactor(android): remove native FCM push integration`.
- [ ] Commit Android frontend/shared app removal only after app checks pass: `refactor(app): remove Android direct push host`.
- [ ] Do not commit generated permission reference/schema/TOMLs or unrelated `node_modules` changes unless explicitly reconciled and intentionally required.

## Verification Commands

Use the required Bun/Rust PATH prefix and `rtk` for every shell command. Tests must run from package directories, not the repository root.

```bash
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/android test
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/android typecheck
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk cargo check --manifest-path packages/android/src-tauri/Cargo.toml
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" rtk ./gradlew :app:assembleDebug
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/app test:unit
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/app typecheck
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/ios typecheck
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/push test
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk bun run --cwd packages/push-relay test
```

## Self-Review

- Android local notifications, voice, network scanning, cancellation, sharing, WebView/theme/SSL, and generic listeners remain explicitly covered.
- iOS push relay/pairing and backend packages remain out of scope and have preservation checks.
- No public Protocol/Server API, `packages/opencode`, generated SDK, or unrelated dirty artifact is included.
- No placeholder requirements remain; any generated permission changes are regenerated and reviewed rather than hand-edited.
