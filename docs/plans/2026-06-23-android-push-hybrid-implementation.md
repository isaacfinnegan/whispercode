# Android Push Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a robust, KeyStore-secured Android Push Notification engine into the WhisperCode mobile wrapper, supporting Firebase Cloud Messaging, background delivery, WorkManager token syncing, and SolidJS UI compatibility.

**Architecture:** A native Kotlin Tauri plugin (`MobileBridgePlugin.kt`) manages push state, pairing requests, and custom HTTP operations. Android FCM background services receive message payloads, decrypt/handle them independently of the WebView lifecycle, and utilize Android `WorkManager` for guaranteed push token uploads to the WhisperCode Push Relay.

**Tech Stack:** Kotlin, Android SDK, Firebase Cloud Messaging, Android Jetpack WorkManager, Android Jetpack Security (EncryptedSharedPreferences), SolidJS, Tauri.

---

### Task 1: Gradle Dependencies Setup

**Files:**

- Modify: `packages/android/src-tauri/gen/android/build.gradle.kts`
- Modify: `packages/android/src-tauri/gen/android/app/build.gradle.kts`
- Modify: `packages/android/src-tauri/mobile-bridge/android/build.gradle.kts`

- [ ] **Step 1: Run initial typecheck to establish a baseline**

Run: `bun run typecheck`
Expected: SUCCESS

- [ ] **Step 2: Add Google Services classpath in root gradle buildscript**

Modify `/Users/isaac/Projects/whispercode/packages/android/src-tauri/gen/android/build.gradle.kts` to add the classpath dependency:

```kotlin
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
        classpath("com.google.gms:google-services:4.4.2")
    }
```

- [ ] **Step 3: Apply Google Services plugin and import FCM dependencies in app-level build file**

Modify `/Users/isaac/Projects/whispercode/packages/android/src-tauri/gen/android/app/build.gradle.kts`:

- Add `id("com.google.gms.google-services")` to the `plugins` block:

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
    id("com.google.gms.google-services")
}
```

- Add the Firebase Bill of Materials (BOM) and messaging dependency to the `dependencies` block:

```kotlin
dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")

    // Firebase Cloud Messaging dependencies
    implementation(platform("com.google.firebase:firebase-bom:33.1.1"))
    implementation("com.google.firebase:firebase-messaging-ktx")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}
```

- [ ] **Step 4: Configure Jetpack Security, WorkManager, and lifecycle libraries in mobile-bridge gradle build file**

Modify `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/build.gradle.kts` to add security, work manager, and application lifecycle process libraries to `dependencies`:

```kotlin
dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation(project(":tauri-android"))
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("androidx.lifecycle:lifecycle-process:2.8.2")
}
```

- [ ] **Step 5: Run Android gradle sync**

Run: `cd packages/android && ./src-tauri/gen/android/gradlew --project-dir ./src-tauri/gen/android projects --no-daemon`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
rtk git add packages/android/src-tauri/gen/android/build.gradle.kts packages/android/src-tauri/gen/android/app/build.gradle.kts packages/android/src-tauri/mobile-bridge/android/build.gradle.kts
rtk git commit -m "build(android): configure firebase, keystore, and workmanager dependencies"
```

---

### Task 2: Android Manifest Configuration

**Files:**

- Modify: `packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Declare post notifications permission and FCM background service**

Modify `/Users/isaac/Projects/whispercode/packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml` under `<manifest>` to request POST_NOTIFICATIONS, and register the messaging service inside `<application>`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <!-- AndroidTV support -->
    <uses-feature android:name="android.software.leanback" android:required="false" />

    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.opencode_android"
        android:usesCleartextTraffic="${usesCleartextTraffic}">

        <!-- Custom Firebase Messaging Service -->
        <service
            android:name="ai.opencode.mobilebridge.WhisperFirebaseMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

        <!-- Default channel for background notifications -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="opencode_notifications" />

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:windowSoftInputMode="adjustResize"
            android:launchMode="singleTask"
            android:label="@string/main_activity_title"
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <!-- AndroidTV support -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
          android:name="androidx.core.content.FileProvider"
          android:authorities="${applicationId}.fileprovider"
          android:exported="false"
          android:grantUriPermissions="true">
          <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
```

