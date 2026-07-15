package ai.opencode.mobilebridge

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class SecurePreferencesManagerTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("whisper_secure_prefs", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun `FCM token and pending state are separate`() {
        val prefs = SecurePreferencesManager(context)

        prefs.saveFcmToken("fcm-token")
        prefs.setTokenPending(false)

        assertEquals("fcm-token", prefs.getFcmToken())
        assertFalse(prefs.isTokenPending())
    }

    @Test
    fun `clearCredentials retains relay token and pending state`() {
        val prefs = SecurePreferencesManager(context)
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
        val prefs = SecurePreferencesManager(context)
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
        val prefs = SecurePreferencesManager(context)
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
        val prefs = SecurePreferencesManager(context)
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
        val prefs = SecurePreferencesManager(context)

        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("http://relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("https://user:pass@relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.saveRelayUrl("https://relay.example.com/#fragment"))
    }

    @Test
    fun `pair state survives manager recreation`() {
        SecurePreferencesManager(context).savePair("pair", "pair-token", "pair-command", "2026-01-01", "pending")

        val recreated = SecurePreferencesManager(context)

        assertEquals("pair", recreated.getPairId())
        assertEquals("pair-token", recreated.getPairToken())
        assertEquals("pair-command", recreated.getPairCommand())
        assertEquals("2026-01-01", recreated.getPairExpires())
        assertEquals("pending", recreated.getPairStatus())
    }

    @Test
    fun `diagnostics set clear and exclude FCM and pair tokens`() {
        val prefs = SecurePreferencesManager(context)
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
    fun `diagnostics survive manager recreation`() {
        SecurePreferencesManager(context).saveDiagnostic("network_error", "Network unavailable")

        val recreated = SecurePreferencesManager(context)

        assertEquals("network_error", recreated.getLastCode())
        assertEquals("Network unavailable", recreated.getLastError())
    }

    @Test
    fun `clearPair preserves relay FCM token and pending state`() {
        val prefs = SecurePreferencesManager(context)
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
        val prefs = SecurePreferencesManager(context)
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
        val prefs = SecurePreferencesManager(context)
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
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "whisper_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        ).edit().putString("push.pending_token", "legacy-token").commit()

        val prefs = SecurePreferencesManager(context)

        assertEquals("legacy-token", prefs.getFcmToken())
        assertTrue(prefs.isTokenPending())
    }

    @Test
    fun `legacy public HTTP relay resets relay scoped state during recreation`() {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "whisper_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        ).edit()
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

        val recreated = SecurePreferencesManager(context)

        assertEquals("https://whisper.clankercontext.com", recreated.getRelayUrl())
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
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val stored = EncryptedSharedPreferences.create(
            context,
            "whisper_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )

        stored.edit().putString("push.relay_url", "https://relay.example.com/").commit()
        assertEquals("https://relay.example.com", SecurePreferencesManager(context).getRelayUrl())

        stored.edit().putString("push.relay_url", "http://10.0.2.2/").commit()
        assertEquals("http://10.0.2.2", SecurePreferencesManager(context).getRelayUrl())
    }

    @Test
    fun `relay validation permits HTTPS and local HTTP only`() {
        val prefs = SecurePreferencesManager(context)

        assertEquals(RelayUrlResult.Valid("https://relay.example.com"), prefs.normalizeRelayUrl("https://relay.example.com/"))
        assertEquals(RelayUrlResult.Valid("http://localhost:3000"), prefs.normalizeRelayUrl("http://localhost:3000/"))
        assertEquals(RelayUrlResult.Valid("http://127.0.0.1"), prefs.normalizeRelayUrl("http://127.0.0.1"))
        assertEquals(RelayUrlResult.Valid("http://10.0.2.2"), prefs.normalizeRelayUrl("http://10.0.2.2"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("http://relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("ftp://relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("https://user:pass@relay.example.com"))
        assertEquals(RelayUrlResult.Invalid("invalid_relay_url"), prefs.normalizeRelayUrl("https://relay.example.com/#fragment"))
    }
}
