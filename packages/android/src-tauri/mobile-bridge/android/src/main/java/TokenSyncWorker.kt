package ai.opencode.mobilebridge

import android.content.Context
import android.util.Log
import androidx.work.*
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class TokenSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        private const val TAG = "TokenSyncWorker"
        private const val WORK_NAME = "PushTokenSyncWork"

        fun schedule(context: Context, token: String) {
            val data = workDataOf("fcm_token" to token)
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val syncRequest = OneTimeWorkRequestBuilder<TokenSyncWorker>()
                .setInputData(data)
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
    }

    override suspend fun doWork(): Result {
        val token = inputData.getString("fcm_token") ?: return Result.failure()
        val prefs = SecurePreferencesManager(applicationContext)
        val channelId = prefs.getChannelId()
        val deviceId = prefs.getDeviceId()
        val deviceSecret = prefs.getDeviceSecret()
        val relayUrl = prefs.getRelayUrl()

        if (channelId == null || deviceId == null || deviceSecret == null) {
            Log.i(TAG, "Device not paired. Saved token locally for future pairing.")
            return Result.success()
        }

        return try {
            val url = URL("$relayUrl/v1/device")
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                connectTimeout = 15000
                readTimeout = 15000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-Device-Id", deviceId)
                setRequestProperty("X-Device-Secret", deviceSecret)
            }

            val payload = JSONObject().apply {
                put("channel_id", channelId)
                put("apns_token", token)
                put("sandbox", false)
            }

            connection.outputStream.use { os ->
                val input = payload.toString().toByteArray(Charsets.UTF_8)
                os.write(input, 0, input.size)
            }

            val responseCode = connection.responseCode
            connection.disconnect()

            if (responseCode in 200..299) {
                Log.i(TAG, "Token sync completed successfully with status: $responseCode")
                prefs.savePendingToken(null)
                Result.success()
            } else if (responseCode == 401 || responseCode == 403) {
                Log.e(TAG, "Authentication failed with relay ($responseCode). Discarding pairing credentials.")
                prefs.clearAll()
                Result.failure()
            } else {
                Log.w(TAG, "Server returned temporary failure status: $responseCode. Retrying...")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Network connection failure during sync. Re-queuing job.", e)
            Result.retry()
        }
    }
}
