package de.drnerdlove.lueckenfueller

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** PUT {apiUrl}/api/app-devices/push-token with the key in a header (never in the address) and {"token": ...}. */
class PushTokenSender : PushSender {
    override fun send(apiUrl: String, deviceKey: String, token: String): PushSendResult {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(apiUrl.trimEnd('/') + "/api/app-devices/push-token")
            if (url.protocol != "https") return PushSendResult.Unavailable
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "PUT"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false // the key must not follow a redirect to another host
            connection.setRequestProperty("X-Device-Key", deviceKey)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.doOutput = true
            val body = org.json.JSONObject().put("token", token).toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            when (connection.responseCode) {
                200 -> PushSendResult.Sent(PushTokenRules.parseInstant(readLimited(connection)))
                401 -> PushSendResult.Unauthorized
                else -> PushSendResult.Unavailable
            }
        } catch (e: IOException) {
            PushSendResult.Unavailable
        } catch (e: RuntimeException) {
            PushSendResult.Unavailable
        } finally {
            connection?.disconnect()
        }
    }

    private fun readLimited(connection: HttpURLConnection): String {
        val out = java.io.ByteArrayOutputStream()
        connection.inputStream.use { input ->
            val buffer = ByteArray(1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                if (out.size() > MAX_BYTES) throw IOException("answer too large")
            }
        }
        return out.toString(Charsets.UTF_8.name())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000
        const val MAX_BYTES = 16 * 1024
    }
}