- [ ] **Step 2: Verify Android Manifest validation**

Run: `cd packages/android && ./src-tauri/gen/android/gradlew --project-dir ./src-tauri/gen/android assembleDebug --no-daemon` (verifies it compiles and builds up to layout phase without configuration error)
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
rtk git add packages/android/src-tauri/gen/android/app/src/main/AndroidManifest.xml
rtk git commit -m "config(android): declare push permissions and WhisperFirebaseMessagingService in manifest"
```

---

### Task 3: Secure Preferences and App Lifecycle Helpers

**Files:**

- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/AppLifecycleTracker.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt`

- [ ] **Step 1: Implement KeyStore-backed Encrypted SharedPreferences manager**

Create `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt`:

```kotlin
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
```

- [ ] **Step 2: Implement activity lifecycle callbacks for app foreground tracking**

Create `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/AppLifecycleTracker.kt`:

```kotlin
package ai.opencode.mobilebridge

import android.app.Activity
import android.app.Application
import android.os.Bundle

object AppLifecycleTracker : Application.ActivityLifecycleCallbacks {
    private var foregroundActivityCount = 0

    fun isAppInForeground(): Boolean = foregroundActivityCount > 0

    override fun onActivityStarted(activity: Activity) {
        foregroundActivityCount++
    }

    override fun onActivityStopped(activity: Activity) {
        foregroundActivityCount = (foregroundActivityCount - 1).coerceAtLeast(0)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
```

- [ ] **Step 3: Implement cached intent handler for tapped notifications**

Create `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt`:

```kotlin
package ai.opencode.mobilebridge

import android.content.Intent
import android.util.Log
import app.tauri.plugin.JSObject

object NotificationTapHandler {
    private const val TAG = "NotificationTap"
    private var pendingHref: String? = null
    private var bridgePlugin: MobileBridgePlugin? = null

    fun setPluginInstance(plugin: MobileBridgePlugin) {
        this.bridgePlugin = plugin
        pendingHref?.let { href ->
            Log.d(TAG, "Plugin ready. Flushing pending deep link: $href")
            dispatchHref(href)
            pendingHref = null
        }
    }

    fun handleIntent(intent: Intent?) {
        val href = intent?.getStringExtra("push_href") ?: return
        Log.d(TAG, "handleIntent: received push_href=$href")
        val plugin = bridgePlugin
        if (plugin != null && plugin.isWebViewLoaded()) {
            dispatchHref(href)
        } else {
            Log.d(TAG, "handleIntent: webview not loaded yet. Caching link.")
            pendingHref = href
        }
    }

    private fun dispatchHref(href: String) {
        val payload = JSObject().apply {
            put("href", href)
        }
        bridgePlugin?.trigger("pushOpened", payload)
    }
}
```

- [ ] **Step 4: Commit**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/src/main/java/SecurePreferencesManager.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/AppLifecycleTracker.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/NotificationTapHandler.kt
rtk git commit -m "feat(android): add secure storage and lifecycle tracking helpers"
```

---

### Task 4: Background Service & Worker Infrastructure

**Files:**

- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt`
- Create: `packages/android/src-tauri/mobile-bridge/android/src/main/java/NetworkStateListener.kt`

- [ ] **Step 1: Implement background token synchronization worker using WorkManager**

Create `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt`:

```kotlin
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
```

- [ ] **Step 2: Implement connectivity manager observer for fast syncs**

Create `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/NetworkStateListener.kt`:

```kotlin
package ai.opencode.mobilebridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

class NetworkStateListener(private val context: Context) {
    companion object {
        private const val TAG = "NetworkStateListener"
    }

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun startMonitoring() {
        if (callback != null) return

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i(TAG, "Internet connection restored. Triggering pending token syncs.")
                val prefs = SecurePreferencesManager(context)
                prefs.getPendingToken()?.let { pendingToken ->
                    TokenSyncWorker.schedule(context, pendingToken)
                }
            }
        }

        try {
            connectivityManager.registerNetworkCallback(request, callback!!)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback listener", e)
        }
    }

    fun stopMonitoring() {
        callback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: Exception) {}
            callback = null
        }
    }
}
```

