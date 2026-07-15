package ai.opencode.mobilebridge

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.net.URI
import java.security.KeyStore

sealed class RelayUrlResult {
    data class Valid(val url: String) : RelayUrlResult()

    data class Invalid(val code: String) : RelayUrlResult()
}

class SecurePreferencesManager(private val context: Context) {
    companion object {
        private const val TAG = "SecurePrefs"
        private const val SECURE_FILE_NAME = "whisper_secure_prefs"
        private const val DEFAULT_RELAY_URL = "https://whisper.clankercontext.com"

        private const val KEY_CHANNEL = "push.channel"
        private const val KEY_DEVICE = "push.device"
        private const val KEY_SECRET = "push.secret"
        private const val KEY_RELAY_URL = "push.relay_url"
        private const val KEY_FCM_TOKEN = "push.fcm_token"
        private const val KEY_TOKEN_PENDING = "push.token_pending"
        private const val KEY_PAIR_ID = "push.pair_id"
        private const val KEY_PAIR_TOKEN = "push.pair_token"
        private const val KEY_PAIR_COMMAND = "push.pair_command"
        private const val KEY_PAIR_EXPIRES = "push.pair_expires"
        private const val KEY_PAIR_STATUS = "push.pair_status"
        private const val KEY_LAST_CODE = "push.last_code"
        private const val KEY_LAST_ERROR = "push.last_error"

        private const val LEGACY_KEY_PENDING_TOKEN = "push.pending_token"
        private const val INVALID_RELAY_URL = "invalid_relay_url"
    }

    private var sharedPreferences: SharedPreferences? = null

    init {
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
        if (!prefs.contains(KEY_FCM_TOKEN)) {
            val token = prefs.getString(LEGACY_KEY_PENDING_TOKEN, null)
            if (!token.isNullOrBlank()) {
                prefs.edit()
                    .putString(KEY_FCM_TOKEN, token)
                    .putBoolean(KEY_TOKEN_PENDING, true)
                    .remove(LEGACY_KEY_PENDING_TOKEN)
                    .apply()
            }
        }
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

    fun normalizeRelayUrl(url: String?): RelayUrlResult {
        val value = url?.trim()?.takeIf { it.isNotEmpty() } ?: return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        val parsed = try {
            URI(value)
        } catch (_: Exception) {
            return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        }
        val scheme = parsed.scheme?.lowercase()
        val host = parsed.host?.lowercase()
        if (scheme !in setOf("https", "http") || host == null || parsed.userInfo != null || parsed.fragment != null) {
            return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        }
        if (scheme == "http" && host !in setOf("localhost", "127.0.0.1", "10.0.2.2")) {
            return RelayUrlResult.Invalid(INVALID_RELAY_URL)
        }
        return RelayUrlResult.Valid(parsed.normalize().toString().trimEnd('/'))
    }

    fun saveRelayUrl(url: String?) {
        val result = normalizeRelayUrl(url)
        if (result is RelayUrlResult.Valid) sharedPreferences?.edit()?.putString(KEY_RELAY_URL, result.url)?.apply()
    }

    fun getRelayUrl(): String = sharedPreferences?.getString(KEY_RELAY_URL, DEFAULT_RELAY_URL) ?: DEFAULT_RELAY_URL

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
        sharedPreferences?.edit()?.apply {
            putString(KEY_FCM_TOKEN, token)
            if (token != null && sharedPreferences?.getString(KEY_LAST_ERROR, null)?.contains(token) == true) {
                remove(KEY_LAST_ERROR)
            }
            apply()
        }
    }

    fun getFcmToken(): String? = sharedPreferences?.getString(KEY_FCM_TOKEN, null)

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
        val token = getFcmToken()
        val error = message?.trim()?.takeIf { it.isNotEmpty() && (token.isNullOrEmpty() || !it.contains(token)) }
        sharedPreferences?.edit()?.apply {
            putString(KEY_LAST_CODE, code?.trim()?.takeIf { it.isNotEmpty() })
            putString(KEY_LAST_ERROR, error)
            apply()
        }
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
