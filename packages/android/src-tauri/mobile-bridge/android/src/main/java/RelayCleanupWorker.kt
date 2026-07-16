package ai.opencode.mobilebridge

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

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
    private val enqueue: (String) -> Unit,
) {
    fun schedule(): Boolean {
        val channel = prefs.getChannelId() ?: return true
        val device = prefs.getDeviceId() ?: return true
        val secret = prefs.getDeviceSecret() ?: return true
        val pending = prefs.savePendingRelayCleanup(prefs.getRelayUrl(), PushCredentials(channel, device, secret)) ?: return false
        enqueue(pending.id)
        return true
    }
}

internal class RelayCleanup(
    private val prefs: SecurePreferencesManager,
    private val relay: RelayCleanupRelay,
) {
    fun cleanup(id: String): RelayCleanupResult {
        val pending = prefs.getPendingRelayCleanup(id) ?: return RelayCleanupResult.SUCCESS
        return when (val result = relay.deleteDevice(pending.relayUrl, pending.credentials)) {
            is RelayResult.Ok -> {
                if (prefs.clearPendingRelayCleanup(pending)) RelayCleanupResult.SUCCESS else RelayCleanupResult.RETRY
            }
            is RelayResult.Err -> {
                if (result.error.status == null || result.error.status == 408 || result.error.status in 500..599) {
                    RelayCleanupResult.RETRY
                } else {
                    if (prefs.clearPendingRelayCleanup(pending)) RelayCleanupResult.SUCCESS else RelayCleanupResult.RETRY
                }
            }
        }
    }
}

class RelayCleanupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        fun schedule(context: Context, cleanupID: String) {
            RelayCleanupWorkScheduler.schedule(context, cleanupID)
        }
    }

    override suspend fun doWork(): Result {
        val prefs = SecurePreferencesManager(applicationContext)
        val cleanupID = inputData.getString(RelayCleanupWorkScheduler.INPUT_CLEANUP_ID) ?: return Result.success()
        return when (RelayCleanup(prefs, PushRelayCleanupClient()).cleanup(cleanupID)) {
        RelayCleanupResult.SUCCESS -> Result.success()
        RelayCleanupResult.RETRY -> Result.retry()
        }
    }
}