- [ ] **Step 3: Implement custom FirebaseMessagingService for background deliveries**

Create `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt`:

```kotlin
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
```

- [ ] **Step 4: Commit**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/src/main/java/TokenSyncWorker.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/NetworkStateListener.kt packages/android/src-tauri/mobile-bridge/android/src/main/java/WhisperFirebaseMessagingService.kt
rtk git commit -m "feat(android): add background messaging services and connectivity listeners"
```

---

### Task 5: MainActivity Hooks Integration

**Files:**

- Modify: `packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt`

- [ ] **Step 1: Wire deep linking intent hooks in MainActivity**

Modify `/Users/isaac/Projects/whispercode/packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt` to import `android.content.Intent` and `ai.opencode.mobilebridge.NotificationTapHandler`, and hook `NotificationTapHandler.handleIntent` inside `onCreate` and `onNewIntent`:

```kotlin
package com.devgriffin.whispercode

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.webkit.*
import android.graphics.Bitmap
import android.net.http.SslError
import androidx.core.view.WindowInsetsControllerCompat
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.content.Intent
import ai.opencode.mobilebridge.NotificationTapHandler

class MainActivity : TauriActivity() {
  private val handler = Handler(Looper.getMainLooper())
  private var currentWebView: WebView? = null

  private val themePoller = object : Runnable {
    override fun run() {
      currentWebView?.let { webView ->
        webView.evaluateJavascript("document.documentElement.getAttribute('data-color-scheme')") { value ->
          val isDark = value != null && value.contains("dark")
          updateSystemBars(isDark)
        }
      }
      handler.postDelayed(this, 500)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    NotificationTapHandler.handleIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    NotificationTapHandler.handleIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    currentWebView = webView

    val originalClient = webView.webViewClient
    if (originalClient != null) {
      webView.webViewClient = DelegatingWebViewClient(originalClient)
    }

    handler.post(themePoller)
  }

  override fun onDestroy() {
    handler.removeCallbacks(themePoller)
    super.onDestroy()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      themePoller.run()
    }
  }

  private fun updateSystemBars(isNightMode: Boolean) {
    val window = this.window
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = !isNightMode
  }
}
```

- [ ] **Step 2: Commit**

```bash
rtk git add packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt
rtk git commit -m "feat(android): wire deep linking intent hooks in MainActivity"
```

---

### Task 6: Native Plugin Commands Integration

**Files:**

- Modify: `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`

- [ ] **Step 1: Declare push endpoints and management methods inside MobileBridgePlugin**

Modify `/Users/isaac/Projects/whispercode/packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt` to add support for FCM push notification commands, KeyStore configuration management, and pairing hooks:

- Add necessary Kotlin imports to the top:

```kotlin
import android.net.Uri
import android.provider.Settings
import android.os.Build
import androidx.core.app.ActivityCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
```

- Define push properties and active instance tracking inside the `MobileBridgePlugin` class:

```kotlin
    private lateinit var prefs: SecurePreferencesManager
    private lateinit var networkStateListener: NetworkStateListener
    private var isLoaded = false

    companion object {
        private const val TAG = "MobileBridgePush"
        private const val PERMISSION_REQUEST_CODE = 4072
        private var activeInstance: MobileBridgePlugin? = null

        fun emitPushReceived(payload: JSObject) {
            activeInstance?.let { instance ->
                if (instance.isWebViewLoaded()) {
                    instance.trigger("pushReceived", payload)
                }
            }
        }
    }
```

- Hook helper initialization inside `load`:

```kotlin
    override fun load(webView: WebView) {
        super.load(webView)
        setVoiceState("ready")

        prefs = SecurePreferencesManager(activity)
        networkStateListener = NetworkStateListener(activity)
        networkStateListener.startMonitoring()

        val app = activity.application
        app.registerActivityLifecycleCallbacks(AppLifecycleTracker)

        activeInstance = this
        isLoaded = true
        NotificationTapHandler.setPluginInstance(this)
    }
