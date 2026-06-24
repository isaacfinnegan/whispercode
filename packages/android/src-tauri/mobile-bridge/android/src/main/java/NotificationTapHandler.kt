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
