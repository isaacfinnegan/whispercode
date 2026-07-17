package ai.opencode.mobilebridge

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import android.net.Uri
import android.provider.Settings
import android.os.Build
import com.google.android.gms.tasks.OnCompleteListener
import com.google.android.gms.tasks.Task
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import app.tauri.annotation.PermissionCallback

@InvokeArg
class ShareArgs {
    var text: String? = null
    var url: String? = null
}

@InvokeArg
class VersionArgs {
    var version: String? = null
}

@InvokeArg
class PairIdArgs {
    var pair_id: String? = null
}

@InvokeArg
class CredentialsArgs {
    var channel: String? = null
    var device: String? = null
    var secret: String? = null
}

@InvokeArg
class UrlArgs {
    var url: String? = null
}

@InvokeArg
class TestPushArgs {
    var href: String? = null
}

@InvokeArg
class PushPreferencesArgs {
    var complete: Boolean = false
    var approval: Boolean = false
    var question: Boolean = false
    var error: Boolean = false
}

data class PushStateSnapshot(
    val permission: String,
    val token: Boolean,
    val tokenPending: Boolean,
    val paired: Boolean,
    val relay: String,
    val device: String?,
    val pairId: String?,
    val pairStatus: String?,
    val pairExpires: String?,
    val lastCode: String?,
    val lastError: String?,
    val channel: String? = null,
)

data class PushRegistrationSnapshot(
    val device: String,
    val token: String,
    val tokenGeneration: Long,
)

fun pushRegistrationError(permissionGranted: Boolean, token: String?): String? = when {
    !permissionGranted -> "push_permission_required"
    token.isNullOrBlank() -> "push_registration_pending"
    else -> null
}

fun pushRegistrationJson(snapshot: PushRegistrationSnapshot): JSObject = JSObject().apply {
    put("version", 1)
    put("device", snapshot.device)
    put("provider", "fcm")
    put("token", snapshot.token)
    put("token_generation", snapshot.tokenGeneration)
    put("prefs", JSObject().apply {
        put("complete", true)
        put("approval", true)
        put("question", true)
        put("error", true)
    })
}

fun pushStateJson(snapshot: PushStateSnapshot): JSObject = JSObject().apply {
    put("supported", true)
    put("permission", snapshot.permission)
    put("allowed", snapshot.permission == "authorized")
    put("registered", snapshot.token)
    put("paired", snapshot.paired)
    if (snapshot.channel != null) put("channel", snapshot.channel)
    put("generic", false)
    put("diag", JSObject().apply {
        put("token", snapshot.token)
        put("tokenPending", snapshot.tokenPending)
        put("relay", snapshot.relay)
        if (snapshot.device != null) put("device", snapshot.device)
        if (snapshot.pairId != null) put("pairID", snapshot.pairId)
        if (snapshot.pairStatus != null) put("pairStatus", snapshot.pairStatus)
        if (snapshot.pairExpires != null) put("pairExpires", snapshot.pairExpires)
        if (snapshot.lastCode != null) put("lastCode", snapshot.lastCode)
        if (snapshot.lastError != null) put("lastError", snapshot.lastError)
    })
}

fun pairInfoJson(
    id: String?,
    status: String,
    token: String? = null,
    command: String? = null,
    expires: String? = null,
    channel: String? = null,
    device: String? = null,
    message: String? = null,
): JSObject = JSObject().apply {
    if (id != null) put("id", id)
    put("status", status)
    if (token != null) put("token", token)
    if (command != null) put("command", command)
    if (expires != null) put("expires", expires)
    if (channel != null) put("channel", channel)
    if (device != null) put("device", device)
    if (message != null) put("message", message)
}

fun relayUrlChanged(previous: String, current: String): Boolean = previous != current

fun isCurrentPushRequest(generation: Int, currentGeneration: Int, destroyed: Boolean): Boolean =
    !destroyed && generation == currentGeneration

