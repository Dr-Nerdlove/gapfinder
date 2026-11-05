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

    /** Forgets the address, the key, the last id and the last check. */
    fun clear()

    /** Remembers when the last run looked for news and how it went. Writes nothing when no key is stored. */
    fun recordCheck(at: Long, outcome: CheckOutcome)
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

/** The decision for WorkManager and what is shown to the user. */
data class CheckRun(val result: CheckResult, val outcome: CheckOutcome)

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
        for ((id, data) in items) {
            try {
                val text = NotificationTexts.of(data)
                sink.show(text, NotificationTexts.target(text.shareToken, NotificationTexts.APP_URL))
            } catch (e: RuntimeException) {
                return finish(CheckOutcome.BROKEN) // not shown: keep this id, so the next period tries again
            }
            store.lastNotificationId = id
        }
        return finish(CheckOutcome.OK)
    }

    private fun finish(outcome: CheckOutcome): CheckRun {
        store.recordCheck(clock(), outcome)
        return CheckRun(CheckResult.CONTINUE, outcome)
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
