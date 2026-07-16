package ai.opencode.mobilebridge

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class RelayCleanupWorkerTest {
    private lateinit var context: Context
    private lateinit var store: android.content.SharedPreferences

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        store = context.getSharedPreferences("whisper_secure_prefs", Context.MODE_PRIVATE)
        store.edit().clear().commit()
    }

    private fun prefs() = SecurePreferencesManager.fromPreferences(context, store)

    @Test
    fun `scheduling cleanup snapshots the old normalized relay and credentials before reset`() {
        val prefs = prefs()
        prefs.saveRelayUrl("https://old-relay.example/")
        prefs.saveCredentials("channel", "device", "secret")
        var enqueued = false

        RelayCleanupScheduling(prefs) {
            enqueued = true
            assertEquals("https://old-relay.example", prefs.getRelayUrl())
            assertEquals("channel", prefs.getChannelId())
            assertEquals("device", prefs.getDeviceId())
            assertEquals("secret", prefs.getDeviceSecret())
        }.schedule()
        prefs.saveRelayUrl("https://new-relay.example")

        assertTrue(enqueued)
        assertNull(prefs.getChannelId())
        assertEquals(
            RelayCleanupSnapshot(
                "https://old-relay.example",
                PushCredentials("channel", "device", "secret"),
            ),
            prefs.getPendingRelayCleanup(),
        )
    }

    @Test
    fun `temporary deletion failure retains pending cleanup for retry`() {
        val prefs = prefs()
        prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> =
                RelayResult.Err(RelayError(500, "http_error", null))
        }).cleanup()

        assertEquals(RelayCleanupResult.RETRY, result)
        assertNotNull(prefs.getPendingRelayCleanup())
        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
    }

    @Test
    fun `client deletion failures clear pending cleanup without retry`() {
        listOf(400, 429).forEach { status ->
            val prefs = prefs()
            prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))

            val result = RelayCleanup(prefs, object : RelayCleanupRelay {
                override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> =
                    RelayResult.Err(RelayError(status, "http_error", null))
            }).cleanup()

            assertEquals("status $status", RelayCleanupResult.SUCCESS, result)
            assertNull("status $status", prefs.getPendingRelayCleanup())
        }
    }

    @Test
    fun `successful deletion clears pending cleanup`() {
        val prefs = prefs()
        prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> = RelayResult.Ok(Unit)
        }).cleanup()

        assertEquals(RelayCleanupResult.SUCCESS, result)
        assertNull(prefs.getPendingRelayCleanup())
    }
}
