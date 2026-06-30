# Upstream Merge and Rebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the 50 new commits from `upstream/dev` into the local `dev` branch, rebasing our unique custom local commits (representing custom mobile support, push-relay, and platform integrations) on top of the new rewritten upstream history, verifying that typechecks and E2E tests pass, compiling a debug Android APK, and push it to the `pixel-10-pro-fold` device via Tailscale.

**Architecture:** Reset the integration branch `merge-upstream` to the tip of `dev` (which contains two new local commits), initiate `git rebase upstream/dev`, resolve conflicts commit-by-commit using our predefined guides (such as bypassing GitHub tarball API 504 timeouts via lockfile tricks, discarding obsolete scroll-reverse hacks, and accepting push notification modularization), regenerate the JS SDK, verify E2E tests pass, build the debug Android app, and fast-forward `dev` to the rebased tip.

**Tech Stack:** Git, Bun, Tauri, SolidJS, Playwright, Tailscale

---

### Task 1: Initialize Integration Branch and Start Rebase

**Files:**
- Modify: Git repository state (HEAD)

- [ ] **Step 1: Check out and reset the integration branch**

Reset `merge-upstream` to the latest `dev` tip so it includes the two recent commits `934f13aed3` and `b73d7c9946`.
Run:
```bash
rtk git checkout merge-upstream
rtk git reset --hard dev
```
Expected: Branch 'merge-upstream' reset to HEAD of dev.

- [ ] **Step 2: Initiate rebase onto upstream/dev**

Run:
```bash
rtk git rebase upstream/dev
```
Expected: Rebase begins and pauses at the first conflict (usually `prompt-input.tsx` or `platform.tsx` from the first custom commits).

---

### Task 2: Resolve Rebase Conflicts (Commits 1-75)

**Files:**
- Modify: Conflicted files in the workspace (commit-by-commit)

- [ ] **Step 1: Resolve conflicts up to "add refresh gesture to main chat window"**

Resolve conflicts in `packages/app/src/components/session/session-header.tsx`, `packages/app/src/utils/persist.ts`, `packages/app/src/context/platform.tsx`, and `packages/app/src/components/prompt-input.tsx` by retaining local mobile behaviors while accepting upstream refactorings.
For files like `packages/app/src/context/global-sync.tsx` (which is deleted in HEAD), migrate its wake/sleep online refresh effects into `packages/app/src/context/server-sync.tsx` and run `git rm packages/app/src/context/global-sync.tsx`.
For `packages/app/src/pages/session/timeline/message-timeline.tsx`, apply the mobile pull-to-refresh component and properties directly to the new file location, and run `git rm packages/app/src/pages/session/message-timeline.tsx`.
For `bun.lock` conflicts, checkout the HEAD version (`git checkout --ours bun.lock`), pin `"ghostty-web": "github:anomalyco/ghostty-web#20bd361"` in `packages/app/package.json` to avoid GitHub tarball 504 timeouts, and run `bun install` to lock dependencies.

- [ ] **Step 2: Resolve conflicts up to "Fix ios scroll issue caused from upstream"**

For `packages/app/src/pages/session.tsx`, resolve imports block and keep HEAD's `NewSessionView` setup.
For `packages/ui/src/components/scroll-view.tsx` and `packages/ui/src/hooks/create-auto-scroll.tsx`, checkout HEAD versions (`git checkout HEAD -- <paths>`) because upstream has refactored the scroll view to use standard scrolling layout on all platforms, rendering the custom scroll-reverse and glide hacks obsolete.
In `packages/app/src/pages/session.tsx`, remove `reverseScrollTop` parameter from the `createAutoScroll` options block.
For `packages/app/src/pages/session/timeline/message-timeline.tsx`, update the pull-to-refresh indicator checks to wrap top indicator in `<Show when={mobile}>` and bottom indicator in `<Show when={!mobile}>` (where `mobile = platform.platform === "ios" || platform.platform === "android"`).

- [ ] **Step 3: Resolve conflicts up to "add beam for quick testflight testing"**

For `packages/app/src/context/sync.tsx` (where `status()` method was refactored), checkout HEAD version of `sync.tsx` and define the `status()` method inside `packages/app/src/context/directory-sync.ts` in the `session` object:
```typescript
      async status() {
        const [, setStore] = serverSync.child(directory)
        return retry(() => client.session.status()).then((x) => {
          setStore("session_status", reconcile(x.data ?? {}))
        })
      },
```

- [ ] **Step 4: Resolve conflicts up to "add relay-backed mobile push notifications"**

