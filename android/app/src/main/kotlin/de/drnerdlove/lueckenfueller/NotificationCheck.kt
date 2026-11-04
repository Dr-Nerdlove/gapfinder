package de.drnerdlove.lueckenfueller

import org.json.JSONException
import org.json.JSONObject

// The decisions of the background check, without android.* so the JVM tests can run them. The phone-specific
// parts (storage, HTTP, showing the notification) are handed in.

/** What the server answered. */
sealed interface FetchResult {
    /** 200 with this body. */
    data class Body(val text: String) : FetchResult

    /** 401: the key is not valid any more. */
    object Unauthorized : FetchResult

    /** No connection, timeout, 5xx or anything else: try again next period. */
    object Unavailable : FetchResult
}

fun interface NotificationFetcher {
    fun fetch(apiUrl: String, deviceKey: String, after: Long): FetchResult
}

fun interface NotificationSink {
    fun show(text: NotificationText, target: String)
}

interface CheckStore {
    val apiUrl: String?
    val deviceKey: String?
    var lastNotificationId: Long

    /** Forgets the address, the key and the last id. */
    fun clear()
}

enum class CheckResult {
    /** Done for now; the next period runs again. */
    CONTINUE,

    /** The key is gone (401 or nothing stored): stop the periodic work. */
    STOP,
}

class NotificationCheck(
    private val store: CheckStore,
    private val fetcher: NotificationFetcher,
    private val sink: NotificationSink,
) {
    fun run(): CheckResult {
        val apiUrl = store.apiUrl
        val key = store.deviceKey
        if (apiUrl.isNullOrEmpty() || key.isNullOrEmpty()) return CheckResult.STOP
        val after = store.lastNotificationId
        val body = when (val result = fetcher.fetch(apiUrl, key, after)) {
            is FetchResult.Unauthorized -> {
                store.clear()
                return CheckResult.STOP
            }
            is FetchResult.Unavailable -> return CheckResult.CONTINUE
            is FetchResult.Body -> result.text
        }
        for ((id, data) in parseItems(body, after)) {
            try {
                val text = NotificationTexts.of(data)
                sink.show(text, NotificationTexts.target(text.shareToken, NotificationTexts.APP_URL))
            } catch (e: RuntimeException) {
                return CheckResult.CONTINUE // not shown: keep this id, so the next period tries again
            }
            store.lastNotificationId = id
        }
        return CheckResult.CONTINUE
    }

    /** The items newer than `after`, oldest first. A broken answer gives none. */
    private fun parseItems(body: String, after: Long): List<Pair<Long, JSONObject?>> {
        val items = try {
            JSONObject(body).optJSONArray("items")
        } catch (e: JSONException) {
            null
        } ?: return emptyList()
        val out = ArrayList<Pair<Long, JSONObject?>>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val id = (item.opt("id") as? Number)?.toLong() ?: continue
            if (id > after) out.add(id to item.optJSONObject("data"))
        }
        out.sortBy { it.first }
        return out
    }
}
