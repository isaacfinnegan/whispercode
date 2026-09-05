// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { access, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const path = (value: string) => `${root}/${value}`
const text = (value: string) => readFile(path(value), "utf8")
const exists = async (value: string) => access(path(value)).then(() => true, () => false)

test("Android retains local notifications and unrelated mobile integrations", async () => {
  const [entry, pkg, cargo, app, capability, manifest] = await Promise.all([
    text("src/entry-android.tsx"),
    text("package.json"),
    text("src-tauri/Cargo.toml"),
    text("src-tauri/src/lib.rs"),
    text("src-tauri/capabilities/default.json"),
    text("src-tauri/gen/android/app/src/main/AndroidManifest.xml"),
  ])

  expect(pkg).toContain('"@tauri-apps/plugin-notification": "~2"')
  expect(cargo).toContain('tauri-plugin-notification = "2"')
  expect(app).toContain(".plugin(tauri_plugin_notification::init())")
  expect(capability).toContain('"notification:default"')
  expect(entry).toContain("@tauri-apps/plugin-notification")
  expect(entry).toContain("sendNotification({")
  expect(manifest).toContain("android.permission.POST_NOTIFICATIONS")
})

test("Android contains no remote push implementation", async () => {
  const deleted = [
    "src/push-native.ts",
    "src/push-native.test.ts",
    "src-tauri/gen/android/app/google-services.json",
    "src-tauri/mobile-bridge/android/src/main/java/AppLifecycleTracker.kt",
    "src-tauri/mobile-bridge/android/src/main/java/NetworkStateListener.kt",
    "src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt",
    "src-tauri/mobile-bridge/android/src/main/java/PushRelayClient.kt",
    "src-tauri/mobile-bridge/android/src/main/java/RelayCleanupWorkScheduler.kt",
    "src-tauri/mobile-bridge/android/src/main/java/RelayCleanupWorker.kt",
    "src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt",
    "src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt",
    "src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt",
  ]

  for (const file of deleted) expect(await exists(file), file).toBe(false)
})
