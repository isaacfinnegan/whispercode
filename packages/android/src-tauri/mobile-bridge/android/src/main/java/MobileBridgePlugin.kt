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
import androidx.core.app.ActivityCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.util.Collections
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.Future

@InvokeArg
class ShareArgs {
    var text: String? = null
    var url: String? = null
}

private data class ScanEntry(val host: String, val port: Int, val url: String)
private data class WifiAddressInfo(val address: String, val prefixLength: Int)

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class MobileBridgePlugin(private val activity: Activity) : Plugin(activity), RecognitionListener {
    private val main = Handler(Looper.getMainLooper())
    private val scanExecutor = Executors.newSingleThreadExecutor()

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

    private var recognizer: SpeechRecognizer? = null
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
}
