# Fix Android Cleartext HTTP Connection Regression

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Android release build so it can connect to cleartext HTTP servers (e.g. `http://100.108.131.1:8448`) by enabling `usesCleartextTraffic` in the default config, unignoring the customized `build.gradle.kts`, and adding a fallback for the HTTP fetch path.

**Architecture:** The root cause is that `build.gradle.kts` sets `usesCleartextTraffic = "false"` in `defaultConfig`, and the `release` build type never overrides it (only `debug` sets `"true"`). This blocks all cleartext HTTP at the Android manifest level in release builds, causing both `tauriFetch` and WebView `fetch` to fail. Additionally, the file lives inside `packages/android/src-tauri/gen/` which is gitignored, so the fix from a prior branch (`5b2e927102`) was never carried to the current branch. A secondary issue is that the `http:` fetch path in `entry-android.tsx` has no `try/catch` fallback (unlike the `https:` path), so any failure is unrecoverable.

**Tech Stack:** Gradle (Kotlin DSL), TypeScript/SolidJS (Tauri Android app), `.gitignore`

---

### Task 1: Enable cleartext traffic in `build.gradle.kts` for all build types

**Files:**
- Modify: `packages/android/src-tauri/gen/android/app/build.gradle.kts:27`

- [ ] **Step 1: Change `defaultConfig` to allow cleartext traffic**

In `packages/android/src-tauri/gen/android/app/build.gradle.kts`, change line 27 from:

```kotlin
manifestPlaceholders["usesCleartextTraffic"] = "false"
```

to:

```kotlin
manifestPlaceholders["usesCleartextTraffic"] = "true"
```

This ensures both debug and release builds allow cleartext HTTP connections. The `debug` block override on line 44 (`= "true"`) becomes redundant but harmless — leave it in place to keep the diff minimal.

- [ ] **Step 2: Verify the file is correct**

Run:
```bash
grep -n 'usesCleartextTraffic' packages/android/src-tauri/gen/android/app/build.gradle.kts
```

Expected output:
```
27:        manifestPlaceholders["usesCleartextTraffic"] = "true"
44:            manifestPlaceholders["usesCleartextTraffic"] = "true"
```

Both lines should now be `"true"`.

---

### Task 2: Unignore the customized `build.gradle.kts` so it is tracked by git

**Files:**
- Modify: `.gitignore:36`

- [ ] **Step 1: Add a negation rule after the `gen/` ignore**

In `.gitignore`, after line 36 (`packages/android/src-tauri/gen/`), add a negation rule to force-track the specific `build.gradle.kts` file. The result should look like:

```gitignore
packages/android/src-tauri/gen/
!packages/android/src-tauri/gen/android/
!packages/android/src-tauri/gen/android/app/
!packages/android/src-tauri/gen/android/app/build.gradle.kts
```

Git negation rules require each parent directory in an ignored tree to be individually negated. This is because git stops scanning a directory once the parent is ignored — the three `!` lines re-include the path down to the specific file.

- [ ] **Step 2: Verify git now sees the file**

Run:
```bash
git status packages/android/src-tauri/gen/android/app/build.gradle.kts
```

Expected: The file should appear as an untracked (new) file, not be silently ignored. If it still shows nothing, run `git check-ignore -v packages/android/src-tauri/gen/android/app/build.gradle.kts` to debug.

- [ ] **Step 3: Stage and verify only the intended file is picked up**

Run:
```bash
git add packages/android/src-tauri/gen/android/app/build.gradle.kts
git status
```

Expected: Only `build.gradle.kts` from the `gen/` tree is staged. No other generated files should appear.

---

### Task 3: Add `try/catch` fallback for HTTP fetch in `entry-android.tsx`

**Files:**
- Modify: `packages/android/src/entry-android.tsx:302-306`

- [ ] **Step 1: Wrap the `http:` branch in a try/catch with WebView fallback**

In `packages/android/src/entry-android.tsx`, the `http:` protocol branch (lines 304-306) currently reads:

```typescript
if (parsedUrl.protocol === "http:") {
  return await tauriFetch(makeRequest())
}
```

Change it to match the defensive pattern used by the `https:` branch:

```typescript
if (parsedUrl.protocol === "http:") {
  try {
    return await tauriFetch(makeRequest())
  } catch (e) {
    console.warn("[entry-android] HTTP tauriFetch failed, falling back to WebView fetch:", e)
    return await globalThis.fetch(makeRequest())
  }
}
```

This ensures that if `tauriFetch` fails for an HTTP request (e.g. due to a network policy restriction, timeout, or Rust-layer error), the app gracefully falls back to the WebView's native `fetch` instead of propagating an unhandled rejection.

- [ ] **Step 2: Verify the file typechecks**

Run:
```bash
cd packages/android && bun typecheck
```

Expected: Clean exit with no errors.

---

### Task 4: Commit all changes

- [ ] **Step 1: Review the diff**

Run:
```bash
git diff
git diff --cached
```

Verify exactly three changes:
1. `.gitignore` — negation rules for `build.gradle.kts`
2. `packages/android/src-tauri/gen/android/app/build.gradle.kts` — `usesCleartextTraffic` changed to `"true"` in `defaultConfig`
3. `packages/android/src/entry-android.tsx` — `http:` branch wrapped in `try/catch`

- [ ] **Step 2: Stage and commit**

```bash
git add .gitignore packages/android/src/entry-android.tsx packages/android/src-tauri/gen/android/app/build.gradle.kts
git commit -m "fix(android): enable cleartext HTTP in release builds and add fetch fallback

- Set usesCleartextTraffic=true in defaultConfig so release builds can
  connect to cleartext HTTP servers (e.g. Tailscale IPs)
- Unignore build.gradle.kts so the fix is tracked in git
- Add try/catch fallback on the http: fetch path matching the existing
  https: fallback pattern"
```

---

### Task 5: Build and verify (manual step)

- [ ] **Step 1: Build the release APK**

```bash
export PATH="/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd packages/android
python3 generate-icons.py
bun run tauri android build --apk --target aarch64
```

- [ ] **Step 2: Install on device and test**

Uninstall the existing app first (signature will differ from previous builds), then install the new APK. Verify the app can connect to `http://100.108.131.1:8448` — the health check dot should turn green during onboarding and the `ConnectionGate` should pass through to the main UI without getting stuck.
