// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 so shared UI code can trigger the
// fork's native test-push bridge without depending directly on mobile wrapper implementations.

import type { Platform } from "@/context/platform"
import type { ServerConnection } from "@/context/server"

export async function sendPushTest(input: {
  mode: "host" | "legacy"
  platform: Pick<Platform, "platform" | "fetch" | "testPush">
  href?: string
  selected?: ServerConnection.Key
  host?: { test(server: ServerConnection.Key): Promise<void> }
}) {
  if (input.mode === "host") {
    if (!input.selected || !input.host) throw new Error("Backend push delivery is not configured")
    return input.host.test(input.selected).then(
      () => true,
      () => {
        throw new Error("Backend push delivery is not configured")
      },
    )
  }
  if (!input.platform.testPush) return false
  return input.platform.testPush(input.href)
}