private data class ScanEntry(val host: String, val port: Int, val url: String)
private data class WifiAddressInfo(val address: String, val prefixLength: Int)
private data class PushPermissionRequest(
    val invoke: Invoke,
    val tokenFinished: AtomicBoolean = AtomicBoolean(false),
    val permissionFinished: AtomicBoolean = AtomicBoolean(false),
    val resolved: AtomicBoolean = AtomicBoolean(false),
)

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ]
)
class MobileBridgePlugin(private val activity: Activity) : Plugin(activity), RecognitionListener, PushOpenedPlugin {
    private val main = Handler(Looper.getMainLooper())
    private val scanExecutor = Executors.newSingleThreadExecutor()

    private lateinit var prefs: SecurePreferencesManager
    private lateinit var networkStateListener: NetworkStateListener
    private var isLoaded = false
    private var pushListenersReady = false

    companion object {
        private const val TAG = "MobileBridgePush"
        private const val PUSH_TOKEN_TIMEOUT_MS = 15_000L
        private val PAIR_STATUSES = setOf("pending", "claimed", "active", "expired", "failed")
        private var activeInstance: MobileBridgePlugin? = null

        fun emitPushReceived(payload: JSObject) {
            activeInstance?.let { instance ->
                if (instance.isWebViewLoaded()) {
                    instance.trigger("pushReceived", payload)
                }
            }
        }
    }

    private var recognizer: SpeechRecognizer? = null
    private val pendingPushPermissions = mutableListOf<PushPermissionRequest>()
    private var pushPermissionRequestInFlight = false
    private var pushRequestGeneration = 0
    private var pushDestroyed = false
    private var pushTokenTask: Task<String>? = null
    private var pushTokenListener: OnCompleteListener<String>? = null
    private var pushTokenTimeout: Runnable? = null
    private var pendingStop: Invoke? = null
    private var stopTimeout: Runnable? = null
    private var latestText = ""
    private var recording = false

    private var voiceState = "prewarming"
    private var voiceMessage: String? = null

    @Volatile
    private var scanCancelled = false

    @Volatile
    private var scanTask: Future<*>? = null

    @Volatile
    private var scanGeneration = 0

    override fun load(webView: WebView) {
        super.load(webView)
        pushDestroyed = false
        pushListenersReady = false
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

    override fun onDestroy() {
        super.onDestroy()
        NotificationTapHandler.clearPluginInstance(this)
        pushListenersReady = false
        pushDestroyed = true
        clearPushTokenRequest()
        pendingPushPermissions.forEach { request ->
            if (request.resolved.compareAndSet(false, true)) request.invoke.reject("permission_request_cancelled")
        }
        pendingPushPermissions.clear()
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

    fun isWebViewLoaded(): Boolean = isLoaded

    override fun arePushListenersReady(): Boolean = pushListenersReady

    override fun emitPushOpened(href: String) {
        val payload = JSObject().apply {
            put("href", href)
        }
        trigger("pushOpened", payload)
    }

    @Command
    fun isWhisperReady(invoke: Invoke) {
        invoke.resolve(voicePayload())
    }

    @Command
    fun startRecording(invoke: Invoke) {
        if (recording || pendingStop != null) {
            invoke.resolve(fail("already_recording", "Voice input is already active."))
            return
        }

        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            invoke.resolve(fail("mic_permission_denied", "Microphone permission is required for voice input."))
            return
        }

        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            setVoiceState("error", "Speech recognition is unavailable.")
            invoke.resolve(fail("transcription_unavailable", "Speech recognition is unavailable."))
            setVoiceState("ready")
            return
        }

        try {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(activity)
                recognizer?.setRecognitionListener(this)
            }

            latestText = ""
            recording = true
            setVoiceState("recording")

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }

            recognizer?.startListening(intent)

