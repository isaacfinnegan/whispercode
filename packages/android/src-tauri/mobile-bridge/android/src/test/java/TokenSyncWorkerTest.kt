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

class TokenSyncWorkerTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `sync sends the current token to the FCM token endpoint and clears only pending state`() {
        server.enqueue(MockResponse().setBody("{}"))
        val store = Store(token = "token-1", relay = relay())

        val result = TokenSync(store, PushRelayTokenClient()).sync()

        val request = server.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        assertEquals(TokenSyncResult.SUCCESS, result)
        assertEquals("PUT", request.method)
        assertEquals("/v1/device/token", request.path)
        assertEquals("fcm", body.getString("push_provider"))
        assertEquals("token-1", body.getString("push_token"))
        assertEquals("channel-1", body.getString("channel_id"))
        assertEquals("device-1", body.getString("device_id"))
        assertEquals("secret-1", body.getString("device_secret"))
        assertFalse(store.pending)
        assertEquals("token-1", store.token)
        assertEquals(relay(), store.relay)
        assertEquals(PushCredentials("channel-1", "device-1", "secret-1"), store.credentials)
    }

    @Test
    fun `bad device secret clears credentials while retaining relay and token`() {
        val store = Store()

        val result = TokenSync(store, Relay(RelayResult.Err(RelayError(401, "bad_device_secret", null)))).sync()

        assertEquals(TokenSyncResult.FAILURE, result)
        assertNull(store.credentials)
        assertEquals("token-1", store.token)
        assertTrue(store.pending)
        assertEquals("https://relay.example", store.relay)
    }

    @Test
    fun `device not found clears credentials while retaining relay and token`() {
        val store = Store()

        val result = TokenSync(store, Relay(RelayResult.Err(RelayError(404, "device_not_found", null)))).sync()

        assertEquals(TokenSyncResult.FAILURE, result)
        assertNull(store.credentials)
        assertEquals("token-1", store.token)
        assertTrue(store.pending)
        assertEquals("https://relay.example", store.relay)
    }

    @Test
    fun `temporary relay failures retry`() {
        listOf(
            RelayError(408, "http_error", null),
            RelayError(429, "http_error", null),
            RelayError(500, "http_error", null),
            RelayError(null, "network_error", null),
        ).forEach { error ->
            assertEquals(TokenSyncResult.RETRY, TokenSync(Store(), Relay(RelayResult.Err(error))).sync())
        }
    }

    @Test
    fun `malformed input and nonretryable errors fail`() {
        assertEquals(TokenSyncResult.FAILURE, TokenSync(Store(token = " "), Relay(RelayResult.Ok(JSONObject()))).sync())
        assertEquals(
            TokenSyncResult.FAILURE,
            TokenSync(Store(), Relay(RelayResult.Err(RelayError(400, "invalid_request", null)))).sync(),
        )
    }

    @Test
    fun `missing credentials succeeds without clearing pending token`() {
        val store = Store(credentials = null)

        val result = TokenSync(store, Relay(RelayResult.Ok(JSONObject()))).sync()

        assertEquals(TokenSyncResult.SUCCESS, result)
        assertTrue(store.pending)
        assertEquals("token-1", store.token)
    }

    private fun relay(): String = server.url("/").toString().removeSuffix("/")

    private class Store(
        var token: String? = "token-1",
        var credentials: PushCredentials? = PushCredentials("channel-1", "device-1", "secret-1"),
        var pending: Boolean = true,
        val relay: String = "https://relay.example",
    ) : TokenSyncStore {
        override fun currentToken(): String? = token
        override fun credentials(): PushCredentials? = credentials
        override fun relayUrl(): String = relay
        override fun clearCredentials() {
            credentials = null
        }

        override fun setTokenPending(pending: Boolean) {
            this.pending = pending
        }
    }

    private class Relay(private val result: RelayResult<JSONObject>) : TokenRelay {
        override fun putToken(relay: String, credentials: PushCredentials, token: String): RelayResult<JSONObject> = result
    }
}
