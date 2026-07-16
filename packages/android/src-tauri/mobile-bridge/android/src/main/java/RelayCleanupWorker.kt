package ai.opencode.mobilebridge

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

internal enum class RelayCleanupResult { SUCCESS, RETRY }

internal interface RelayCleanupRelay {
    fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*>
}

internal class PushRelayCleanupClient : RelayCleanupRelay {
    override fun deleteDevice(relay: String, credentials: PushCredentials): RelayResult<*> =
        PushRelayClient().delete(relay, credentials)
}

internal class RelayCleanupScheduling(
    private val prefs: SecurePreferencesManager,
    private val enqueue: () -> Unit,
) {
    fun schedule() {
        val channel = prefs.getChannelId() ?: return
        val device = prefs.getDeviceId() ?: return
        val secret = prefs.getDeviceSecret() ?: return
        prefs.savePendingRelayCleanup(prefs.getRelayUrl(), PushCredentials(channel, device, secret))
        enqueue()
    }
}

internal class RelayCleanup(
    private val prefs: SecurePreferencesManager,
    private val relay: RelayCleanupRelay,
) {
    fun cleanup(): RelayCleanupResult {
        val pending = prefs.getPendingRelayCleanup() ?: return RelayCleanupResult.SUCCESS
        return when (val result = relay.deleteDevice(pending.relayUrl, pending.credentials)) {
            is RelayResult.Ok -> {
                prefs.clearPendingRelayCleanup()
                RelayCleanupResult.SUCCESS
            }
            is RelayResult.Err -> {
                if (result.error.code in setOf("bad_device_secret", "device_not_found") || result.error.status in setOf(401, 403, 404)) {
                    prefs.clearPendingRelayCleanup()
                    RelayCleanupResult.SUCCESS
                } else {
                    RelayCleanupResult.RETRY
                }
            }
        }
    }
}

class RelayCleanupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        private const val WORK_NAME = "PushRelayCleanupWork"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<RelayCleanupWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }

    override suspend fun doWork(): Result = when (RelayCleanup(SecurePreferencesManager(applicationContext), PushRelayCleanupClient()).cleanup()) {
        RelayCleanupResult.SUCCESS -> Result.success()
        RelayCleanupResult.RETRY -> Result.retry()
    }
}
