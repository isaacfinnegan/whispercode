package ai.opencode.mobilebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.tauri.plugin.JSObject

internal enum class MessageDecision { IGNORE, EMIT, NOTIFY }

internal fun decideMessage(
    channel: String?,
    device: String?,
    secret: String?,
    directDeviceId: String?,
    data: Map<String, String>,
    foreground: Boolean,
): MessageDecision {
    val isRelay = !channel.isNullOrBlank() && !device.isNullOrBlank() && !secret.isNullOrBlank() &&
        data["channel_id"] == channel && data["v"] == "1"
    val isDirect = !directDeviceId.isNullOrBlank() &&
        data["device_id"] == directDeviceId
    if (!isRelay && !isDirect) return MessageDecision.IGNORE
    if ((data["title"]?.length ?: 0) > 100) return MessageDecision.IGNORE
    if ((data["body"]?.length ?: 0) > 500) return MessageDecision.IGNORE
    if ((data["href"]?.length ?: 0) > 2048) return MessageDecision.IGNORE
    return if (foreground) MessageDecision.EMIT else MessageDecision.NOTIFY
}

class WhisperFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        const val CHANNEL_ID = "opencode_notifications"
        private const val CHANNEL_NAME = "Whisper Notifications"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val payload = remoteMessage.data
        val prefs = SecurePreferencesManager(applicationContext)
        when (decideMessage(
            prefs.getChannelId(),
            prefs.getDeviceId(),
            prefs.getDeviceSecret(),
            prefs.getDirectDeviceId(),
            payload,
            AppLifecycleTracker.isAppInForeground(),
        )) {
            MessageDecision.IGNORE -> return
            MessageDecision.EMIT -> {
                val title = payload["title"] ?: "New Message"
                val body = payload["body"] ?: ""
                val href = payload["href"]
            val jsPayload = JSObject().apply {
                put("title", title)
                put("body", body)
                put("href", href)
            }
            MobileBridgePlugin.emitPushReceived(jsPayload)
            }
            MessageDecision.NOTIFY -> showSystemNotification(
                payload["title"] ?: "New Message",
                payload["body"] ?: "",
                payload["href"],
                payload["delivery_id"],
            )
        }
    }

    override fun onNewToken(token: String) {
        val prefs = SecurePreferencesManager(applicationContext)
        prefs.saveFcmToken(token)
        prefs.setTokenPending(true)
        TokenSyncWorker.schedule(applicationContext)
    }

    private fun showSystemNotification(title: String, body: String, href: String?, deliveryId: String?) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!notificationManager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Chat and connection alert notifications"
                enableLights(true)
                enableVibration(true)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (href != null) {
                putExtra("push_href", href)
            }
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            deliveryId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .build()

        notificationManager.notify(deliveryId?.hashCode() ?: 0, notification)
    }
}