```

- Hook cleanups inside `onDestroy`:

```kotlin
    override fun onDestroy() {
        super.onDestroy()
        scanCancelled = true
        scanTask?.cancel(true)
        scanExecutor.shutdownNow()
        recording = false
        pendingStop = null
        val timeout = stopTimeout
        if (timeout != null) {
            main.removeCallbacks(timeout)
            stopTimeout = null
        }
        try {
            recognizer?.destroy()
        } catch (_: Throwable) {
        }
        recognizer = null

        networkStateListener.stopMonitoring()
        val app = activity.application
        app.unregisterActivityLifecycleCallbacks(AppLifecycleTracker)

        if (activeInstance == this) {
            activeInstance = null
        }
        isLoaded = false
    }
```

- Add the utility indicator `isWebViewLoaded()`:

```kotlin
    fun isWebViewLoaded(): Boolean = isLoaded
```

- Implement tauri commands at the bottom of the class:

```kotlin
    @Command
    fun getPushState(invoke: Invoke) {
        val hasToken = prefs.getPendingToken() != null
        val hasPerm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

        val state = JSObject().apply {
            put("supported", true)
            put("permission", if (hasPerm) "authorized" else "not-determined")
            put("allowed", hasPerm)
            put("registered", hasToken)
            put("paired", prefs.getDeviceSecret() != null)
            put("channel", prefs.getChannelId())
            put("generic", false)
            put("diag", JSObject().apply {
                put("token", hasToken)
                put("relay", prefs.getRelayUrl())
                put("device", prefs.getDeviceId())
            })
        }
        invoke.resolve(state)
    }

    @Command
    fun requestPushPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val hasPerm = ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!hasPerm) {
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    PERMISSION_REQUEST_CODE
                )
            }
        }

        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) {
                val token = task.result
                prefs.savePendingToken(token)
                TokenSyncWorker.schedule(activity, token)
            }
            getPushState(invoke)
        }
    }

    @Command
    fun beginPushPairing(invoke: Invoke) {
        val appVersion = invoke.getString("version") ?: "1.0.0"
        val token = prefs.getPendingToken() ?: return invoke.reject("missing_fcm_token")
        val relay = prefs.getRelayUrl()

        val payload = JSONObject().apply {
            put("apns_token", token)
            put("device_name", Build.MODEL)
            put("app_version", appVersion)
            put("apns_env", "production")
        }

        executeAsyncHttpRequest("$relay/v1/pair/start", "POST", payload) { response, error ->
            if (error != null) {
                invoke.reject("Pair start request failed: $error")
            } else if (response != null) {
                val resultObj = JSObject().apply {
                    put("id", response.getString("id"))
                    put("command", response.getString("command"))
                    put("expires_at", response.getString("expires_at"))
                }
                invoke.resolve(resultObj)
            } else {
                invoke.reject("Empty response payload")
            }
        }
    }

    @Command
    fun getPushPairing(invoke: Invoke) {
        val pairId = invoke.getString("pair_id") ?: return invoke.reject("missing_pair_id")
        val relay = prefs.getRelayUrl()

        executeAsyncHttpRequest("$relay/v1/pair/$pairId", "GET", null) { response, error ->
            if (error != null) {
                invoke.reject("Pair lookup request failed: $error")
            } else if (response != null) {
                val status = response.getString("status")
                val resultObj = JSObject().apply {
                    put("status", status)
                }

                if (status == "active") {
                    val channelId = response.getString("channel_id")
                    val deviceId = response.getString("device_id")
                    val deviceSecret = response.getString("device_secret")

                    prefs.saveCredentials(channelId, deviceId, deviceSecret)

                    resultObj.put("channel_id", channelId)
                    resultObj.put("device_id", deviceId)
                    resultObj.put("device_secret", deviceSecret)

                    triggerPushStateChanged()
                }
                invoke.resolve(resultObj)
            } else {
                invoke.reject("Empty pairing status payload")
            }
        }
    }

    @Command
    fun setPushCredentials(invoke: Invoke) {
        val channel = invoke.getString("channel") ?: return invoke.reject("missing_channel")
        val device = invoke.getString("device") ?: return invoke.reject("missing_device")
        val secret = invoke.getString("secret") ?: return invoke.reject("missing_secret")

        prefs.saveCredentials(channel, device, secret)
        triggerPushStateChanged()
        getPushState(invoke)
    }

    @Command
    fun clearPushPairing(invoke: Invoke) {
        val relay = prefs.getRelayUrl()
        val deviceId = prefs.getDeviceId()
        val deviceSecret = prefs.getDeviceSecret()

        if (deviceId != null && deviceSecret != null) {
            val headers = mapOf(
                "X-Device-Id" to deviceId,
                "X-Device-Secret" to deviceSecret
            )
            executeAsyncHttpRequest("$relay/v1/device", "DELETE", null, headers) { _, _ -> }
        }

        prefs.clearAll()
        triggerPushStateChanged()
        getPushState(invoke)
    }

    @Command
    fun setPushRelayURL(invoke: Invoke) {
        val url = invoke.getString("url")
        prefs.saveRelayUrl(url)
        getPushState(invoke)
    }

    @Command
    fun openSystemSettings(invoke: Invoke) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", activity.packageName, null)
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to launch system settings: ${e.message}")
        }
    }

    @Command
    fun testPush(invoke: Invoke) {
        val href = invoke.getString("href") ?: ""
        val relay = prefs.getRelayUrl()
        val channelId = prefs.getChannelId() ?: return invoke.resolve(false)

        val payload = JSONObject().apply {
            put("channel_id", channelId)
            put("title", "Test Notification")
            put("body", "This is a test notification from WhisperCode.")
            put("href", href)
        }

        executeAsyncHttpRequest("$relay/v1/send", "POST", payload) { response, error ->
            invoke.resolve(error == null)
        }
    }

    @Command
    fun setPushPreferences(invoke: Invoke) {
        invoke.resolve()
    }

    private fun triggerPushStateChanged() {
        if (isWebViewLoaded()) {
            val state = JSObject().apply {
                put("paired", prefs.getDeviceSecret() != null)
                put("channel", prefs.getChannelId())
            }
            trigger("pushStateChanged", state)
        }
    }

    private fun executeAsyncHttpRequest(
        urlStr: String,
        method: String,
        payload: JSONObject?,
        headers: Map<String, String>? = null,
        callback: (JSONObject?, String?) -> Unit
    ) {
        Thread {
            var connection: HttpURLConnection? = null
            try {
                val url = URL(urlStr)
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = method
                    connectTimeout = 10000
                    readTimeout = 10000
                    headers?.forEach { (key, value) -> setRequestProperty(key, value) }

                    if (payload != null) {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                        outputStream.use { os ->
                            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
                            os.write(bytes, 0, bytes.size)
                        }
                    }
                }

                val responseCode = connection.responseCode
                if (responseCode in 200..299) {
                    val body = connection.inputStream.bufferedReader().use { it.readText() }
                    val json = if (body.trim().isNotEmpty()) JSONObject(body) else JSONObject()
                    activity.runOnUiThread { callback(json, null) }
                } else {
                    val errorBody = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    activity.runOnUiThread { callback(null, "HTTP $responseCode: $errorBody") }
                }
            } catch (e: Exception) {
                activity.runOnUiThread { callback(null, e.message) }
            } finally {
                connection?.disconnect()
            }
        }.start()
    }
