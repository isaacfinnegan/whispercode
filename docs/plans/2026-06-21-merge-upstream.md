# Upstream Merge and Rebase (June 21, 2026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the 37 new commits from `upstream/dev` into the local `dev` branch, rebasing our 50 custom commits on top of the new upstream history, verifying that typechecks and tests pass, compiling a debug Android APK, and transferring it to the phone.

**Architecture:** Create an integration branch `merge-upstream-v2` reset to `dev`, initiate `git rebase upstream/dev`, resolve the expected `bun.lock` conflict by keeping the current target version and running `bun install` to automatically regenerate dependencies, run the workspace-wide typechecks and unit tests, and compile and transfer a debug Android build.

**Tech Stack:** Git, Bun, Tauri, SolidJS, Playwright, Tailscale

---

### Task 1: Initialize Integration Branch and Start Rebase

**Files:**

- Modify: Git repository state (HEAD)

- [ ] **Step 1: Check out and reset the integration branch**

Create and check out a temporary integration branch `merge-upstream-v2` reset to the latest `dev` tip (commit `5773d90007`).
Run:

```bash
rtk git checkout dev && rtk git checkout -b merge-upstream-v2
```

Expected: Switched to a new branch 'merge-upstream-v2'.

- [ ] **Step 2: Initiate rebase onto upstream/dev**

Run:

```bash
rtk git rebase upstream/dev
```

Expected: Rebase begins and pauses at the `bun.lock` conflict.

---

### Task 2: Resolve Rebase Conflicts and Complete Rebase

**Files:**

- Modify: `bun.lock`

- [ ] **Step 1: Resolve the bun.lock conflict**

Check out the upstream version of `bun.lock` to resolve the conflict, and then run `bun install` with the correct PATH to regenerate the lockfile with both upstream and local changes.
Run:

```bash
rtk git checkout --theirs bun.lock
PATH="/Users/isaac/.bun/bin:$PATH" bun install
rtk git add bun.lock
```

Expected: `bun.lock` is successfully regenerated, staged, and ready for commit.

- [ ] **Step 2: Continue and complete the rebase**

Run:

```bash
rtk git rebase --continue
```

Expected: Rebase completes successfully, and HEAD is at the newly rebased branch tip.

---

### Task 3: Run Typechecks and Unit Tests

**Files:**

- Modify: None

- [ ] **Step 1: Run typechecks across all packages**

Verify that all TypeScript code compiles without errors.
Run:

```bash
PATH="/Users/isaac/.bun/bin:$PATH" bun run typecheck
```

Expected: All 33 packages successfully pass typecheck.

- [ ] **Step 2: Run packages/app unit tests**

Run:

```bash
PATH="/Users/isaac/.bun/bin:$PATH" bun run --cwd packages/app test:unit
```

Expected: All 485 unit tests pass.

- [ ] **Step 3: Run packages/opencode unit tests**

Run:

```bash
PATH="/Users/isaac/.bun/bin:$PATH" bun run --cwd packages/opencode test
```

Expected: Opencode core tests pass.

---

### Task 4: Compile Debug Android APK and Transfer via Tailscale

**Files:**

- Create: `app-universal-debug.apk`

- [ ] **Step 1: Build the debug Android application**

Run Tauri Android compilation inside the `packages/android` folder with local JDK and Android SDK toolchains.
Run:

```bash
cd packages/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/30.0.14904198"
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:/opt/homebrew/bin:$PATH" bun run tauri android build --apk --target aarch64 --debug
```

Expected: Compilation succeeds, creating `app-universal-debug.apk`.

- [ ] **Step 2: Copy APK to root and push to device via Tailscale**

Copy the built APK to the workspace root and transfer it to the target device.
Run from workspace root:

```bash
rtk cp packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk ./app-universal-debug.apk
rtk tailscale file cp app-universal-debug.apk pixel-10-pro-fold:
```

Expected: APK successfully transferred to `pixel-10-pro-fold`.

---

### Task 5: Finalize Merge on dev Branch

**Files:**

- Modify: Git repository state (dev branch HEAD)

- [ ] **Step 1: Check out dev branch**

Run:

```bash
rtk git checkout dev
```

Expected: Switched to branch 'dev'.

- [ ] **Step 2: Fast-forward dev to merge-upstream-v2**

Run:

```bash
rtk git merge merge-upstream-v2
```

Expected: Branch `dev` is fast-forwarded to the rebased commits.

- [ ] **Step 3: Force-push dev to origin dev**

Update the GitHub mirror repository with the new history.
Run:

```bash
PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" rtk git push origin dev --force
```

Expected: Push succeeds and updates the mirror branch.

- [ ] **Step 4: Clean up integration branch**

Run:

```bash
rtk git branch -d merge-upstream-v2
```

Expected: Branch `merge-upstream-v2` deleted.
