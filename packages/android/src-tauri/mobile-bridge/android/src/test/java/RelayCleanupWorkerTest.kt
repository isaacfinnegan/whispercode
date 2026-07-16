package ai.opencode.mobilebridge

import android.content.Context
import android.content.SharedPreferences
import java.lang.reflect.Proxy
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        var cleanupID: String? = null

        assertTrue(RelayCleanupScheduling(prefs) { id ->
            cleanupID = id
            assertEquals("https://old-relay.example", prefs.getRelayUrl())
            assertEquals("channel", prefs.getChannelId())
            assertEquals("device", prefs.getDeviceId())
            assertEquals("secret", prefs.getDeviceSecret())
        }.schedule())
        prefs.saveRelayUrl("https://new-relay.example")

        assertNotNull(cleanupID)
        assertNull(prefs.getChannelId())
        assertEquals(
            RelayCleanupSnapshot(
                cleanupID!!,
                "https://old-relay.example",
                PushCredentials("channel", "device", "secret"),
            ),
            prefs.getPendingRelayCleanup(cleanupID!!),
        )
    }

    @Test
    fun `changing relay before pairing skips cleanup and resets active push state`() {
        val prefs = prefs()
        prefs.saveRelayUrl("https://old-relay.example")
        prefs.saveFcmToken("fcm-token")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")
        var enqueued = false

        assertTrue(RelayCleanupScheduling(prefs) { enqueued = true }.schedule())
        val result = prefs.saveRelayUrl("https://new-relay.example")

        assertFalse(enqueued)
        assertFalse(store.all.keys.any { it.matches(Regex("push\\.cleanup\\.[^.]+\\.relay_url")) })
        assertEquals(RelayUrlResult.Valid("https://new-relay.example"), result)
        assertEquals("https://new-relay.example", prefs.getRelayUrl())
        assertNull(prefs.getChannelId())
        assertNull(prefs.getPairId())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
    }

    @Test
    fun `two relay changes retain independent cleanups when the first worker completes`() {
        val prefs = prefs()
        prefs.saveRelayUrl("https://first-relay.example")
        prefs.saveCredentials("first-channel", "first-device", "first-secret")
        var firstID: String? = null
        assertTrue(RelayCleanupScheduling(prefs) { firstID = it }.schedule())
        prefs.saveRelayUrl("https://second-relay.example")
        prefs.saveCredentials("second-channel", "second-device", "second-secret")
        var secondID: String? = null
        assertTrue(RelayCleanupScheduling(prefs) { secondID = it }.schedule())

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> = RelayResult.Ok(Unit)
        }).cleanup(firstID!!)

        assertEquals(RelayCleanupResult.SUCCESS, result)
        assertNull(prefs.getPendingRelayCleanup(firstID!!))
        assertEquals(
            RelayCleanupSnapshot(
                secondID!!,
                "https://second-relay.example",
                PushCredentials("second-channel", "second-device", "second-secret"),
            ),
            prefs.getPendingRelayCleanup(secondID!!),
        )
    }

    @Test
    fun `temporary deletion failures retain their cleanup for retry`() {
        val prefs = prefs()
        val pending = prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))!!

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> =
                RelayResult.Err(RelayError(500, "http_error", null))
        }).cleanup(pending.id)

        assertEquals(RelayCleanupResult.RETRY, result)
        assertNotNull(prefs.getPendingRelayCleanup(pending.id))
        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
    }

    @Test
    fun `request timeout retains pending cleanup for retry`() {
        val prefs = prefs()
        val pending = prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))!!

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> =
                RelayResult.Err(RelayError(408, "http_error", null))
        }).cleanup(pending.id)

        assertEquals(RelayCleanupResult.RETRY, result)
        assertNotNull(prefs.getPendingRelayCleanup(pending.id))
    }

    @Test
    fun `client deletion failures clear pending cleanup without retry`() {
        listOf(400, 429).forEach { status ->
            val prefs = prefs()
            val pending = prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))!!

            val result = RelayCleanup(prefs, object : RelayCleanupRelay {
                override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> =
                    RelayResult.Err(RelayError(status, "http_error", null))
            }).cleanup(pending.id)

            assertEquals("status $status", RelayCleanupResult.SUCCESS, result)
            assertNull("status $status", prefs.getPendingRelayCleanup(pending.id))
        }
    }

    @Test
    fun `successful deletion clears pending cleanup`() {
        val prefs = prefs()
        val pending = prefs.savePendingRelayCleanup("https://old-relay.example", PushCredentials("channel", "device", "secret"))!!

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> = RelayResult.Ok(Unit)
        }).cleanup(pending.id)

        assertEquals(RelayCleanupResult.SUCCESS, result)
        assertNull(prefs.getPendingRelayCleanup(pending.id))
    }

    @Test
    fun `legacy cleanup is migrated to an ID entry and cleared by cleanup`() {
        store.edit()
            .putString("push.cleanup.relay_url", "https://old-relay.example")
            .putString("push.cleanup.channel", "channel")
            .putString("push.cleanup.device", "device")
            .putString("push.cleanup.secret", "secret")
            .commit()

        val prefs = prefs()
        val relayKey = store.all.keys.first { it.matches(Regex("push\\.cleanup\\.[^.]+\\.relay_url")) }
        val cleanupID = relayKey.removePrefix("push.cleanup.").removeSuffix(".relay_url")

        UUID.fromString(cleanupID)
        assertFalse(store.contains("push.cleanup.relay_url"))
        assertFalse(store.contains("push.cleanup.channel"))
        assertFalse(store.contains("push.cleanup.device"))
        assertFalse(store.contains("push.cleanup.secret"))
        assertEquals(
            RelayCleanupSnapshot(
                cleanupID,
                "https://old-relay.example",
                PushCredentials("channel", "device", "secret"),
            ),
            prefs.getPendingRelayCleanup(cleanupID),
        )

        val result = RelayCleanup(prefs, object : RelayCleanupRelay {
            override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> = RelayResult.Ok(Unit)
        }).cleanup(cleanupID)

        assertEquals(RelayCleanupResult.SUCCESS, result)
        assertNull(prefs.getPendingRelayCleanup(cleanupID))
    }

    @Test
    fun `failed cleanup persistence neither enqueues nor resets active relay credentials`() {
        val active = prefs()
        active.saveRelayUrl("https://old-relay.example")
        active.saveCredentials("channel", "device", "secret")
        val failing = SecurePreferencesManager.fromPreferences(context, failingCommitPreferences(store))
        var enqueued = false

        val scheduled = RelayCleanupScheduling(failing) { enqueued = true }.schedule()

        assertFalse(scheduled)
        assertFalse(enqueued)
        assertEquals("https://old-relay.example", active.getRelayUrl())
        assertEquals("channel", active.getChannelId())
        assertEquals("device", active.getDeviceId())
        assertEquals("secret", active.getDeviceSecret())
    }

    private fun failingCommitPreferences(delegate: SharedPreferences): SharedPreferences {
        val editor = Proxy.newProxyInstance(
            javaClass.classLoader,
            arrayOf(SharedPreferences.Editor::class.java),
        ) { proxy, method, _ ->
            when (method.name) {
                "commit" -> false
                "apply" -> null
                else -> proxy
            }
        } as SharedPreferences.Editor
        return Proxy.newProxyInstance(
            javaClass.classLoader,
            arrayOf(SharedPreferences::class.java),
        ) { _, method, args ->
            if (method.name == "edit") editor else method.invoke(delegate, *(args ?: emptyArray()))
        } as SharedPreferences
    }
}