```

- [ ] **Step 2: Commit**

```bash
rtk git add packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt
rtk git commit -m "feat(android): implement push command handlers inside MobileBridgePlugin"
```

---

### Task 7: SolidJS App Bridge & Platform Mapping

**Files:**

- Modify: `packages/android/src/entry-android.tsx`

- [ ] **Step 1: Map native push methods to Platform provider in entry-android.tsx**

Modify `packages/android/src/entry-android.tsx` to handle push notification statuses and pairing events downstream:

- Import required push typings from `@opencode-ai/app`:

```typescript
import { type PairInfo, type PushState, type PushPrefs, type PushCred } from "@opencode-ai/app"
```

- Define push state signals inside the `App` component:

```typescript
const [push, setPush] = createSignal<PushState | undefined>()

const refreshPush = async () => {
  const result = await bridge.sendAsync<PushState>("getPushState")
  setPush(result)
  return result
}
```

- Add the push interfaces to the local `platform: Platform` configuration object:

```typescript
    pushState: push,
    getPushState: async () => refreshPush(),
    requestPushPermission: async () => {
      const result = await bridge.sendAsync<PushState>("requestPushPermission")
      setPush(result)
      return result
    },
    openSystemSettings: async () => {
      await bridge.sendAsync("openSystemSettings")
    },
    testPush: async (href?: string) => {
      const result = await bridge.sendAsync<boolean>("testPush", { href })
      return result ?? false
    },
    beginPushPairing: async () => {
      const result = await bridge.sendAsync<PairInfo>("beginPushPairing", { version: pkg.version })
      if (!result) throw new Error("Push pairing unavailable")
      return result
    },
    getPushPairing: async () => {
      const result = await bridge.sendAsync<PairInfo>("getPushPairing")
      return result ?? undefined
    },
    setPushPreferences: async (prefs: PushPrefs) => {
      await bridge.sendAsync("setPushPreferences", prefs)
    },
    setPushRelayURL: async (url?: string) => {
      await bridge.sendAsync("setPushRelayURL", { url })
    },
    setPushCredentials: async (input: PushCred) => {
      const result = await bridge.sendAsync<PushState>("setPushCredentials", input)
      setPush(result)
      return result
    },
    clearPushPairing: async () => {
      const result = await bridge.sendAsync<PushState>("clearPushPairing")
      setPush(result)
      return result
    },
