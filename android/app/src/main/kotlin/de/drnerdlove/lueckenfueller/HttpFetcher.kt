package de.drnerdlove.lueckenfueller

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** GET {apiUrl}/api/app-notifications?after=N with the key in a header (never in the address). */
class HttpFetcher : NotificationFetcher {
    override fun fetch(apiUrl: String, deviceKey: String, after: Long): FetchResult {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(apiUrl.trimEnd('/') + "/api/app-notifications?after=$after")
            if (url.protocol != "https") return FetchResult.Unavailable
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false // the key must not follow a redirect to another host
            connection.setRequestProperty("X-Device-Key", deviceKey)
            connection.setRequestProperty("Accept", "application/json")
            when (connection.responseCode) {
                200 -> FetchResult.Body(readLimited(connection))
                401 -> FetchResult.Unauthorized
                else -> FetchResult.Unavailable
            }
        } catch (e: IOException) {
            FetchResult.Unavailable
        } catch (e: RuntimeException) {
            FetchResult.Unavailable
        } finally {
            connection?.disconnect()
        }
    }

    private fun readLimited(connection: HttpURLConnection): String {
        val out = java.io.ByteArrayOutputStream()
        connection.inputStream.use { input ->
            val buffer = ByteArray(8192)
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
        const val MAX_BYTES = 2 * 1024 * 1024
    }
}
