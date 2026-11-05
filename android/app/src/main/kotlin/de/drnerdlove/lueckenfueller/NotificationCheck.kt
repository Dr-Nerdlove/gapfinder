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
    /** Shows the notification. False when Android did not let it through (permission, app switch or channel off). */
    fun show(text: NotificationText, target: String): Boolean
}

interface CheckStore {
    val apiUrl: String?
    val deviceKey: String?
    var lastNotificationId: Long

    /** Forgets the address, the key, the last id and the last check. */
    fun clear()

    /** Remembers when the last run looked for news, how it went and how many notifications it showed. Writes nothing when no key is stored. */
    fun recordCheck(at: Long, outcome: CheckOutcome, count: Int)
}

/** How a run went, as the notifications card shows it. `wire` is what the web app reads. */
enum class CheckOutcome(val wire: String) {
    /** The answer was read (it may have shown none, one or more notifications). */
    OK("ok"),

    /** No connection, timeout or server error. */
    UNAVAILABLE("unavailable"),

    /** The answer could not be read, or a notification could not be shown. */
    BROKEN("error"),

    /** 401 or nothing stored: the work stops and nothing is remembered. */
    STOPPED("stopped"),
}

/** The decision for WorkManager and what is shown to the user. `count` is the number of notifications really shown. */
data class CheckRun(val result: CheckResult, val outcome: CheckOutcome, val count: Int = 0)

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
    private val clock: () -> Long = System::currentTimeMillis,
) {
    fun run(): CheckRun {
        val apiUrl = store.apiUrl
        val key = store.deviceKey
        if (apiUrl.isNullOrEmpty() || key.isNullOrEmpty()) return CheckRun(CheckResult.STOP, CheckOutcome.STOPPED)
        val after = store.lastNotificationId
        val body = when (val result = fetcher.fetch(apiUrl, key, after)) {
            is FetchResult.Unauthorized -> {
                store.clear()
                return CheckRun(CheckResult.STOP, CheckOutcome.STOPPED)
            }
            is FetchResult.Unavailable -> return finish(CheckOutcome.UNAVAILABLE)
            is FetchResult.Body -> result.text
        }
        val items = parseItems(body, after) ?: return finish(CheckOutcome.BROKEN)
        var shown = 0
        for ((id, data) in items) {
            val posted = try {
                val text = NotificationTexts.of(data)
                sink.show(text, NotificationTexts.target(text.shareToken, NotificationTexts.APP_URL))
            } catch (e: RuntimeException) {
                false
            }
            // Not shown (a failure, or Android blocks notifications): keep this id, so a later run tries again.
            if (!posted) return finish(CheckOutcome.BROKEN, shown)
            store.lastNotificationId = id
            shown++
        }
        return finish(CheckOutcome.OK, shown)
    }

    private fun finish(outcome: CheckOutcome, count: Int = 0): CheckRun {
        store.recordCheck(clock(), outcome, count)
        return CheckRun(CheckResult.CONTINUE, outcome, count)
    }

    /** The items newer than `after`, oldest first. Null when the answer is not readable. */
    private fun parseItems(body: String, after: Long): List<Pair<Long, JSONObject?>>? {
        val items = try {
            JSONObject(body).optJSONArray("items")
        } catch (e: JSONException) {
            null
        } ?: return null
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