```

- Bind native state changes and tapped link hooks inside `onMount`:

```typescript
onMount(() => {
  document.documentElement.dataset.platform = "android"
  void refreshVoice()
  void refreshPush()

  const handleClick = (event: MouseEvent) => {
    const link = (event.target as HTMLElement | null)?.closest("a.external-link") as HTMLAnchorElement | null
    if (!link?.href) return
    event.preventDefault()
    platform.openLink(link.href)
  }

  const onFocus = () => emitResume()
  const onVisible = () => {
    if (document.visibilityState !== "visible") return
    emitResume()
  }

  const stopListening = bridge.on("transcription", (payload) => {
    if (!payload || typeof payload !== "object") return
    const detail = payload as { text?: string; isFinal?: boolean }
    if (typeof detail.text !== "string") return
    emitTranscription(detail.text, detail.isFinal)
  })

  const stopVoiceState = bridge.on("voiceState", (payload) => {
    const status = normalizeStatus(payload)
    if (!status) return
    setVoice(status)
    if (status.state === "error") showVoiceError(status.message)
  })

  const stopPushState = bridge.on("pushStateChanged", (payload) => {
    setPush(payload as PushState)
  })

  const stopPushOpened = bridge.on("pushOpened", (payload) => {
    const { href } = payload as { href?: string }
    if (href) {
      window.dispatchEvent(new CustomEvent("opencode:pushOpened", { detail: { href } }))
    }
  })

  document.addEventListener("click", handleClick)
  window.addEventListener("focus", onFocus)
  document.addEventListener("visibilitychange", onVisible)
  onCleanup(() => {
    document.removeEventListener("click", handleClick)
    window.removeEventListener("focus", onFocus)
    document.removeEventListener("visibilitychange", onVisible)
    stopListening()
    stopVoiceState()
    stopPushState()
    stopPushOpened()
  })
})
```

- [ ] **Step 2: Commit**

```bash
rtk git add packages/android/src/entry-android.tsx
rtk git commit -m "feat(android): wire push bridge hooks and settings callbacks in entry-android.tsx"
```

---

### Task 8: Verification, Test and Build

- [ ] **Step 1: Verify TypeScript compiler**

Run: `bun run typecheck`
Expected: SUCCESS

- [ ] **Step 2: Verify application unit tests**

Run: `bun run --cwd packages/app test:unit`
Expected: SUCCESS (all 490 tests pass)

- [ ] **Step 3: Compile debug Android build to verify compiler and asset output**

Run: `cd packages/android && PATH="/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" bun run tauri android build --apk --target aarch64 --debug`
Expected: SUCCESS

- [ ] **Step 4: Commit and finalize**

```bash
git log -n 5 --oneline
```