            val ret = JSObject()
            ret.put("ok", true)
            invoke.resolve(ret)
        } catch (_: Throwable) {
            recording = false
            setVoiceState("error", "Failed to start speech recognition.")
            invoke.resolve(fail("recorder_start_failed", "Failed to start microphone recording."))
            setVoiceState("ready")
        }
    }

    @Command
    fun stopRecording(invoke: Invoke) {
        if (!recording) {
            invoke.resolve(stopResult("", "not_recording", "Voice input is not currently recording."))
            return
        }

        recording = false
        pendingStop = invoke
        setVoiceState("processing")

        try {
            recognizer?.stopListening()
        } catch (_: Throwable) {
            finishStop("", "transcription_failed", "Voice transcription failed.")
            return
        }

        val timeout = Runnable {
            val text = latestText.trim()
            if (text.isNotEmpty()) {
                finishStop(text)
                return@Runnable
            }
            finishStop("", "transcription_failed", "Voice transcription failed.")
        }
        stopTimeout = timeout
        main.postDelayed(timeout, 5000)
    }

    @Command
    fun scanNetwork(invoke: Invoke) {
        val gen = scanGeneration + 1
        scanGeneration = gen
        scanCancelled = false
        scanTask?.cancel(true)

        scanTask = scanExecutor.submit {
            val results = runScan(gen)
            if (isScanStale(gen)) {
                main.post { invoke.resolve(JSObject().put("results", ArrayList<JSObject>())) }
                return@submit
            }
            main.post {
                invoke.resolve(JSObject().put("results", results))
                trigger("scanComplete", JSObject())
            }
        }
    }

    @Command
    fun cancelScan(invoke: Invoke) {
        scanCancelled = true
        scanGeneration += 1
        scanTask?.cancel(true)
        invoke.resolve()
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        val parts = listOfNotNull(args.text?.trim()?.takeIf { it.isNotEmpty() }, args.url?.trim()?.takeIf { it.isNotEmpty() })
        if (parts.isEmpty()) {
            invoke.resolve(JSObject().put("success", false))
            return
        }

        val text = parts.joinToString("\n")
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }

        try {
            activity.startActivity(Intent.createChooser(sendIntent, null))
            invoke.resolve(JSObject().put("success", true))
        } catch (_: Throwable) {
            invoke.resolve(JSObject().put("success", false))
        }
    }

    private fun runScan(gen: Int): ArrayList<JSObject> {
        val info = wifiAddress() ?: return ArrayList()

        val hosts = subnetHosts(info.address, info.prefixLength)
        if (hosts.isEmpty()) return ArrayList()

        val pool = Executors.newFixedThreadPool(48)
        val futures = ArrayList<Future<ScanEntry?>>()

        for (host in hosts) {
            if (isScanStale(gen)) break
            futures.add(pool.submit<ScanEntry?> { probeHost(host, gen) })
        }

        val found = ArrayList<JSObject>()
        for (future in futures) {
            if (isScanStale(gen)) break
            val item = try {
                future.get()
            } catch (_: Throwable) {
                null
            }
            if (item != null) {
                val value = JSObject()
                value.put("host", item.host)
                value.put("port", item.port)
                value.put("url", item.url)
                found.add(value)
                main.post {
                    if (!isScanStale(gen)) trigger("scanResult", value)
                }
            }
        }

        pool.shutdownNow()
        return found
    }

    private fun probeHost(host: String, gen: Int): ScanEntry? {
        if (isScanStale(gen)) return null

        val port = 4096
        val socket = Socket()
        return try {
            socket.connect(InetSocketAddress(host, port), 500)
            socket.close()

            val base = "http://$host:$port"
            if (!checkHealth("$base/global/health", gen) && !checkHealth("$base/health", gen)) return null
            ScanEntry(host = host, port = port, url = base)
        } catch (_: Throwable) {
            null
        } finally {
            try {
                socket.close()
            } catch (_: Throwable) {
            }
        }
    }

    private fun checkHealth(url: String, gen: Int): Boolean {
        repeat(2) {
            if (isScanStale(gen)) return false
            val connection = try {
                URL(url).openConnection() as HttpURLConnection
            } catch (_: Throwable) {
                return false
            }

            val healthy = try {
                connection.requestMethod = "GET"
                connection.connectTimeout = 1200
                connection.readTimeout = 1200
                connection.connect()
                val code = connection.responseCode
                code in 200..299
            } catch (_: Throwable) {
                false
            } finally {
                connection.disconnect()
            }

            if (healthy) return true
        }
        return false
    }

    private fun wifiAddress(): WifiAddressInfo? {
        // Primary: use ConnectivityManager to find the WiFi network's address
        try {
            val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm != null) {
                val network = cm.activeNetwork
                if (network != null) {
                    val caps = cm.getNetworkCapabilities(network)
                    if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        val props = cm.getLinkProperties(network)
                        if (props != null) {
                            for (la in props.linkAddresses) {
                                val addr = la.address
                                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                                    val host = addr.hostAddress ?: continue
                                    return WifiAddressInfo(host, la.prefixLength)
                                }
                            }
                        }
                    }
                }
            }
        } catch (_: Throwable) {}

        // Fallback: iterate NetworkInterface, filter for wlan* (Android WiFi)
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (ni in interfaces) {
                if (!ni.isUp || ni.isLoopback) continue
                val name = ni.name ?: continue
                if (!name.startsWith("wlan")) continue
                for (ia in ni.interfaceAddresses) {
                    val addr = ia.address
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val host = addr.hostAddress ?: continue
                        return WifiAddressInfo(host, ia.networkPrefixLength.toInt())
                    }
                }
            }
        } catch (_: Throwable) {}

        return null
    }

    private fun subnetHosts(ip: String, prefixLength: Int): List<String> {
        val parts = ip.split('.')
        if (parts.size != 4) return emptyList()

        val ipInt = (parts[0].toInt() shl 24) or
                (parts[1].toInt() shl 16) or
                (parts[2].toInt() shl 8) or
                parts[3].toInt()

        // Cap at /20 so scans do not take minutes on large enterprise networks.
        val prefix = prefixLength.coerceIn(20, 30)
        val mask = (-1 shl (32 - prefix))
        val network = ipInt and mask
        val broadcast = network or mask.inv()

        val local24 = ip.substringBeforeLast('.', missingDelimiterValue = "")
        val primary = ArrayList<String>()
        val secondary = ArrayList<String>()
        // Skip network address (+1) and broadcast address (-1)
        for (addr in (network + 1) until broadcast) {
            val host = "${(addr ushr 24) and 0xFF}." +
                    "${(addr ushr 16) and 0xFF}." +
                    "${(addr ushr 8) and 0xFF}." +
                    "${addr and 0xFF}"
            if (host.startsWith("$local24.")) {
                primary.add(host)
            } else {
                secondary.add(host)
            }
        }
        val hosts = ArrayList<String>(primary.size + secondary.size)
        hosts.addAll(primary)
        hosts.addAll(secondary)
        return hosts
    }

    private fun isScanStale(gen: Int): Boolean {
        return scanCancelled || scanGeneration != gen || Thread.currentThread().isInterrupted
    }

    private fun finishStop(text: String, code: String? = null, message: String? = null) {
        val invoke = pendingStop ?: return
        pendingStop = null

        val timeout = stopTimeout
        if (timeout != null) {
            main.removeCallbacks(timeout)
            stopTimeout = null
        }

        if (code == null) {
            invoke.resolve(stopResult(text))
            setVoiceState("ready")
            return
        }

        invoke.resolve(stopResult(text, code, message))
        setVoiceState("error", message)
        setVoiceState("ready")
    }

    private fun stopResult(text: String, code: String? = null, message: String? = null): JSObject {
        val ret = JSObject()
        ret.put("text", text)
        if (code != null) ret.put("code", code)
        if (message != null) ret.put("message", message)
        return ret
    }

    private fun fail(code: String, message: String): JSObject {
        val ret = JSObject()
        ret.put("ok", false)
        ret.put("code", code)
        ret.put("message", message)
        return ret
    }

    private fun voicePayload(): JSObject {
        val ret = JSObject()
        ret.put("state", voiceState)
        ret.put("ready", voiceState == "ready")
        if (!voiceMessage.isNullOrEmpty()) ret.put("message", voiceMessage)
        return ret
    }

    private fun setVoiceState(state: String, message: String? = null) {
        voiceState = state
        voiceMessage = message
        trigger("voiceState", voicePayload())
    }

    override fun onReadyForSpeech(params: Bundle?) {}

    override fun onBeginningOfSpeech() {}

    override fun onRmsChanged(rmsdB: Float) {}

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {}

    override fun onError(error: Int) {
        val reason = when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
            SpeechRecognizer.ERROR_CLIENT -> "Speech recognition client error."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required for voice input."
            SpeechRecognizer.ERROR_NETWORK -> "Network error during speech recognition."
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network timeout."
            SpeechRecognizer.ERROR_NO_MATCH -> "No speech could be recognized."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy."
            SpeechRecognizer.ERROR_SERVER -> "Speech recognition service error."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech recognition timed out."
            else -> "Voice transcription failed."
        }

        if (pendingStop != null) {
            val text = latestText.trim()
            if (text.isNotEmpty()) {
                finishStop(text)
                return
            }
            finishStop("", "transcription_failed", reason)
            return
        }

        recording = false
        setVoiceState("error", reason)
        setVoiceState("ready")
    }

    override fun onResults(results: Bundle?) {
        val text = results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()

        if (pendingStop != null) {
            val finalText = if (text.isNotEmpty()) text else latestText.trim()
            if (finalText.isEmpty()) {
                finishStop("", "transcription_failed", "Voice transcription failed.")
                return
            }
            finishStop(finalText)
            return
        }

        if (text.isNotEmpty()) {
            latestText = text
            val payload = JSObject()
            payload.put("text", text)
            payload.put("isFinal", true)
            trigger("transcription", payload)
        }

        recording = false
        setVoiceState("ready")
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val text = partialResults
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()
        if (text.isEmpty()) return
        latestText = text
        val payload = JSObject()
        payload.put("text", text)
        payload.put("isFinal", false)
        trigger("transcription", payload)
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}

    @Command
    fun getPushState(invoke: Invoke) {
        invoke.resolve(pushState())
    }

    @Command
    fun getPushRegistration(invoke: Invoke) {
        val token = prefs.getFcmToken()
        val error = pushRegistrationError(permissionState() == "authorized", token)
        if (error != null) {
            invoke.reject(error)
            return
        }
        invoke.resolve(
            pushRegistrationJson(
                PushRegistrationSnapshot(
                    device = prefs.getOrCreateDirectDeviceId(),
                    token = token!!,
                    tokenGeneration = prefs.getFcmTokenGeneration(),
                ),
            ),
        )
    }

    @Command
    fun pushListenersReady(invoke: Invoke) {
        pushListenersReady = true
        NotificationTapHandler.flushPendingHref(this)
        invoke.resolve()
    }

    @Command
    fun pushListenersNotReady(invoke: Invoke) {
        pushListenersReady = false
        invoke.resolve()
    }

    @Command
    fun requestPushPermission(invoke: Invoke) {
        if (pushDestroyed) {
            invoke.reject("push_registration_cancelled")
            return
        }

        val request = PushPermissionRequest(invoke)
        pendingPushPermissions.add(request)

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasNotificationPermission()) {
            request.permissionFinished.set(true)
        } else if (!pushPermissionRequestInFlight) {
            pushPermissionRequestInFlight = true
            activity.getSharedPreferences(TAG, Context.MODE_PRIVATE).edit().putBoolean("permission_requested", true).apply()
            requestPermissionForAlias("notifications", invoke, "onPushPermissionResult")
        }

        if (pushTokenTask == null && pendingPushPermissions.any { it !== request && it.tokenFinished.get() }) {
            request.tokenFinished.set(true)
        } else if (pushTokenTask == null) {
            requestPushToken()
        }
        finishPushPermission(request)
    }

    @PermissionCallback
    fun onPushPermissionResult(invoke: Invoke) {
        pushPermissionRequestInFlight = false
        pendingPushPermissions.toList().forEach { request ->
            request.permissionFinished.set(true)
            finishPushPermission(request)
        }
    }

    @Command
    fun beginPushPairing(invoke: Invoke) {
        val args = invoke.parseArgs(VersionArgs::class.java)
        val appVersion = args.version ?: "1.0.0"
        val token = prefs.getFcmToken() ?: return invoke.reject("missing_fcm_token")
        val relay = prefs.getRelayUrl()

        relay { PushRelayClient().beginPair(relay, token, Build.MODEL, appVersion) }.fold(invoke, "pair_not_found") { response ->
            val id = response.optString("pair_id").takeIf { it.isNotBlank() } ?: response.optString("id").takeIf { it.isNotBlank() }
            val pairToken = response.optString("pair_token").takeIf { it.isNotBlank() }
            val expires = response.optString("expires_at").takeIf { it.isNotBlank() }
            val command = response.optString("install_command").takeIf { it.isNotBlank() }
            if (id == null || pairToken == null || expires == null || command == null) {
                rejectRelay(invoke, "relay_unreachable")
                return@fold
            }
            prefs.savePair(id, pairToken, command, expires, "pending")
            triggerPushStateChanged()
            invoke.resolve(pairInfoJson(id, "pending", pairToken, command, expires))
        }
    }

    @Command
    fun getPushPairing(invoke: Invoke) {
        val args = invoke.parseArgs(PairIdArgs::class.java)
        val pairId = args.pair_id ?: prefs.getPairId() ?: return invoke.reject("pair_not_found")
        val relay = prefs.getRelayUrl()

        relay { PushRelayClient().getPair(relay, pairId) }.fold(invoke, "pair_not_found") { response ->
            val status = response.optString("status").takeIf { it in PAIR_STATUSES } ?: run {
                rejectRelay(invoke, "relay_unreachable")
                return@fold
            }
            val id = response.optString("pair_id").takeIf { it.isNotBlank() } ?: pairId
            if (status == "active") {
                val channel = response.optString("channel_id").takeIf { it.isNotBlank() }
                val device = response.optString("device_id").takeIf { it.isNotBlank() }
                val secret = response.optString("device_secret").takeIf { it.isNotBlank() }
                if (channel == null || device == null || secret == null) {
                    rejectRelay(invoke, "relay_unreachable")
                    return@fold
                }
                prefs.saveCredentials(channel, device, secret)
                prefs.savePair(id, prefs.getPairToken(), prefs.getPairCommand(), prefs.getPairExpires(), status)
                scheduleTokenSync()
                triggerPushStateChanged()
                invoke.resolve(pairInfoJson(id, status, prefs.getPairToken(), prefs.getPairCommand(), prefs.getPairExpires(), channel, device))
                return@fold
            }
            prefs.savePair(id, prefs.getPairToken(), prefs.getPairCommand(), prefs.getPairExpires(), status)
            triggerPushStateChanged()
            invoke.resolve(pairInfoJson(id, status, prefs.getPairToken(), prefs.getPairCommand(), prefs.getPairExpires()))
        }
    }

    @Command
    fun setPushCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialsArgs::class.java)
        val channel = args.channel ?: return invoke.reject("missing_channel")
        val device = args.device ?: return invoke.reject("missing_device")
        val secret = args.secret ?: return invoke.reject("missing_secret")

        prefs.saveCredentials(channel, device, secret)
        scheduleTokenSync()
        triggerPushStateChanged()
        invoke.resolve(pushState())
    }

    @Command
    fun clearPushPairing(invoke: Invoke) {
        val relay = prefs.getRelayUrl()
        val deviceId = prefs.getDeviceId()
        val deviceSecret = prefs.getDeviceSecret()

        val channel = prefs.getChannelId()
        if (channel == null || deviceId == null || deviceSecret == null) {
            prefs.clearCredentials()
            prefs.clearPair()
            triggerPushStateChanged()
            invoke.resolve(pushState())
            return
        }

        val credentials = PushCredentials(channel, deviceId, deviceSecret)
        relay { PushRelayClient().delete(relay, credentials) }.fold(invoke, "bad_device_secret", { error ->
            if (error.code == "device_not_found") {
                prefs.clearCredentials()
                prefs.clearPair()
                triggerPushStateChanged()
                invoke.resolve(pushState())
                true
            } else {
                false
            }
        }) {
            prefs.clearCredentials()
            prefs.clearPair()
            triggerPushStateChanged()
            invoke.resolve(pushState())
        }
    }

    @Command
    fun setPushRelayURL(invoke: Invoke) {
        val args = invoke.parseArgs(UrlArgs::class.java)
        val previous = prefs.getRelayUrl()
        when (val result = prefs.normalizeRelayUrl(args.url)) {
            is RelayUrlResult.Valid -> {
                if (relayUrlChanged(previous, result.url)) {
                    if (!RelayCleanupScheduling(prefs) { RelayCleanupWorker.schedule(activity, it) }.schedule()) {
                        return invoke.reject("relay_cleanup_persist_failed")
                    }
                    prefs.saveRelayUrl(result.url)
                    triggerPushStateChanged()
                }
                invoke.resolve(pushState())
            }
            is RelayUrlResult.Invalid -> invoke.reject(result.code)
        }
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
        val relay = prefs.getRelayUrl()
        val credentials = credentials() ?: return invoke.reject("pair_not_found")
        relay { PushRelayClient().test(relay, credentials) }.fold(invoke, "relay_unreachable") { response ->
            invoke.resolve(JSObject().put("success", response.optBoolean("sent", false)))
        }
    }

    @Command
    fun setPushPreferences(invoke: Invoke) {
        val args = invoke.parseArgs(PushPreferencesArgs::class.java)
        val credentials = credentials() ?: return invoke.reject("pair_not_found")
        relay {
            PushRelayClient().putPreferences(
                prefs.getRelayUrl(),
                credentials,
                JSONObject()
                    .put("complete", args.complete)
                    .put("approval", args.approval)
                    .put("question", args.question)
                    .put("error", args.error),
            )
        }.fold(invoke, "relay_unreachable") {
            invoke.resolve()
        }
    }

    private fun triggerPushStateChanged() {
        if (isWebViewLoaded()) {
            trigger("pushStateChanged", pushState())
        }
    }

    private fun pushState(): JSObject = pushStateJson(
        PushStateSnapshot(
            permission = permissionState(),
            token = prefs.getFcmToken() != null,
            tokenPending = prefs.isTokenPending(),
            paired = credentials() != null,
            relay = prefs.getRelayUrl(),
            device = prefs.getDeviceId(),
            pairId = prefs.getPairId(),
            pairStatus = prefs.getPairStatus(),
            pairExpires = prefs.getPairExpires(),
            lastCode = prefs.getLastCode(),
            lastError = prefs.getLastError(),
            channel = prefs.getChannelId(),
        ),
    )

    private fun permissionState(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasNotificationPermission()) return "authorized"
        return if (activity.getSharedPreferences(TAG, Context.MODE_PRIVATE).getBoolean("permission_requested", false)) "denied" else "not-determined"
    }

    private fun hasNotificationPermission(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun credentials(): PushCredentials? {
        val channel = prefs.getChannelId() ?: return null
        val device = prefs.getDeviceId() ?: return null
        val secret = prefs.getDeviceSecret() ?: return null
        return PushCredentials(channel, device, secret)
    }

    private fun scheduleTokenSync() {
        val token = prefs.getFcmToken() ?: return
        prefs.setTokenPending(true)
        TokenSyncWorker.schedule(activity)
    }

    private fun requestPushToken() {
        val generation = pushRequestGeneration + 1
        pushRequestGeneration = generation
        val task = try {
            FirebaseMessaging.getInstance().token
        } catch (_: Exception) {
            rejectPushPermissions("push_registration_failed")
            return
        }
        val applicationContext = activity.applicationContext
        val tokenPrefs = SecurePreferencesManager(applicationContext)
        val handler = main
        val owner = WeakReference(this)
        val listener = OnCompleteListener<String> { completed ->
            handler.post {
                val token = if (completed.isSuccessful) completed.result?.takeIf { it.isNotBlank() } else null
                val plugin = owner.get()
                if (plugin != null && !plugin.pushDestroyed &&
                    !isCurrentPushRequest(generation, plugin.pushRequestGeneration, plugin.pushDestroyed)
                ) return@post
                if (token != null) {
                    tokenPrefs.saveFcmToken(token)
                    tokenPrefs.setTokenPending(true)
                    TokenSyncWorker.schedule(applicationContext)
                }
                if (plugin == null || plugin.pushDestroyed) return@post
                plugin.clearPushTokenRequest()
                plugin.pendingPushPermissions.toList().forEach { request ->
                    request.tokenFinished.set(true)
                    plugin.finishPushPermission(request)
                }
            }
        }
        pushTokenTask = task
        pushTokenListener = listener
        pushTokenTimeout = Runnable {
            if (!isCurrentPushRequest(generation, pushRequestGeneration, pushDestroyed)) return@Runnable
            rejectPushPermissions("push_registration_timeout")
        }
        task.addOnCompleteListener(listener)
        main.postDelayed(pushTokenTimeout!!, PUSH_TOKEN_TIMEOUT_MS)
    }

    private fun clearPushTokenRequest() {
        pushRequestGeneration += 1
        pushTokenTimeout?.let(main::removeCallbacks)
        pushTokenTimeout = null
        pushTokenTask = null
        pushTokenListener = null
    }

    private fun rejectPushPermissions(code: String) {
        clearPushTokenRequest()
        pendingPushPermissions.toList().forEach { request ->
            if (request.resolved.compareAndSet(false, true)) request.invoke.reject(code)
        }
        pendingPushPermissions.clear()
    }

    private fun finishPushPermission(request: PushPermissionRequest) {
        if (request.tokenFinished.get() && request.permissionFinished.get() && request.resolved.compareAndSet(false, true)) {
            pendingPushPermissions.remove(request)
            request.invoke.resolve(pushState())
        }
    }

    private fun <T> relay(request: () -> RelayResult<T>): RelayCall<T> = RelayCall(activity, request)

    private fun rejectRelay(invoke: Invoke, code: String) {
        prefs.saveDiagnostic(code, code)
        triggerPushStateChanged()
        invoke.reject(code)
    }

    private inner class RelayCall<T>(private val activity: Activity, private val request: () -> RelayResult<T>) {
        fun fold(invoke: Invoke, fallback: String, handled: ((RelayError) -> Boolean)? = null, success: (T) -> Unit) {
            Thread {
                when (val result = request()) {
                    is RelayResult.Ok -> activity.runOnUiThread { success(result.value) }
                    is RelayResult.Err -> activity.runOnUiThread {
                        if (handled?.invoke(result.error) == true) return@runOnUiThread
                        val code = when {
                            result.error.code == "bad_device_secret" -> "bad_device_secret"
                            result.error.code == "device_not_found" -> "pair_not_found"
                            result.error.status == 404 -> "pair_not_found"
                            result.error.status == null -> "relay_unreachable"
                            else -> fallback
                        }
                        rejectRelay(invoke, code)
                    }
                }
            }.start()
        }
    }
}
