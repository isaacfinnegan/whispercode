package ai.opencode.mobilebridge

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

data class PushCredentials(val channelId: String, val deviceId: String, val deviceSecret: String)

data class RelayError(val status: Int?, val code: String, val message: String?)

sealed interface RelayResult<out T> {
    data class Ok<T>(val value: T) : RelayResult<T>

    data class Err(val error: RelayError) : RelayResult<Nothing>
}

class PushRelayClient {
    fun beginPair(relay: String, token: String, device: String, version: String): RelayResult<JSONObject> {
        return request(
            relay,
            "/v1/pair/start",
            "POST",
            JSONObject()
                .put("push_provider", "fcm")
                .put("push_token", token)
                .put("device_name", device)
                .put("app_version", version)
        )
    }

    fun getPair(relay: String, pairId: String): RelayResult<JSONObject> = request(relay, "/v1/pair/$pairId", "GET")

    fun putToken(relay: String, credentials: PushCredentials, token: String): RelayResult<JSONObject> {
        return request(
            relay,
            "/v1/device/token",
            "PUT",
            authenticated(credentials)
                .put("push_provider", "fcm")
                .put("push_token", token)
        )
    }

    fun putPreferences(relay: String, credentials: PushCredentials, prefs: JSONObject): RelayResult<JSONObject> {
        return request(relay, "/v1/device/preferences", "PUT", authenticated(credentials).put("prefs", prefs))
    }

    fun test(relay: String, credentials: PushCredentials): RelayResult<JSONObject> {
        return request(relay, "/v1/device/test", "POST", authenticated(credentials))
    }

    fun delete(relay: String, credentials: PushCredentials): RelayResult<JSONObject> {
        return request(relay, "/v1/device", "DELETE", authenticated(credentials))
    }

    private fun authenticated(credentials: PushCredentials): JSONObject {
        return JSONObject()
            .put("channel_id", credentials.channelId)
            .put("device_id", credentials.deviceId)
            .put("device_secret", credentials.deviceSecret)
    }

    private fun request(relay: String, path: String, method: String, body: JSONObject? = null): RelayResult<JSONObject> {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL("${relay.trimEnd('/')}$path").openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 10_000
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
            }

            val status = connection.responseCode
            val response = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = response?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (status in 200..299) return RelayResult.Ok(json)

            val code = json.optString("error", json.optString("code", "http_error"))
            val message = json.optString("message").takeIf { it.isNotBlank() }
            return RelayResult.Err(RelayError(status, code, message))
        } catch (error: Exception) {
            return RelayResult.Err(RelayError(null, "network_error", error.message))
        } finally {
            connection?.disconnect()
        }
    }
}
