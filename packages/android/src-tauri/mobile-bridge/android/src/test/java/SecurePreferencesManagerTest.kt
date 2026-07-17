package ai.opencode.mobilebridge

import android.content.Context
import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(RobolectricTestRunner::class)
class SecurePreferencesManagerTest {
    private lateinit var context: Context
    private lateinit var store: android.content.SharedPreferences

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        store = context.getSharedPreferences("whisper_secure_prefs", Context.MODE_PRIVATE)
        store.edit().clear().commit()
    }

    private fun manager() = SecurePreferencesManager.fromPreferences(context, store)

    @Test
    fun `direct registration identity is stable and generation changes only with a new token`() {
        val prefs = manager()
        val id = prefs.getOrCreateDirectDeviceId()

        prefs.saveFcmToken("token-a")
        assertEquals(1L, prefs.getFcmTokenGeneration())

        prefs.saveFcmToken("token-a")
        assertEquals(1L, prefs.getFcmTokenGeneration())

        prefs.saveFcmToken("token-b")
        assertEquals(2L, prefs.getFcmTokenGeneration())
        assertEquals(id, manager().getOrCreateDirectDeviceId())
    }

    @Test
    fun `different manager instances serialize token generation updates`() {
        val firstEntered = CountDownLatch(1)
        val secondEntered = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val active = AtomicBoolean(false)
        val firstStore = object : SharedPreferences by store {
            override fun getString(key: String?, defaultValue: String?): String? {
                if (active.get() && key == "push.fcm_token") {
                    firstEntered.countDown()
                    assertTrue(releaseFirst.await(5, TimeUnit.SECONDS))
                }
                return store.getString(key, defaultValue)
            }
        }
        val secondStore = object : SharedPreferences by store {
            override fun getString(key: String?, defaultValue: String?): String? {
                if (active.get() && key == "push.fcm_token") secondEntered.countDown()
                return store.getString(key, defaultValue)
            }
        }
        val first = SecurePreferencesManager.fromPreferences(context, firstStore)
        val second = SecurePreferencesManager.fromPreferences(context, secondStore)
        val executor = Executors.newFixedThreadPool(2)
        active.set(true)

        try {
            val firstSave = executor.submit { first.saveFcmToken("token-a") }
            assertTrue(firstEntered.await(5, TimeUnit.SECONDS))
            val secondSave = executor.submit { second.saveFcmToken("token-b") }

            assertFalse(secondEntered.await(200, TimeUnit.MILLISECONDS))
            releaseFirst.countDown()
            firstSave.get(5, TimeUnit.SECONDS)
            secondSave.get(5, TimeUnit.SECONDS)

            val snapshot = manager().getFcmRegistrationSnapshot()
            assertEquals(2L, snapshot?.generation)
            assertTrue(snapshot?.token in setOf("token-a", "token-b"))
        } finally {
            releaseFirst.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `FCM registration snapshot is consistent while another manager saves a token`() {
        manager().saveFcmToken("token-a")
        val tokenRead = CountDownLatch(1)
        val writerEntered = CountDownLatch(1)
        val releaseRead = CountDownLatch(1)
        val active = AtomicBoolean(false)
        val readerStore = object : SharedPreferences by store {
            override fun getString(key: String?, defaultValue: String?): String? {
                val value = store.getString(key, defaultValue)
                if (active.get() && key == "push.fcm_token") {
                    tokenRead.countDown()
                    assertTrue(releaseRead.await(5, TimeUnit.SECONDS))
                }
                return value
            }
        }
        val reader = SecurePreferencesManager.fromPreferences(context, readerStore)
        val writerStore = object : SharedPreferences by store {
            override fun getString(key: String?, defaultValue: String?): String? {
                if (active.get() && key == "push.fcm_token") writerEntered.countDown()
                return store.getString(key, defaultValue)
            }
        }
        val writer = SecurePreferencesManager.fromPreferences(context, writerStore)
        val executor = Executors.newFixedThreadPool(2)
        active.set(true)

        try {
            val read = executor.submit(java.util.concurrent.Callable { reader.getFcmRegistrationSnapshot() })
            assertTrue(tokenRead.await(5, TimeUnit.SECONDS))
            val write = executor.submit { writer.saveFcmToken("token-b") }

            assertFalse(writerEntered.await(200, TimeUnit.MILLISECONDS))
            releaseRead.countDown()
            assertEquals(FcmRegistrationSnapshot("token-a", 1L), read.get(5, TimeUnit.SECONDS))
            write.get(5, TimeUnit.SECONDS)
            assertEquals(FcmRegistrationSnapshot("token-b", 2L), manager().getFcmRegistrationSnapshot())
        } finally {
            releaseRead.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun `blank tokens do not advance direct registration generation`() {
        val prefs = manager()

        prefs.saveFcmToken(null)
        prefs.saveFcmToken("")
        prefs.saveFcmToken("   ")

        assertEquals(0L, prefs.getFcmTokenGeneration())
        assertNull(prefs.getFcmToken())
    }

    @Test
    fun `direct registration identity and generation survive credential pair and relay resets`() {
        val prefs = manager()
        val id = prefs.getOrCreateDirectDeviceId()
        prefs.saveFcmToken("fcm-token")
        prefs.saveCredentials("channel", "device", "secret")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        prefs.clearCredentials()
        prefs.clearPair()
        prefs.resetForRelay("https://relay.example.com")

        val recreated = manager()
        assertEquals(id, recreated.getOrCreateDirectDeviceId())
        assertEquals(1L, recreated.getFcmTokenGeneration())
    }

    @Test
    fun `existing FCM token migrates to a coherent generation without diagnostics`() {
        store.edit().putString("push.fcm_token", "existing-secret-token").commit()

        val prefs = manager()

        assertEquals(1L, prefs.getFcmTokenGeneration())
        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
    }

    @Test
    fun `FCM token and pending state are separate`() {
        val prefs = manager()

        prefs.saveFcmToken("fcm-token")
        prefs.setTokenPending(false)

        assertEquals("fcm-token", prefs.getFcmToken())
        assertFalse(prefs.isTokenPending())
    }

    @Test
    fun `clearCredentials retains relay token and pending state`() {
        val prefs = manager()
        prefs.saveCredentials("channel", "device", "secret")
        prefs.saveFcmToken("fcm-token")
        prefs.setTokenPending(true)
        prefs.saveRelayUrl("https://relay.example.com")

        prefs.clearCredentials()

        assertNull(prefs.getChannelId())
        assertNull(prefs.getDeviceId())
        assertNull(prefs.getDeviceSecret())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
        assertEquals("https://relay.example.com", prefs.getRelayUrl())
    }

    @Test
    fun `resetForRelay clears credentials and pair state but retains pending FCM token`() {
        val prefs = manager()
        prefs.saveCredentials("channel", "device", "secret")
        prefs.saveFcmToken("fcm-token")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        val result = prefs.resetForRelay("https://relay.example.com/")

        assertEquals(RelayUrlResult.Valid("https://relay.example.com"), result)
        assertNull(prefs.getChannelId())
        assertNull(prefs.getPairId())
        assertNull(prefs.getPairToken())
        assertNull(prefs.getPairCommand())
        assertNull(prefs.getPairExpires())
        assertNull(prefs.getPairStatus())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
        assertEquals("https://relay.example.com", prefs.getRelayUrl())
    }

    @Test
    fun `saveRelayUrl resets relay scoped state when the normalized relay changes`() {
        val prefs = manager()
        prefs.saveCredentials("channel", "device", "secret")
        prefs.saveFcmToken("fcm-token")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        val result = prefs.saveRelayUrl("https://relay.example.com/")

        assertEquals(RelayUrlResult.Valid("https://relay.example.com"), result)
        assertNull(prefs.getChannelId())
        assertNull(prefs.getPairId())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
        assertEquals("https://relay.example.com", prefs.getRelayUrl())
    }

    @Test
    fun `saveRelayUrl preserves relay scoped state when the normalized relay is unchanged`() {
        val prefs = manager()
        prefs.saveRelayUrl("https://relay.example.com")
        prefs.saveCredentials("channel", "device", "secret")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        val result = prefs.saveRelayUrl("https://relay.example.com/")

        assertEquals(RelayUrlResult.Valid("https://relay.example.com"), result)
        assertEquals("channel", prefs.getChannelId())
        assertEquals("pair", prefs.getPairId())
    }

    @Test
    fun `saveRelayUrl returns stable errors for invalid public relays`() {
        val prefs = manager()

        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("http://relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("https://user:pass@relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("https://relay.example.com/#fragment"))
    }

    @Test
    fun `pair state survives manager recreation`() {
        manager().savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        val recreated = manager()

        assertEquals("pair", recreated.getPairId())
        assertEquals("pair-token", recreated.getPairToken())
        assertEquals("pair-command", recreated.getPairCommand())
        assertEquals("2026-01-01", recreated.getPairExpires())
        assertEquals("pending", recreated.getPairStatus())
    }

    @Test
    fun `diagnostics set clear and exclude FCM and pair tokens`() {
        val prefs = manager()
        prefs.saveFcmToken("fcm-token")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        prefs.saveDiagnostic("sync_failed", "fcm-token")

        assertEquals("sync_failed", prefs.getLastCode())
        assertNull(prefs.getLastError())

        prefs.saveDiagnostic("pair_failed", "pair-token")
        assertEquals("pair_failed", prefs.getLastCode())
        assertNull(prefs.getLastError())

        prefs.saveDiagnostic("network_error", "Network unavailable")
        assertEquals("network_error", prefs.getLastCode())
        assertEquals("Network unavailable", prefs.getLastError())

        prefs.clearDiagnostic()
        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
    }

    @Test
    fun `FCM token arrival clears an earlier diagnostic containing the token`() {
        val prefs = manager()
        prefs.saveDiagnostic("fcm-token", "Token registration failed: fcm-token")

        prefs.saveFcmToken("fcm-token")

        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
    }

    @Test
    fun `pair token arrival clears an earlier diagnostic containing the token`() {
        val prefs = manager()
        prefs.saveDiagnostic("pair-token", "Pair authorization failed: pair-token")

        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
    }

    @Test
    fun `diagnostic code excludes known FCM and pair tokens`() {
        val prefs = manager()
        prefs.saveFcmToken("fcm-token")

        prefs.saveDiagnostic("sync-fcm-token", "Network unavailable")
        assertNull(prefs.getLastCode())
        assertEquals("Network unavailable", prefs.getLastError())

        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")
        prefs.saveDiagnostic("pair-pair-token", "Pair failed")
        assertNull(prefs.getLastCode())
        assertEquals("Pair failed", prefs.getLastError())
    }

    @Test
    fun `diagnostics survive manager recreation`() {
        manager().saveDiagnostic("network_error", "Network unavailable")

        val recreated = manager()

        assertEquals("network_error", recreated.getLastCode())
        assertEquals("Network unavailable", recreated.getLastError())
    }

    @Test
    fun `clearPair preserves relay FCM token and pending state`() {
        val prefs = manager()
        prefs.saveRelayUrl("https://relay.example.com")
        prefs.saveFcmToken("fcm-token")
        prefs.setTokenPending(true)
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        prefs.clearPair()

        assertNull(prefs.getPairId())
        assertEquals("https://relay.example.com", prefs.getRelayUrl())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
    }

    @Test
    fun `clearDiagnostic preserves relay FCM token and pending state`() {
        val prefs = manager()
        prefs.saveRelayUrl("https://relay.example.com")
        prefs.saveFcmToken("fcm-token")
        prefs.setTokenPending(true)
        prefs.saveDiagnostic("network_error", "Network unavailable")

        prefs.clearDiagnostic()

        assertNull(prefs.getLastCode())
        assertNull(prefs.getLastError())
        assertEquals("https://relay.example.com", prefs.getRelayUrl())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
    }

    @Suppress("DEPRECATION")
    @Test
    fun `legacy clearAll preserves relay FCM token and pending state`() {
        val prefs = manager()
        prefs.saveRelayUrl("https://relay.example.com")
        prefs.saveFcmToken("fcm-token")
        prefs.setTokenPending(true)
        prefs.saveCredentials("channel", "device", "secret")
        prefs.savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")
        prefs.saveDiagnostic("network_error", "Network unavailable")

        prefs.clearAll()

        assertNull(prefs.getChannelId())
        assertNull(prefs.getPairId())
        assertNull(prefs.getLastCode())
        assertEquals("https://relay.example.com", prefs.getRelayUrl())
        assertEquals("fcm-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
    }

    @Test
    fun `legacy pending token migrates to FCM token and pending flag`() {
        store.edit().putString("push.pending_token", "legacy-token").commit()

        val prefs = manager()

        assertEquals("legacy-token", prefs.getFcmToken())
        assertEquals(1L, prefs.getFcmTokenGeneration())
        assertTrue(prefs.isTokenPending())
    }

    @Test
    fun `initialization resets invalid public relay with modern FCM token`() {
        store.edit()
            .putString("push.relay_url", "http://relay.example.com")
            .putString("push.channel", "channel")
            .putString("push.device", "device")
            .putString("push.secret", "secret")
            .putString("push.pair_id", "pair")
            .putString("push.pair_token", "pair-token")
            .putString("push.pair_command", "pair-command")
            .putString("push.pair_expires", "2026-01-01")
            .putString("push.pair_status", "pending")
            .putString("push.fcm_token", "fcm-token")
            .putBoolean("push.token_pending", false)
            .commit()

        val recreated = manager()

        assertEquals("https://whisper.clankercontext.com", store.getString("push.relay_url", null))
        assertNull(recreated.getChannelId())
        assertNull(recreated.getDeviceId())
        assertNull(recreated.getDeviceSecret())
        assertNull(recreated.getPairId())
        assertNull(recreated.getPairToken())
        assertNull(recreated.getPairCommand())
        assertNull(recreated.getPairExpires())
        assertNull(recreated.getPairStatus())
        assertEquals("fcm-token", recreated.getFcmToken())
        assertTrue(recreated.isTokenPending())
    }

    @Test
    fun `legacy valid relay URLs survive recreation`() {
        val stored = store

        stored.edit().putString("push.relay_url", "https://relay.example.com/").commit()
        assertEquals("https://relay.example.com", manager().getRelayUrl())

        stored.edit().putString("push.relay_url", "http://10.0.2.2/").commit()
        assertEquals("http://10.0.2.2", manager().getRelayUrl())
    }

    @Test
    fun `relay validation permits HTTPS and local HTTP only`() {
        val prefs = manager()

        assertEquals(RelayUrlResult.Valid("https://relay.example.com"), prefs.normalizeRelayUrl("https://relay.example.com/"))
        assertEquals(RelayUrlResult.Valid("http://localhost:3000"), prefs.normalizeRelayUrl("http://localhost:3000/"))
        assertEquals(RelayUrlResult.Valid("http://127.0.0.1"), prefs.normalizeRelayUrl("http://127.0.0.1"))
        assertEquals(RelayUrlResult.Valid("http://10.0.2.2"), prefs.normalizeRelayUrl("http://10.0.2.2"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("http://relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("ftp://relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("https://user:pass@relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("https://relay.example.com/#fragment"))
    }

    @Test
    fun `relay validation rejects URLs with query strings`() {
        val prefs = manager()

        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("https://relay.example.com?x"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("https://relay.example.com?x"))
    }
}
