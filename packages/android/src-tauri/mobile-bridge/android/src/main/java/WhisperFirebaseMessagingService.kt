package ai.opencode.mobilebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.tauri.plugin.JSObject

class WhisperFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        private const val TAG = "WhisperFCM"
        const val CHANNEL_ID = "opencode_notifications"
        private const val CHANNEL_NAME = "Whisper Notifications"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val payload = remoteMessage.data
        val title = payload["title"] ?: "New Message"
        val body = payload["body"] ?: ""
        val href = payload["href"]
        
        Log.d(TAG, "Notification received: title=$title, body=$body, href=$href")

        val prefs = SecurePreferencesManager(applicationContext)
        val channelId = prefs.getChannelId()

        if (channelId != null && payload["channel_id"] != channelId) {
            Log.w(TAG, "Received message targeting channel mismatch. Ignoring.")
            return
        }

        if (AppLifecycleTracker.isAppInForeground()) {
            val jsPayload = JSObject().apply {
                put("title", title)
                put("body", body)
                put("href", href)
            }
            MobileBridgePlugin.emitPushReceived(jsPayload)
        } else {
            showSystemNotification(title, body, href)
        }
    }

    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM Token rotated: $token")
        val prefs = SecurePreferencesManager(applicationContext)
        prefs.savePendingToken(token)
        TokenSyncWorker.schedule(applicationContext, token)
    }

    private fun showSystemNotification(title: String, body: String, href: String?) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

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
            System.currentTimeMillis().toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val smallIconId = applicationContext.resources.getIdentifier("ic_launcher", "mipmap", packageName)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(smallIconId)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .build()

        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }
}
