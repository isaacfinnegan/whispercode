package ai.opencode.mobilebridge

import android.content.Intent
import app.tauri.plugin.JSObject
import java.lang.ref.WeakReference

object NotificationTapHandler {
    private var pendingHref: String? = null
    private var bridgePlugin: WeakReference<MobileBridgePlugin>? = null

    fun setPluginInstance(plugin: MobileBridgePlugin) {
        bridgePlugin = WeakReference(plugin)
    }

    fun clearPluginInstance(plugin: MobileBridgePlugin) {
        if (bridgePlugin?.get() === plugin) bridgePlugin = null
    }

    fun takePendingHref(): String? {
        val href = pendingHref
        pendingHref = null
        return href
    }

    fun handleIntent(intent: Intent?) {
        val href = intent?.getStringExtra("push_href") ?: return
        val plugin = bridgePlugin?.get()
        if (plugin != null && plugin.isWebViewLoaded()) {
            dispatchHref(plugin, href)
        } else {
            pendingHref = href
        }
    }

    private fun dispatchHref(plugin: MobileBridgePlugin, href: String) {
        val payload = JSObject().apply {
            put("href", href)
        }
        plugin.trigger("pushOpened", payload)
    }
}
