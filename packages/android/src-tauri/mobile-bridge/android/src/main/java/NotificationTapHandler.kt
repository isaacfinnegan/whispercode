package ai.opencode.mobilebridge

import android.content.Intent
import java.lang.ref.WeakReference

internal interface PushOpenedPlugin {
    fun arePushListenersReady(): Boolean
    fun emitPushOpened(href: String)
}

object NotificationTapHandler {
    private var pendingHref: String? = null
    private var bridgePlugin: WeakReference<PushOpenedPlugin>? = null

    fun setPluginInstance(plugin: PushOpenedPlugin) {
        bridgePlugin = WeakReference(plugin)
    }

    fun clearPluginInstance(plugin: PushOpenedPlugin) {
        if (bridgePlugin?.get() === plugin) bridgePlugin = null
    }

    fun handleIntent(intent: Intent?) {
        val href = intent?.getStringExtra("push_href") ?: return
        handleHref(href)
    }

    fun handleHref(href: String) {
        val plugin = bridgePlugin?.get()
        if (plugin == null || !plugin.arePushListenersReady()) {
            pendingHref = href
            return
        }
        dispatchHref(plugin, href)
    }

    fun flushPendingHref(plugin: PushOpenedPlugin) {
        if (bridgePlugin?.get() !== plugin || !plugin.arePushListenersReady()) return
        val href = pendingHref ?: return
        pendingHref = null
        dispatchHref(plugin, href)
    }

    private fun dispatchHref(plugin: PushOpenedPlugin, href: String) {
        plugin.emitPushOpened(href)
    }
}
