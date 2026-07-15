package ai.opencode.mobilebridge

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit
import org.json.JSONObject

internal enum class TokenSyncResult { SUCCESS, RETRY, FAILURE }

internal interface TokenSyncStore {
    fun currentToken(): String?
    fun credentials(): PushCredentials?
    fun relayUrl(): String
    fun clearCredentials()
    fun setTokenPending(pending: Boolean)
}

internal interface TokenRelay {
    fun putToken(relay: String, credentials: PushCredentials, token: String): RelayResult<JSONObject>
}

internal class PushRelayTokenClient : TokenRelay {
    override fun putToken(relay: String, credentials: PushCredentials, token: String): RelayResult<JSONObject> =
        PushRelayClient().putToken(relay, credentials, token)
}

internal class TokenSync(private val store: TokenSyncStore, private val relay: TokenRelay) {
    fun sync(): TokenSyncResult {
        val token = store.currentToken()?.takeIf { it.isNotBlank() } ?: return TokenSyncResult.FAILURE
        val credentials = store.credentials() ?: return TokenSyncResult.SUCCESS
        if (credentials.channelId.isBlank() || credentials.deviceId.isBlank() || credentials.deviceSecret.isBlank()) {
            return TokenSyncResult.FAILURE
        }
        return when (val result = relay.putToken(store.relayUrl(), credentials, token)) {
            is RelayResult.Ok -> {
                store.setTokenPending(false)
                TokenSyncResult.SUCCESS
            }
            is RelayResult.Err -> {
                val status = result.error.status
                when {
                    result.error.code in setOf("bad_device_secret", "device_not_found") -> {
                        store.clearCredentials()
                        TokenSyncResult.FAILURE
                    }
                    status == null || status == 408 || status == 429 || status >= 500 ->
                        TokenSyncResult.RETRY
                    else -> TokenSyncResult.FAILURE
                }
            }
        }
    }
}

class TokenSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        private const val WORK_NAME = "PushTokenSyncWork"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val syncRequest = OneTimeWorkRequestBuilder<TokenSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    30,
                    TimeUnit.SECONDS
                )
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                syncRequest
            )
        }

        fun schedule(context: Context, @Suppress("UNUSED_PARAMETER") token: String) = schedule(context)
    }

    override suspend fun doWork(): Result {
        val prefs = SecurePreferencesManager(applicationContext)
        val store = object : TokenSyncStore {
            override fun currentToken(): String? = prefs.getFcmToken()
            override fun credentials(): PushCredentials? {
                val channel = prefs.getChannelId() ?: return null
                val device = prefs.getDeviceId() ?: return null
                val secret = prefs.getDeviceSecret() ?: return null
                return PushCredentials(channel, device, secret)
            }

            override fun relayUrl(): String = prefs.getRelayUrl()
            override fun clearCredentials() = prefs.clearCredentials()
            override fun setTokenPending(pending: Boolean) = prefs.setTokenPending(pending)
        }
        return when (TokenSync(store, PushRelayTokenClient()).sync()) {
            TokenSyncResult.SUCCESS -> Result.success()
            TokenSyncResult.RETRY -> Result.retry()
            TokenSyncResult.FAILURE -> Result.failure()
        }
    }
}
