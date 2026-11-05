package de.drnerdlove.lueckenfueller

import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * GET with redirects followed by hand (GitHub answers 302 to its release storage): https only, only to the hosts in
 * `AppUpdate.ALLOWED_HOSTS`, at most `AppUpdate.MAX_HOPS` redirects. Nothing is sent but the request itself.
 */
class AppUpdateHttp {
    /** The text at `url` (UTF-8), or null on any failure, a non-200 answer or more than `maxBytes`. */
    fun fetchText(url: String, maxBytes: Int): String? = try {
        val out = java.io.ByteArrayOutputStream()
        if (get(url, maxBytes.toLong(), out) == null) null else out.toString(Charsets.UTF_8.name())
    } catch (e: IOException) {
        null
    } catch (e: RuntimeException) {
        null
    }

    /** Downloads `url` into `target` and returns the SHA-256 (hex) of what was written, or null on any failure. */
    fun download(url: String, target: File, maxBytes: Long): String? = try {
        target.outputStream().use { get(url, maxBytes, it) }
    } catch (e: IOException) {
        null
    } catch (e: RuntimeException) {
        null
    }

    /** Writes the body to `out`; returns its SHA-256 (hex), or null when the answer is not a plain 200. */
    private fun get(start: String, maxBytes: Long, out: OutputStream): String? {
        var url = start
        if (!AppUpdate.isAllowedUrl(url)) return null
        for (hop in 0..AppUpdate.MAX_HOPS) {
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "GET"
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Accept", "application/octet-stream, application/json")
                when (connection.responseCode) {
                    200 -> return copyLimited(connection, maxBytes, out)
                    301, 302, 303, 307, 308 -> url = AppUpdate.nextHop(url, connection.getHeaderField("Location")) ?: return null
                    else -> return null
                }
            } finally {
                connection.disconnect()
            }
        }
        return null // too many redirects
    }

    private fun copyLimited(connection: HttpURLConnection, maxBytes: Long, out: OutputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        connection.inputStream.use { input ->
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                total += n
                if (total > maxBytes) throw IOException("answer too large")
                digest.update(buffer, 0, n)
                out.write(buffer, 0, n)
            }
        }
        return AppUpdate.hex(digest.digest())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000
    }
}
