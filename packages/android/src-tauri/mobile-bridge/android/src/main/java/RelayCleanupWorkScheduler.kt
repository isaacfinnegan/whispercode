package ai.opencode.mobilebridge

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

internal object RelayCleanupWorkScheduler {
    private const val WORK_NAME = "PushRelayCleanupWork"
    internal const val INPUT_CLEANUP_ID = "cleanup_id"

    fun schedule(context: Context, cleanupID: String) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<RelayCleanupWorker>()
            .setInputData(Data.Builder().putString(INPUT_CLEANUP_ID, cleanupID).build())
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("$WORK_NAME:$cleanupID", ExistingWorkPolicy.KEEP, request)
    }
}
