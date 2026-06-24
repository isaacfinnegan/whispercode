package ai.opencode.mobilebridge

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.security.KeyStore

class SecurePreferencesManager(private val context: Context) {
    companion object {
        private const val TAG = "SecurePrefs"
        private const val SECURE_FILE_NAME = "whisper_secure_prefs"
        
        private const val KEY_CHANNEL = "push.channel"
        private const val KEY_DEVICE = "push.device"
        private const val KEY_SECRET = "push.secret"
        private const val KEY_RELAY_URL = "push.relay_url"
        private const val KEY_PENDING_TOKEN = "push.pending_token"
    }

    private var sharedPreferences: SharedPreferences? = null

    init {
        initializePreferences()
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

    private fun handleKeyStoreCorruption() {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            
            val sharedPrefsFile = File(context.filesDir.parent, "shared_prefs/$SECURE_FILE_NAME.xml")
            if (sharedPrefsFile.exists()) {
                sharedPrefsFile.delete()
            }
            
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

    fun saveRelayUrl(url: String?) {
        sharedPreferences?.edit()?.putString(KEY_RELAY_URL, url)?.apply()
    }

    fun getRelayUrl(): String = sharedPreferences?.getString(KEY_RELAY_URL, "https://whisper.clankercontext.com") ?: "https://whisper.clankercontext.com"

    fun savePendingToken(token: String?) {
        sharedPreferences?.edit()?.putString(KEY_PENDING_TOKEN, token)?.apply()
    }

    fun getPendingToken(): String? = sharedPreferences?.getString(KEY_PENDING_TOKEN, null)

    fun clearAll() {
        sharedPreferences?.edit()?.clear()?.apply()
    }
}
