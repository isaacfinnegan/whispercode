package ai.opencode.mobilebridge

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PushRelayClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: PushRelayClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = PushRelayClient()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `beginPair posts FCM token without APNs environment`() {
        server.enqueue(jsonResponse())

        client.beginPair(relay(), "token-1", "Pixel", "1.2.3")

        val request = server.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        assertEquals("POST", request.method)
        assertEquals("/v1/pair/start", request.path)
        assertEquals("fcm", body.getString("push_provider"))
        assertEquals("token-1", body.getString("push_token"))
        assertEquals("Pixel", body.getString("device_name"))
        assertEquals("1.2.3", body.getString("app_version"))
        assertFalse(body.has("apns_env"))
        assertNull(request.getHeader("X-Device-Id"))
        assertNull(request.getHeader("X-Device-Secret"))
    }

    @Test
    fun `getPair requests the pair endpoint`() {
        server.enqueue(jsonResponse())

        client.getPair(relay(), "pair-1")

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/v1/pair/pair-1", request.path)
    }

    @Test
    fun `putToken sends credentials and FCM token without APNs environment`() {
        server.enqueue(jsonResponse())

        client.putToken(relay(), credentials(), "token-1")

        val request = server.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        assertEquals("PUT", request.method)
        assertEquals("/v1/device/token", request.path)
        assertCredentials(body)
        assertEquals("fcm", body.getString("push_provider"))
        assertEquals("token-1", body.getString("push_token"))
        assertFalse(body.has("apns_env"))
        assertNull(request.getHeader("X-Device-Id"))
        assertNull(request.getHeader("X-Device-Secret"))
    }

    @Test
    fun `putPreferences nests exactly the supplied preferences`() {
        server.enqueue(jsonResponse())

        client.putPreferences(
            relay(),
            credentials(),
            JSONObject()
                .put("complete", true)
                .put("approval", false)
                .put("question", true)
                .put("error", false)
        )

        val request = server.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        assertEquals("PUT", request.method)
        assertEquals("/v1/device/preferences", request.path)
        assertCredentials(body)
        assertEquals(setOf("channel_id", "device_id", "device_secret", "prefs"), body.keys().asSequence().toSet())
        val prefs = body.getJSONObject("prefs")
        assertEquals(setOf("complete", "approval", "question", "error"), prefs.keys().asSequence().toSet())
        assertTrue(prefs.getBoolean("complete"))
        assertFalse(prefs.getBoolean("approval"))
        assertTrue(prefs.getBoolean("question"))
        assertFalse(prefs.getBoolean("error"))
        assertNull(request.getHeader("X-Device-Id"))
        assertNull(request.getHeader("X-Device-Secret"))
    }

    @Test
    fun `test sends credentials in its JSON body`() {
        server.enqueue(jsonResponse())

        client.test(relay(), credentials())

        val request = server.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        assertEquals("POST", request.method)
        assertEquals("/v1/device/test", request.path)
        assertCredentials(body)
        assertNull(request.getHeader("X-Device-Id"))
        assertNull(request.getHeader("X-Device-Secret"))
    }

    @Test
    fun `delete sends credentials in its JSON body`() {
        server.enqueue(jsonResponse())

        client.delete(relay(), credentials())

        val request = server.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        assertEquals("DELETE", request.method)
        assertEquals("/v1/device", request.path)
        assertCredentials(body)
        assertNull(request.getHeader("X-Device-Id"))
        assertNull(request.getHeader("X-Device-Secret"))
    }

    @Test
    fun `error response returns typed HTTP status and code`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":\"bad_device_secret\"}"))

        val result = client.delete(relay(), credentials())

        val error = assertErr(result)
        assertEquals(401, error.status)
        assertEquals("bad_device_secret", error.code)
        assertNull(error.message)
    }

    @Test
    fun `non JSON error response preserves HTTP status`() {
        server.enqueue(
            MockResponse()
                .setResponseCode(502)
                .setHeader("Content-Type", "text/html")
                .setBody("<html>Bad Gateway</html>")
        )

        val result = client.delete(relay(), credentials())

        val error = assertErr(result)
        assertEquals(502, error.status)
        assertEquals("http_error", error.code)
        assertNull(error.message)
    }

    private fun relay(): String = server.url("/").toString().removeSuffix("/")

    private fun credentials() = PushCredentials("channel-1", "device-1", "secret-1")

    private fun jsonResponse() = MockResponse().setBody("{}")

    private fun assertCredentials(body: JSONObject) {
        assertEquals("channel-1", body.getString("channel_id"))
        assertEquals("device-1", body.getString("device_id"))
        assertEquals("secret-1", body.getString("device_secret"))
    }

    private fun assertErr(result: RelayResult<JSONObject>): RelayError {
        assertTrue(result is RelayResult.Err)
        return (result as RelayResult.Err).error
    }
}
