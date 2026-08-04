package ai.opencode.mobilebridge

import android.content.Intent
import java.lang.ref.WeakReference

internal interface DeepLinkOpenedPlugin {
    fun areDeepLinkListenersReady(): Boolean
    fun emitDeepLinkOpened(uri: String)
}

object DeepLinkHandler {
    private const val MAX_URI_LENGTH = 2048
    private var pendingUri: String? = null
    private var bridgePlugin: WeakReference<DeepLinkOpenedPlugin>? = null

    internal fun setPluginInstance(plugin: DeepLinkOpenedPlugin) {
        bridgePlugin = WeakReference(plugin)
    }

    internal fun clearPluginInstance(plugin: DeepLinkOpenedPlugin) {
        if (bridgePlugin?.get() === plugin) bridgePlugin = null
    }

    fun handleIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        val raw = uri.toString()
        if (raw.length > MAX_URI_LENGTH) return
        if (uri.scheme != "opencode" || uri.host != "open-session") return
        if (uri.userInfo != null || uri.port != -1) return
        if (!uri.path.isNullOrEmpty() && uri.path != "/") return
        if (uri.fragment != null) return
        deliverOrBuffer(raw)
    }

    private fun deliverOrBuffer(uri: String) {
        val plugin = bridgePlugin?.get()
        if (plugin == null || !plugin.areDeepLinkListenersReady()) {
            pendingUri = uri
            return
        }
        plugin.emitDeepLinkOpened(uri)
    }

    internal fun flushPendingUri(plugin: DeepLinkOpenedPlugin) {
        if (bridgePlugin?.get() !== plugin || !plugin.areDeepLinkListenersReady()) return
        val uri = pendingUri ?: return
        pendingUri = null
        plugin.emitDeepLinkOpened(uri)
    }
}
