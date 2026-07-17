package ai.opencode.mobilebridge

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.net.URI
import java.security.KeyStore
import java.util.UUID

sealed class RelayUrlResult {
    data class Valid(val url: String) : RelayUrlResult()

    data class Invalid(val code: String) : RelayUrlResult()
}

data class RelayCleanupSnapshot(val id: String, val relayUrl: String, val credentials: PushCredentials)

data class FcmRegistrationSnapshot(val token: String, val generation: Long)

class SecurePreferencesManager private constructor(
    private val context: Context,
    private var sharedPreferences: SharedPreferences?,
    private val scheduleCleanup: (String) -> Unit,
) {
    companion object {
        private val FCM_REGISTRATION_LOCK = Any()

        internal fun fromPreferences(
            context: Context,
            preferences: SharedPreferences,
            scheduleCleanup: (String) -> Unit = { RelayCleanupWorkScheduler.schedule(context, it) },
        ): SecurePreferencesManager = SecurePreferencesManager(context, preferences, scheduleCleanup).also { it.migrateLegacyState() }

        private const val TAG = "SecurePrefs"
        private const val SECURE_FILE_NAME = "whisper_secure_prefs"
        private const val DEFAULT_RELAY_URL = "https://whisper.clankercontext.com"

        private const val KEY_CHANNEL = "push.channel"
        private const val KEY_DEVICE = "push.device"
        private const val KEY_SECRET = "push.secret"
        private const val KEY_RELAY_URL = "push.relay_url"
        private const val KEY_FCM_TOKEN = "push.fcm_token"
        private const val KEY_DIRECT_DEVICE_ID = "push.direct_device_id"
        private const val KEY_FCM_TOKEN_GENERATION = "push.fcm_token_generation"
        private const val KEY_TOKEN_PENDING = "push.token_pending"
        private const val KEY_PAIR_ID = "push.pair_id"
        private const val KEY_PAIR_TOKEN = "push.pair_token"
        private const val KEY_PAIR_COMMAND = "push.pair_command"
        private const val KEY_PAIR_EXPIRES = "push.pair_expires"
        private const val KEY_PAIR_STATUS = "push.pair_status"
        private const val KEY_LAST_CODE = "push.last_code"
        private const val KEY_LAST_ERROR = "push.last_error"
        private const val KEY_CLEANUP_PREFIX = "push.cleanup"

        private const val LEGACY_KEY_PENDING_TOKEN = "push.pending_token"
        private const val LEGACY_KEY_CLEANUP_RELAY_URL = "push.cleanup.relay_url"
        private const val LEGACY_KEY_CLEANUP_CHANNEL = "push.cleanup.channel"
        private const val LEGACY_KEY_CLEANUP_DEVICE = "push.cleanup.device"
        private const val LEGACY_KEY_CLEANUP_SECRET = "push.cleanup.secret"
        private const val INVALID_RELAY_URL = "invalid_relay_url"
    }

    constructor(context: Context) : this(context, null, { RelayCleanupWorkScheduler.schedule(context, it) }) {
        initializePreferences()
        migrateLegacyState()
    }

    private fun initializePreferences() {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            sharedPreferences = EncryptedSharedPreferences.create(
                context,
                SECURE_FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize EncryptedSharedPreferences. KeyStore may be corrupted.", e)
            handleKeyStoreCorruption()
        }
    }

    private fun migrateLegacyState() {
        val prefs = sharedPreferences ?: return
        synchronized(FCM_REGISTRATION_LOCK) {
            if (!prefs.contains(KEY_FCM_TOKEN)) {
                val token = prefs.getString(LEGACY_KEY_PENDING_TOKEN, null)
                if (!token.isNullOrBlank()) {
                    prefs.edit()
                        .putString(KEY_FCM_TOKEN, token)
                        .putLong(KEY_FCM_TOKEN_GENERATION, 1L)
                        .putBoolean(KEY_TOKEN_PENDING, true)
                        .remove(LEGACY_KEY_PENDING_TOKEN)
                        .apply()
                }
            }
            if (!prefs.getString(KEY_FCM_TOKEN, null).isNullOrBlank() && prefs.getLong(KEY_FCM_TOKEN_GENERATION, 0L) < 1L) {
                prefs.edit().putLong(KEY_FCM_TOKEN_GENERATION, 1L).apply()
            }
        }
        val relayUrl = prefs.getString(LEGACY_KEY_CLEANUP_RELAY_URL, null)
        val channel = prefs.getString(LEGACY_KEY_CLEANUP_CHANNEL, null)
        val device = prefs.getString(LEGACY_KEY_CLEANUP_DEVICE, null)
        val secret = prefs.getString(LEGACY_KEY_CLEANUP_SECRET, null)
        if (relayUrl != null && channel != null && device != null && secret != null) {
            val snapshot = RelayCleanupSnapshot(UUID.randomUUID().toString(), relayUrl, PushCredentials(channel, device, secret))
            val key = "$KEY_CLEANUP_PREFIX.${snapshot.id}"
            if (prefs.edit()
                .putString("$key.relay_url", snapshot.relayUrl)
                .putString("$key.channel", snapshot.credentials.channelId)
                .putString("$key.device", snapshot.credentials.deviceId)
                .putString("$key.secret", snapshot.credentials.deviceSecret)
                .remove(LEGACY_KEY_CLEANUP_RELAY_URL)
                .remove(LEGACY_KEY_CLEANUP_CHANNEL)
                .remove(LEGACY_KEY_CLEANUP_DEVICE)
                .remove(LEGACY_KEY_CLEANUP_SECRET)
                .commit()
            ) {
                scheduleCleanup(snapshot.id)
            }
        }
        getRelayUrl()
    }

    private fun handleKeyStoreCorruption() {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            clearAllPreferences()

            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            sharedPreferences = EncryptedSharedPreferences.create(
                context,
                SECURE_FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            Log.i(TAG, "Successfully recovered from KeyStore corruption. Local credentials reset.")
        } catch (recoveryException: Exception) {
            Log.e(TAG, "Fatal recovery exception during KeyStore corruption recovery", recoveryException)
        }
    }

    private fun clearAllPreferences() {
        val sharedPrefsFile = File(context.filesDir.parent, "shared_prefs/$SECURE_FILE_NAME.xml")
        if (sharedPrefsFile.exists()) sharedPrefsFile.delete()
    }

    fun saveCredentials(channelId: String?, deviceId: String?, deviceSecret: String?) {
        sharedPreferences?.edit()?.apply {
            putString(KEY_CHANNEL, channelId)
            putString(KEY_DEVICE, deviceId)
            putString(KEY_SECRET, deviceSecret)
            apply()
        }
    }

    fun getChannelId(): String? = sharedPreferences?.getString(KEY_CHANNEL, null)
    fun getDeviceId(): String? = sharedPreferences?.getString(KEY_DEVICE, null)
    fun getDeviceSecret(): String? = sharedPreferences?.getString(KEY_SECRET, null)

    fun clearCredentials() {
        sharedPreferences?.edit()?.remove(KEY_CHANNEL)?.remove(KEY_DEVICE)?.remove(KEY_SECRET)?.apply()
    }

    fun savePendingRelayCleanup(relayUrl: String, credentials: PushCredentials): RelayCleanupSnapshot? {
        val prefs = sharedPreferences ?: return null
        val snapshot = RelayCleanupSnapshot(UUID.randomUUID().toString(), relayUrl, credentials)
        val key = "$KEY_CLEANUP_PREFIX.${snapshot.id}"
        return snapshot.takeIf {
            prefs.edit()
                .putString("$key.relay_url", relayUrl)
                .putString("$key.channel", credentials.channelId)
                .putString("$key.device", credentials.deviceId)
                .putString("$key.secret", credentials.deviceSecret)
                .commit()
        }
    }

    fun getPendingRelayCleanup(id: String): RelayCleanupSnapshot? {
        val prefs = sharedPreferences ?: return null
        val key = "$KEY_CLEANUP_PREFIX.$id"
        val relayUrl = prefs.getString("$key.relay_url", null) ?: return null
        val channel = prefs.getString("$key.channel", null) ?: return null
        val device = prefs.getString("$key.device", null) ?: return null
        val secret = prefs.getString("$key.secret", null) ?: return null
        return RelayCleanupSnapshot(id, relayUrl, PushCredentials(channel, device, secret))
    }

    fun clearPendingRelayCleanup(snapshot: RelayCleanupSnapshot): Boolean {
        if (getPendingRelayCleanup(snapshot.id) != snapshot) return true
        val prefs = sharedPreferences ?: return false
        val key = "$KEY_CLEANUP_PREFIX.${snapshot.id}"
        return prefs.edit()
            .remove("$key.relay_url")
            .remove("$key.channel")
            .remove("$key.device")
            .remove("$key.secret")
            .commit()
    }

    fun normalizeRelayUrl(url: String?): RelayUrlResult {
        val value = url?.trim()?.takeIf { it.isNotEmpty() } ?: return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        val parsed = try {
            URI(value)
        } catch (_: Exception) {
            return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        }
        val scheme = parsed.scheme?.lowercase()
        val host = parsed.host?.lowercase()
        if (scheme !in setOf("https", "http") || host == null || parsed.userInfo != null || parsed.query != null || parsed.fragment != null) {
            return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        }
        if (scheme == "http" && host !in setOf("localhost", "127.0.0.1", "10.0.2.2")) {
            return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        }
        return RelayUrlResult.Valid(parsed.normalize().toString().trimEnd('/'))
    }

    fun saveRelayUrl(url: String?): RelayUrlResult {
        val result = normalizeRelayUrl(url)
        if (result !is RelayUrlResult.Valid) return result
        if (getRelayUrl() == result.url) return result
        return resetForRelay(result.url)
    }

    fun getRelayUrl(): String {
        val relay = sharedPreferences?.getString(KEY_RELAY_URL, null) ?: return DEFAULT_RELAY_URL
        val result = normalizeRelayUrl(relay)
        if (result is RelayUrlResult.Valid) {
            if (result.url != relay) sharedPreferences?.edit()?.putString(KEY_RELAY_URL, result.url)?.apply()
            return result.url
        }
        resetForRelay(DEFAULT_RELAY_URL)
        return DEFAULT_RELAY_URL
    }

    fun resetForRelay(relayUrl: String?): RelayUrlResult {
        val result = normalizeRelayUrl(relayUrl)
        if (result !is RelayUrlResult.Valid) return result
        clearCredentials()
        clearPair()
        sharedPreferences?.edit()?.putString(KEY_RELAY_URL, result.url)?.apply()
        setTokenPending(getFcmToken() != null)
        return result
    }

    fun saveFcmToken(token: String?) {
        val prefs = sharedPreferences ?: return
        val value = token?.takeIf { it.isNotBlank() }
        synchronized(FCM_REGISTRATION_LOCK) {
            val current = prefs.getString(KEY_FCM_TOKEN, null)?.takeIf { it.isNotBlank() }
            val edit = prefs.edit()
            if (value == null) {
                edit.remove(KEY_FCM_TOKEN)
            } else {
                edit.putString(KEY_FCM_TOKEN, value)
                if (value != current) {
                    edit.putLong(KEY_FCM_TOKEN_GENERATION, prefs.getLong(KEY_FCM_TOKEN_GENERATION, 0L) + 1L)
                }
            }
            edit.apply()
        }
        clearDiagnosticContaining(value)
    }

    fun getFcmToken(): String? = sharedPreferences?.getString(KEY_FCM_TOKEN, null)

    fun getFcmTokenGeneration(): Long = sharedPreferences?.getLong(KEY_FCM_TOKEN_GENERATION, 0L) ?: 0L

    fun getFcmRegistrationSnapshot(): FcmRegistrationSnapshot? = synchronized(FCM_REGISTRATION_LOCK) {
        val prefs = sharedPreferences ?: return@synchronized null
        val token = prefs.getString(KEY_FCM_TOKEN, null)?.takeIf { it.isNotBlank() } ?: return@synchronized null
        FcmRegistrationSnapshot(token, prefs.getLong(KEY_FCM_TOKEN_GENERATION, 0L))
    }

    fun getOrCreateDirectDeviceId(): String {
        val prefs = sharedPreferences ?: return UUID.randomUUID().toString()
        return synchronized(FCM_REGISTRATION_LOCK) {
            val existing = prefs.getString(KEY_DIRECT_DEVICE_ID, null)
            if (!existing.isNullOrBlank()) return@synchronized existing
            val created = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DIRECT_DEVICE_ID, created).commit()
            created
        }
    }

    fun setTokenPending(pending: Boolean) {
        sharedPreferences?.edit()?.putBoolean(KEY_TOKEN_PENDING, pending)?.apply()
    }

    fun isTokenPending(): Boolean = sharedPreferences?.getBoolean(KEY_TOKEN_PENDING, false) ?: false

    fun savePair(pairId: String?, pairToken: String?, pairCommand: String?, pairExpires: String?, pairStatus: String?) {
        sharedPreferences?.edit()?.apply {
            putString(KEY_PAIR_ID, pairId)
            putString(KEY_PAIR_TOKEN, pairToken)
            putString(KEY_PAIR_COMMAND, pairCommand)
            putString(KEY_PAIR_EXPIRES, pairExpires)
            putString(KEY_PAIR_STATUS, pairStatus)
            apply()
        }
        clearDiagnosticContaining(pairToken)
    }

    fun getPairId(): String? = sharedPreferences?.getString(KEY_PAIR_ID, null)
    fun getPairToken(): String? = sharedPreferences?.getString(KEY_PAIR_TOKEN, null)
    fun getPairCommand(): String? = sharedPreferences?.getString(KEY_PAIR_COMMAND, null)
    fun getPairExpires(): String? = sharedPreferences?.getString(KEY_PAIR_EXPIRES, null)
    fun getPairStatus(): String? = sharedPreferences?.getString(KEY_PAIR_STATUS, null)

    fun clearPair() {
        sharedPreferences?.edit()
            ?.remove(KEY_PAIR_ID)
            ?.remove(KEY_PAIR_TOKEN)
            ?.remove(KEY_PAIR_COMMAND)
            ?.remove(KEY_PAIR_EXPIRES)
            ?.remove(KEY_PAIR_STATUS)
            ?.apply()
    }

    fun saveDiagnostic(code: String?, message: String?) {
        sharedPreferences?.edit()?.apply {
            putString(KEY_LAST_CODE, sanitizeDiagnostic(code))
            putString(KEY_LAST_ERROR, sanitizeDiagnostic(message))
            apply()
        }
    }

    private fun sanitizeDiagnostic(value: String?): String? {
        val text = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val tokens = listOf(getFcmToken(), getPairToken()).filterNotNull().filter { it.isNotEmpty() }
        return text.takeIf { candidate -> tokens.none { candidate.contains(it) } }
    }

    private fun clearDiagnosticContaining(token: String?) {
        if (token.isNullOrEmpty()) return
        if (getLastCode()?.contains(token) == true || getLastError()?.contains(token) == true) clearDiagnostic()
    }

    fun getLastCode(): String? = sharedPreferences?.getString(KEY_LAST_CODE, null)
    fun getLastError(): String? = sharedPreferences?.getString(KEY_LAST_ERROR, null)

    fun clearDiagnostic() {
        sharedPreferences?.edit()?.remove(KEY_LAST_CODE)?.remove(KEY_LAST_ERROR)?.apply()
    }

    @Deprecated("Use saveFcmToken and setTokenPending")
    fun savePendingToken(token: String?) {
        if (token == null) {
            setTokenPending(false)
            return
        }
        saveFcmToken(token)
        setTokenPending(true)
    }

    @Deprecated("Use getFcmToken with isTokenPending")
    fun getPendingToken(): String? = getFcmToken()?.takeIf { isTokenPending() }

    @Deprecated("Use savePair")
    fun savePairId(pairId: String?) {
        sharedPreferences?.edit()?.putString(KEY_PAIR_ID, pairId)?.apply()
    }

    @Deprecated("Use clearCredentials and clearPair")
    fun clearAll() {
        clearCredentials()
        clearPair()
        clearDiagnostic()
        if (getFcmToken() != null) setTokenPending(true)
    }
}
