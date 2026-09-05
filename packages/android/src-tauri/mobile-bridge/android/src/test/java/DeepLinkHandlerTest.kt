package ai.opencode.mobilebridge

import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DeepLinkHandlerTest {
    private class FakePlugin(var ready: Boolean = false) : DeepLinkOpenedPlugin {
        val opened = mutableListOf<String>()

        override fun areDeepLinkListenersReady() = ready

        override fun emitDeepLinkOpened(uri: String) {
            opened.add(uri)
        }
    }

    private fun intent(uri: String) = Intent(Intent.ACTION_VIEW, Uri.parse(uri))

    @Test
    fun `buffers a cold link and flushes it once when ready`() {
        val plugin = FakePlugin()
        val uri = "opencode://open-session?server=https%3A%2F%2Fcode.example.com&session=ses_one"
        DeepLinkHandler.setPluginInstance(plugin)

        DeepLinkHandler.handleIntent(intent(uri))
        assertEquals(emptyList<String>(), plugin.opened)

        plugin.ready = true
        DeepLinkHandler.flushPendingUri(plugin)
        DeepLinkHandler.flushPendingUri(plugin)
        assertEquals(listOf(uri), plugin.opened)
        DeepLinkHandler.clearPluginInstance(plugin)
    }

    @Test
    fun `dispatches a warm link immediately`() {
        val plugin = FakePlugin(ready = true)
        val uri = "opencode://open-session?server=http%3A%2F%2Flan.local&session=ses_two"
        DeepLinkHandler.setPluginInstance(plugin)

        DeepLinkHandler.handleIntent(intent(uri))

        assertEquals(listOf(uri), plugin.opened)
        DeepLinkHandler.clearPluginInstance(plugin)
    }

    @Test
    fun `keeps only the latest link received before readiness`() {
        val plugin = FakePlugin()
        val first = "opencode://open-session?server=https%3A%2F%2Fa.example&session=one"
        val second = "opencode://open-session?server=https%3A%2F%2Fb.example&session=two"
        DeepLinkHandler.setPluginInstance(plugin)

        DeepLinkHandler.handleIntent(intent(first))
        DeepLinkHandler.handleIntent(intent(second))
        plugin.ready = true
        DeepLinkHandler.flushPendingUri(plugin)

        assertEquals(listOf(second), plugin.opened)
        DeepLinkHandler.clearPluginInstance(plugin)
    }

    @Test
    fun `rejects invalid transport envelopes`() {
        val plugin = FakePlugin(ready = true)
        DeepLinkHandler.setPluginInstance(plugin)
        val valid = "?server=https%3A%2F%2Fcode.example.com&session=ses_one"
        val invalid = listOf(
            Intent(Intent.ACTION_SEND, Uri.parse("opencode://open-session$valid")),
            Intent(Intent.ACTION_VIEW),
            intent("https://open-session$valid"),
            intent("opencode://other$valid"),
            intent("opencode://user@open-session$valid"),
            intent("opencode://open-session:123$valid"),
            intent("opencode://open-session/path$valid"),
            intent("opencode://open-session$valid#fragment"),
            intent("opencode://open-session?padding=${"a".repeat(2048)}"),
        )

        invalid.forEach(DeepLinkHandler::handleIntent)

        assertEquals(emptyList<String>(), plugin.opened)
        DeepLinkHandler.clearPluginInstance(plugin)
    }

    @Test
    fun `does not emit through a cleared plugin`() {
        val plugin = FakePlugin(ready = true)
        val uri = "opencode://open-session?server=https%3A%2F%2Fcode.example.com&session=ses_three"
        DeepLinkHandler.setPluginInstance(plugin)
        DeepLinkHandler.clearPluginInstance(plugin)

        DeepLinkHandler.handleIntent(intent(uri))

        assertEquals(emptyList<String>(), plugin.opened)

        val replacement = FakePlugin(ready = true)
        DeepLinkHandler.setPluginInstance(replacement)
        DeepLinkHandler.flushPendingUri(replacement)
        assertEquals(listOf(uri), replacement.opened)
        DeepLinkHandler.clearPluginInstance(replacement)
    }
}
