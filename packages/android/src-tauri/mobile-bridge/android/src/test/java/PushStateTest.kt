package ai.opencode.mobilebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PushStateTest {
    @Test
    fun `push registration has the exact private payload shape`() {
        val registration = pushRegistrationJson(
            PushRegistrationSnapshot(
                device = "stable-device",
                token = "secret-fcm-token",
                tokenGeneration = 2,
            ),
        )

        assertEquals(
            setOf("version", "device", "provider", "token", "token_generation", "prefs"),
            registration.keys().asSequence().toSet(),
        )
        assertEquals(1, registration.getInt("version"))
        assertEquals("stable-device", registration.getString("device"))
        assertEquals("fcm", registration.getString("provider"))
        assertEquals("secret-fcm-token", registration.getString("token"))
        assertEquals(2L, registration.getLong("token_generation"))

        val prefs = registration.getJSONObject("prefs")
        assertEquals(setOf("complete", "approval", "question", "error"), prefs.keys().asSequence().toSet())
        assertTrue(prefs.getBoolean("complete"))
        assertTrue(prefs.getBoolean("approval"))
        assertTrue(prefs.getBoolean("question"))
        assertTrue(prefs.getBoolean("error"))
    }

    @Test
    fun `push registration uses stable permission and token errors`() {
        assertEquals("push_permission_required", pushRegistrationError(false, "secret-fcm-token"))
        assertEquals("push_registration_pending", pushRegistrationError(true, null))
        assertEquals("push_registration_pending", pushRegistrationError(true, "   "))
        assertNull(pushRegistrationError(true, "secret-fcm-token"))
    }

    @Test
    fun `late token completions are ignored after timeout or destruction`() {
        assertTrue(isCurrentPushRequest(3, 3, false))
        assertFalse(isCurrentPushRequest(3, 4, false))
        assertFalse(isCurrentPushRequest(3, 3, true))
    }

    @Test
    fun `relay state emits only when the normalized URL changes`() {
        assertTrue(relayUrlChanged("https://relay.example", "https://other.example"))
        assertFalse(relayUrlChanged("https://relay.example", "https://relay.example"))
    }

    @Test
    fun `push state includes the complete canonical diagnostic shape`() {
        val rawToken = "secret-fcm-token"
        val state = pushStateJson(
            PushStateSnapshot(
                permission = "denied",
                token = true,
                tokenPending = true,
                paired = false,
                relay = "https://relay.example",
                device = null,
                pairId = "pair_1",
                pairStatus = "claimed",
                pairExpires = null,
                lastCode = "bad_device_secret",
                lastError = null,
            ),
        )

        assertTrue(state.getBoolean("supported"))
        assertEquals("denied", state.getString("permission"))
        assertFalse(state.getBoolean("allowed"))
        assertTrue(state.getBoolean("registered"))
        assertFalse(state.getBoolean("paired"))
        assertFalse(state.getBoolean("generic"))
        assertFalse(state.has("channel"))

        val diag = state.getJSONObject("diag")
        assertTrue(diag.getBoolean("token"))
        assertTrue(diag.getBoolean("tokenPending"))
        assertEquals("https://relay.example", diag.getString("relay"))
        assertEquals("pair_1", diag.getString("pairID"))
        assertEquals("claimed", diag.getString("pairStatus"))
        assertEquals("bad_device_secret", diag.getString("lastCode"))
        assertFalse(diag.has("device"))
        assertFalse(diag.has("pairExpires"))
        assertFalse(diag.has("lastError"))
        assertFalse(state.toString().contains(rawToken))
    }

    @Test
    fun `pair info uses canonical camel case keys`() {
        val pair = pairInfoJson(
            id = "pair_1",
            status = "active",
            token = "ptok_1",
            command = "npx pair",
            expires = "2026-07-14T12:00:00.000Z",
            channel = "ch_1",
            device = "dev_1",
            message = "paired",
        )

        assertEquals("pair_1", pair.getString("id"))
        assertEquals("active", pair.getString("status"))
        assertEquals("ptok_1", pair.getString("token"))
        assertEquals("npx pair", pair.getString("command"))
        assertEquals("2026-07-14T12:00:00.000Z", pair.getString("expires"))
        assertEquals("ch_1", pair.getString("channel"))
        assertEquals("dev_1", pair.getString("device"))
        assertEquals("paired", pair.getString("message"))
        assertEquals(
            setOf("id", "status", "token", "command", "expires", "channel", "device", "message"),
            pair.keys().asSequence().toSet(),
        )
    }
}
