# Migrate WhisperCode to Native Tauri HTTP Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom JavaScript `fetch` interceptor in the Android wrapper with Tauri's native HTTP plugin client (`@tauri-apps/plugin-http`), completely bypassing WebView-level CORS blocks, HSTS cache pollution, and SSL handshake validation errors at the network socket layer.

**Architecture:** Add the `tauri-plugin-http` Rust dependency and register it in the Android Tauri app library. Import the native `fetch` from `@tauri-apps/plugin-http` and expose it as `platform.fetch` in `entry-android.tsx`, removing the brittle JavaScript body-serialization and header-modification interceptor.

**Tech Stack:** SolidJS, Tauri v2 Android, Rust

---

### Task 1: Add Tauri HTTP Plugin Dependencies

**Files:**
- Modify: `packages/android/package.json`
- Modify: `packages/android/src-tauri/Cargo.toml`
- Modify: `packages/android/src-tauri/src/lib.rs`

- [ ] **Step 1: Add JS dependency in packages/android/package.json**

Add `@tauri-apps/plugin-http` to the dependencies:
```json
"@tauri-apps/plugin-http": "~2.0.0"
```

- [ ] **Step 2: Add Rust dependency in Cargo.toml**

Add `tauri-plugin-http` to the dependencies block in `packages/android/src-tauri/Cargo.toml`:
```toml
tauri-plugin-http = "2"
```

- [ ] **Step 3: Register the plugin in packages/android/src-tauri/src/lib.rs**

Add the plugin initializer inside `run()`:
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init()) // Add this line
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::init())
        .plugin(tauri_plugin_mobile_bridge::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Run bun install to sync locks**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun install`
Expected: Successful package install with zero lockfile conflicts.

- [ ] **Step 5: Commit dependencies**

```bash
git add packages/android/package.json packages/android/src-tauri/Cargo.toml packages/android/src-tauri/src/lib.rs
git commit -m "chore(android): add tauri-plugin-http dependencies"
```

---

### Task 2: Configure Native HTTP Plugin Permissions

**Files:**
- Modify: `packages/android/src-tauri/capabilities/default.json` (or the active Tauri capability config)

- [ ] **Step 1: Locate capabilities config**

Verify which capability configuration file is active. Typically it is located in `packages/android/src-tauri/capabilities/default.json`.

- [ ] **Step 2: Whitelist HTTP permissions**

Add the http network request permissions to the `permissions` array:
```json
"permissions": [
  "http:default"
]
```

- [ ] **Step 3: Commit capability configuration**

```bash
git add packages/android/src-tauri/capabilities/default.json
git commit -m "chore(android): grant http plugin default capability permissions"
```

---

### Task 3: Expose Native Fetch in Android Platform

**Files:**
- Modify: `packages/android/src/entry-android.tsx`

- [ ] **Step 1: Replace custom fetch interceptor with native plugin fetch**

Import `fetch` from the native plugin and bind it to `platform.fetch`:
```typescript
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"

// Inside the platform definition block:
const platform: Platform = {
  // ...
  getDefaultServer: getDefaultServerUrl,
  setDefaultServer: setDefaultServerUrl,
  storage: (name?: string) => createTauriStorage(name),
  fetch: tauriFetch, // Expose the native Tauri fetch client directly
}
```

- [ ] **Step 2: Clean up imports and temporary variables**

Remove any custom `readStream` helpers or JS `fetch` wrappers added in the previous steps.

- [ ] **Step 3: Verify packages/android typechecks**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run --cwd packages/android typecheck`
Expected: Success

- [ ] **Step 4: Commit platform code updates**

```bash
git add packages/android/src/entry-android.tsx
git commit -m "feat(android): route platform fetch through tauri native http plugin"
```

---

### Task 4: Recompile and Verify

**Files:**
- Output: `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

- [ ] **Step 1: Compile the new build**

Run: `export PATH="/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH" && ./packages/android/build-and-install.sh`
Expected: Finished compiling APK with 0 Gradle errors.

- [ ] **Step 2: Deploy to target device**

Verify the APK is pushed to the device via Tailscale:
`/usr/local/bin/tailscale file cp "packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk" "pixel-10-pro-fold:"`

- [ ] **Step 3: Commit build output updates if applicable**

```bash
git add packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml
git commit -m "chore(android): build android app using native http plugin"
```
