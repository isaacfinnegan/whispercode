# Android Cleartext HTTP & Healthcheck Fallback Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Android app in release builds to connect to local cleartext HTTP servers (e.g. `http://100.108.131.1:8448`) and gracefully fallback to WebView's global fetch if native tauriFetch fails.

**Architecture:** Update the Android build configuration (`build.gradle.kts`) to allow cleartext traffic in release builds, unignore the Gradle file in `.gitignore` so git tracks it, and update the platform-specific fetch override in `entry-android.tsx` to handle HTTP request failures with a WebView fallback matching the HTTPS implementation.

**Tech Stack:** TypeScript, Kotlin DSL (Gradle), Tauri, Android.

---

### Task 1: Update Root `.gitignore` to Track `build.gradle.kts`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Verify `build.gradle.kts` is currently ignored**

Run: `git check-ignore -v packages/android/src-tauri/gen/android/app/build.gradle.kts`
Expected: Output showing it is ignored by `.gitignore:36:packages/android/src-tauri/gen/`

- [ ] **Step 2: Modify `.gitignore` to unignore the specific file**

Modify `.gitignore` at line 36. Replace:
```gitignore
packages/android/src-tauri/gen/
```
with:
```gitignore
packages/android/src-tauri/gen/*
!packages/android/src-tauri/gen/android/
packages/android/src-tauri/gen/android/*
!packages/android/src-tauri/gen/android/app/
packages/android/src-tauri/gen/android/app/*
!packages/android/src-tauri/gen/android/app/build.gradle.kts
```

- [ ] **Step 3: Run check-ignore command to verify it is no longer ignored**

Run: `git check-ignore -v packages/android/src-tauri/gen/android/app/build.gradle.kts`
Expected: Empty/no output (exit code 1) meaning the file is no longer ignored.

- [ ] **Step 4: Commit**

Run:
```bash
git add .gitignore
git commit -m "chore(android): update gitignore to track build.gradle.kts"
```

---

### Task 2: Configure `usesCleartextTraffic` in `build.gradle.kts`

**Files:**
- Modify: `packages/android/src-tauri/gen/android/app/build.gradle.kts`

- [ ] **Step 1: Check existing `usesCleartextTraffic` settings**

Inspect `packages/android/src-tauri/gen/android/app/build.gradle.kts` lines 27 and 44:
- Line 27: `manifestPlaceholders["usesCleartextTraffic"] = "false"`
- Line 44: `manifestPlaceholders["usesCleartextTraffic"] = "true"`

- [ ] **Step 2: Update `defaultConfig` to allow cleartext traffic in release builds**

Modify `packages/android/src-tauri/gen/android/app/build.gradle.kts` at line 27. Replace:
```kotlin
        manifestPlaceholders["usesCleartextTraffic"] = "false"
```
with:
```kotlin
        manifestPlaceholders["usesCleartextTraffic"] = "true"
```

- [ ] **Step 3: Verify the changes are correctly applied**

Run: `git diff packages/android/src-tauri/gen/android/app/build.gradle.kts`
Expected: Diff shows `usesCleartextTraffic` is changed from `"false"` to `"true"`.

- [ ] **Step 4: Commit**

Run:
```bash
git add packages/android/src-tauri/gen/android/app/build.gradle.kts
git commit -m "fix(android): enable usesCleartextTraffic for release builds"
```

---

### Task 3: Wrap `http:` Fetch Case with `try/catch` Fallback in `entry-android.tsx`

**Files:**
- Modify: `packages/android/src/entry-android.tsx`

- [ ] **Step 1: Check the current implementation**

Verify `packages/android/src/entry-android.tsx` lines 302-317:
```typescript
      try {
        const parsedUrl = new URL(urlStr)
        if (parsedUrl.protocol === "http:") {
          return await tauriFetch(makeRequest())
        }
        if (parsedUrl.protocol === "https:") {
          try {
            return await tauriFetch(makeRequest())
          } catch (e) {
            console.warn("[entry-android] HTTPS tauriFetch failed, falling back to WebView fetch:", e)
            return await globalThis.fetch(makeRequest())
          }
        }
      } catch (e) {
        console.error("[entry-android] fetch routing error:", e)
      }
```

- [ ] **Step 2: Add try/catch fallback to the `http:` branch**

Modify `packages/android/src/entry-android.tsx` at lines 304-306. Replace:
```typescript
        if (parsedUrl.protocol === "http:") {
          return await tauriFetch(makeRequest())
        }
```
with:
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

- [ ] **Step 3: Verify type checking**

Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run typecheck` inside `packages/android`
Expected: Compiles with no TS errors.

- [ ] **Step 4: Verify build bundling**

Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run build` inside `packages/android`
Expected: Vite build succeeds.

- [ ] **Step 5: Commit**

Run:
```bash
git add packages/android/src/entry-android.tsx
git commit -m "fix(android): wrap http fetch in try/catch with webview fallback"
```
