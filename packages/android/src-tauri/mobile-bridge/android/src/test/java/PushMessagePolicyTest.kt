package ai.opencode.mobilebridge

import org.junit.Assert.assertEquals
import org.junit.Test

class PushMessagePolicyTest {

    // --- Relay-mode tests ---

    @Test
    fun `relay missing local channel ignores the message`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, "device", "secret", null, relayMessage(), foreground = true))
    }

    @Test
    fun `relay channel mismatch ignores the message`() {
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", null, relayMessage(channel = "other"), foreground = true))
    }

    @Test
    fun `relay matching foreground message emits`() {
        assertEquals(MessageDecision.EMIT, decideMessage("channel", "device", "secret", null, relayMessage(), foreground = true))
    }

    @Test
    fun `relay matching background message notifies`() {
        assertEquals(MessageDecision.NOTIFY, decideMessage("channel", "device", "secret", null, relayMessage(), foreground = false))
    }

    @Test
    fun `relay unsupported version and oversized values ignore`() {
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", null, relayMessage(version = "2"), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", null, relayMessage(title = "x".repeat(101)), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", null, relayMessage(body = "x".repeat(501)), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage("channel", "device", "secret", null, relayMessage(href = "x".repeat(2049)), foreground = true))
    }

    // --- Direct-mode tests ---

    @Test
    fun `direct matching foreground message emits`() {
        assertEquals(MessageDecision.EMIT, decideMessage(null, null, null, "direct-id", directMessage("direct-id"), foreground = true))
    }

    @Test
    fun `direct matching background message notifies`() {
        assertEquals(MessageDecision.NOTIFY, decideMessage(null, null, null, "direct-id", directMessage("direct-id"), foreground = false))
    }

    @Test
    fun `direct device id mismatch ignores`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, "direct-id", directMessage("wrong-id"), foreground = true))
    }

    @Test
    fun `direct missing local device id ignores`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, null, directMessage("direct-id"), foreground = true))
    }

    @Test
    fun `direct blank local device id ignores`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, "", directMessage("direct-id"), foreground = true))
    }

    @Test
    fun `direct oversized values ignore`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, "d", directMessage("d", title = "x".repeat(101)), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, "d", directMessage("d", body = "x".repeat(501)), foreground = true))
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, "d", directMessage("d", href = "x".repeat(2049)), foreground = true))
    }

    // --- Cross-mode tests ---

    @Test
    fun `relay payload without direct device id uses relay path`() {
        assertEquals(MessageDecision.EMIT, decideMessage("channel", "device", "secret", null, relayMessage(), foreground = true))
    }

    @Test
    fun `direct payload without relay credentials uses direct path`() {
        assertEquals(MessageDecision.EMIT, decideMessage(null, null, null, "direct-id", directMessage("direct-id"), foreground = true))
    }

    @Test
    fun `message matching neither relay nor direct is ignored`() {
        assertEquals(MessageDecision.IGNORE, decideMessage(null, null, null, null, mapOf("title" to "hi"), foreground = true))
    }

    @Test
    fun `both relay and direct match prefers relay`() {
        // When both paths match, the message is accepted (relay wins but both are valid)
        val data = buildMap {
            put("channel_id", "channel")
            put("v", "1")
            put("device_id", "direct-id")
            put("title", "hello")
        }
        assertEquals(MessageDecision.EMIT, decideMessage("channel", "device", "secret", "direct-id", data, foreground = true))
    }

    // --- Helpers ---

    private fun relayMessage(
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

    private fun directMessage(
        deviceId: String,
        title: String? = null,
        body: String? = null,
        href: String? = null,
        kind: String? = null,
        deliveryId: String? = null,
    ): Map<String, String> = buildMap {
        put("device_id", deviceId)
        title?.let { put("title", it) }
        body?.let { put("body", it) }
        href?.let { put("href", it) }
        kind?.let { put("kind", it) }
        deliveryId?.let { put("delivery_id", it) }
    }
}
