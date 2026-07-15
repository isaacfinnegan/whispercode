package ai.opencode.mobilebridge

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationTapHandlerTest {
    @Test
    fun buffersTapUntilAcknowledgedThenFlushesOnce() {
        val plugin = TapPlugin()
        NotificationTapHandler.setPluginInstance(plugin)

        NotificationTapHandler.handleHref("/session/one")
        assertEquals(emptyList<String>(), plugin.opened)

        plugin.listenersReady = true
        NotificationTapHandler.flushPendingHref(plugin)
        NotificationTapHandler.flushPendingHref(plugin)

        assertEquals(listOf("/session/one"), plugin.opened)
        NotificationTapHandler.clearPluginInstance(plugin)
    }

    @Test
    fun buffersTapAfterReadinessIsRevokedUntilReacknowledged() {
        val plugin = TapPlugin().apply { listenersReady = true }
        NotificationTapHandler.setPluginInstance(plugin)
        NotificationTapHandler.handleHref("/session/one")

        plugin.listenersReady = false
        NotificationTapHandler.handleHref("/session/two")
        assertEquals(listOf("/session/one"), plugin.opened)

        plugin.listenersReady = true
        NotificationTapHandler.flushPendingHref(plugin)
        NotificationTapHandler.flushPendingHref(plugin)

        assertEquals(listOf("/session/one", "/session/two"), plugin.opened)
        NotificationTapHandler.clearPluginInstance(plugin)
    }

    private class TapPlugin : PushOpenedPlugin {
        var listenersReady = false
        val opened = mutableListOf<String>()

        override fun arePushListenersReady(): Boolean = listenersReady

        override fun emitPushOpened(href: String) {
            opened += href
        }
    }
}
