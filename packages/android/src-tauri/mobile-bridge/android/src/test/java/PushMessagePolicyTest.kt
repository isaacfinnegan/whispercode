package ai.opencode.mobilebridge

import org.junit.Assert.assertEquals
import org.junit.Test

class PushMessagePolicyTest {
    @Test
    fun `missing local channel ignores the message`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, "device", "secret", message(), foreground = true))
    }

    @Test
    fun `channel mismatch ignores the message`() {
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", message(channel = "other"), foreground = true))
    }

    @Test
    fun `matching foreground message emits`() {
        assertEquals(MessageDecision.EMIT, decideMessage("channel", "device", "secret", message(), foreground = true))
    }

    @Test
    fun `matching background message notifies`() {
        assertEquals(MessageDecision.NOTIFY, decideMessage("channel", "device", "secret", message(), foreground = false))
    }

    @Test
    fun `unsupported version and oversized optional values ignore the message`() {
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", message(version = "2"), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", message(title = "x".repeat(101)), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", message(body = "x".repeat(501)), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", message(href = "x".repeat(2049)), foreground = true))
    }

    private fun message(
        channel: String = "channel",
        version: String = "1",
        title: String? = null,
        body: String? = null,
        href: String? = null,
    ): Map<String, String> = buildMap {
        put("channel_id", channel)
        put("v", version)
        title?.let { put("title", it) }
        body?.let { put("body", it) }
        href?.let { put("href", it) }
    }
}