For `packages/app/src/context/platform.tsx`, keep both the HEAD `updater?: UpdaterPlatform` property and all the new push notification methods (`pushState`, `getPushState`, `requestPushPermission`, etc.), but remove the old Tauri `checkUpdate` and `update` properties.
For `packages/app/src/app.tsx`, add `PushRelayProvider` to the global `SharedProviders` block.
For `packages/app/src/components/settings-general.tsx`, combine custom push settings fields and local updates/auto-accept settings. Use `sync().data` instead of `sync.data` since `useSync()` returns a reactive accessor signal in HEAD.
For `packages/app/src/pages/home.tsx`, combine the new multiple server settings column with push notification installation widgets. Update `pushMode` to check for both `ios` and `android` platforms.
For `packages/app/src/pages/layout.tsx`, keep the push preferences sync effects and the `openPush` routing handler, but use `route().dir` instead of decoding params directly. Support Android in `openPush` routing.
For `script/publish.ts`, append the push package publish scripts.

- [ ] **Step 5: Resolve conflicts in "add notifications"**

For `packages/desktop-electron/src/renderer/index.tsx` and `packages/desktop/src/index.tsx` (which are deleted in HEAD), run `git rm`.
For `packages/app/src/context/platform.tsx` and `packages/app/src/utils/server.ts`, keep HEAD versions and discard the obsolete inline basic auth helpers.
For `packages/app/src/app.tsx`, wrap the `SharedProviders` block in `<PushPairProvider>`.
For `packages/app/src/components/settings-general.tsx` and `packages/app/src/pages/home.tsx` (where push pairing has been refactored out into standalone files `push-pair.tsx` and `settings-mobile-notifications.tsx`), checkout the HEAD versions of both files.
For `packages/sdk/js/src/v2/gen/sdk.gen.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts`, and `packages/sdk/openapi.json`, checkout HEAD versions.
For all non-English translation files (`packages/app/src/i18n/*.ts`), checkout HEAD versions (`git checkout HEAD -- packages/app/src/i18n/<lang>.ts`) to discard conflicts.
For `packages/app/src/i18n/en.ts`, merge English translation keys.

---

### Task 3: Resolve Remaining Rebase Conflicts and Complete Rebase

**Files:**
- Modify: Conflicted files in the workspace (commits 76-166)

- [ ] **Step 1: Continue rebase and identify new conflicts**

Run:
```bash
rtk git rebase --continue
```
Resolve any conflicts in the remaining commits by keeping local Android/iOS features while adopting upstream modifications.
Ensure `bun.lock` conflicts are resolved by restoring HEAD and running `bun install`.

- [ ] **Step 2: Complete the rebase**

Run:
```bash
rtk git rebase --continue
```
Expected: Rebase completes successfully, and HEAD is at the rebased branch tip.

---

### Task 4: Run Typechecks and Regenerate the JS SDK

**Files:**
- Modify: `packages/sdk/js/src/v2/gen/sdk.gen.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts`

- [ ] **Step 1: Regenerate JavaScript SDK**

Run from workspace root:
```bash
./packages/sdk/js/script/build.ts
```
Expected: Generated SDK types and clients updated successfully.

- [ ] **Step 2: Run typechecks in packages/opencode**

Run:
```bash
cd packages/opencode && bun typecheck
```
Expected: CLI/server package passes typecheck.

- [ ] **Step 3: Run typechecks in packages/app**

Run:
```bash
cd packages/app && bun typecheck
```
Expected: App package passes typecheck.

---

### Task 5: Run E2E Tests, Compile debug Android app, and Share

**Files:**
- Create: `app-universal-debug.apk`

- [ ] **Step 1: Run Playwright E2E tests**

Run:
```bash
cd packages/app && bun run test:e2e
```
Expected: E2E tests pass.

- [ ] **Step 2: Build Android debug APK**

Build the debug APK using the local Java and Android SDK paths.
Run from workspace root:
```bash
cd packages/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/30.0.14904198"
export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:/opt/homebrew/bin:$PATH"
bun run tauri android build --apk --debug --target aarch64 --split-per-abi
```
Expected: Build finishes, producing the debug APK.

- [ ] **Step 3: Copy APK to root and push to phone via Tailscale**

Run from workspace root:
```bash
cp packages/android/src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk app-universal-debug.apk
/usr/local/bin/tailscale file cp app-universal-debug.apk "pixel-10-pro-fold:"
```
Expected: `app-universal-debug.apk` is pushed to `pixel-10-pro-fold` device successfully.

---

### Task 6: Finalize Merge on dev Branch

**Files:**
- Modify: Git repository state (dev branch HEAD)

- [ ] **Step 1: Check out dev branch**

Run:
```bash
rtk git checkout dev
```
Expected: Switched to branch 'dev'.

- [ ] **Step 2: Fast-forward dev to merge-upstream**

Run:
```bash
rtk git merge merge-upstream
```
Expected: dev branch fast-forwards to the fully rebased tip.

- [ ] **Step 3: Delete integration branch**

Run:
```bash
rtk git branch -d merge-upstream
```
Expected: Branch 'merge-upstream' deleted.
