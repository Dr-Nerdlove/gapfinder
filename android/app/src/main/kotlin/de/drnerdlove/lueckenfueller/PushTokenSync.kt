package de.drnerdlove.lueckenfueller

import org.json.JSONException
import org.json.JSONObject

// The push token (the "doorbell" address Firebase gives this phone) and its trip to the server, without android.* so
// the JVM tests can run it. Storage and HTTP are handed in.

/** What the server answered to the token. */
sealed interface PushSendResult {
    /** 200: the server has the token. `instant` = the server can ring phones at all. */
    data class Sent(val instant: Boolean) : PushSendResult
    /** 401: the device key is not known (the normal check handles that). */
    object Unauthorized : PushSendResult
    /** No connection, 404 from an older server, 5xx, anything else: try again at the next run. */
    object Unavailable : PushSendResult
}

fun interface PushSender {
    fun send(apiUrl: String, deviceKey: String, token: String): PushSendResult
}

interface PushStore {
    val apiUrl: String?
    val deviceKey: String?
    /** The token Firebase gave this phone; setting it stores nothing when no key is stored. */
    var pushToken: String?
    /** The token value the server last accepted. */
    val pushTokenSent: String?
    val pushTokenSentAt: Long
    val pushInstant: Boolean
    /** Remembers what the server accepted. Writes nothing when no key is stored. */
    fun recordPushSent(token: String, at: Long, instant: Boolean)
}

object PushTokenRules {
    const val RESEND_AFTER_MS = 24L * 60 * 60 * 1000

    /**
     * Send when there is a token and the server does not have it yet, or was told more than 24 hours ago: the daily
     * resend repairs a server that lost it (rollback, restore).
     */
    fun needsSend(token: String?, sentToken: String?, sentAt: Long, now: Long): Boolean {
        if (token.isNullOrEmpty()) return false
        return token != sentToken || now - sentAt > RESEND_AFTER_MS
    }

    /** The answer of the server to the token: `instant`; anything unreadable counts as false. */
    fun parseInstant(body: String): Boolean = try {
        JSONObject(body).optBoolean("instant", false)
    } catch (e: JSONException) {
        false
    }

    /** "Instant" only when everything is in place: switched on, Firebase there, the server can ring and has this token. */
    fun isInstant(enabled: Boolean, firebaseAvailable: Boolean, store: PushStore): Boolean {
        val token = store.pushToken
        return enabled && firebaseAvailable && store.pushInstant && !token.isNullOrEmpty() && token == store.pushTokenSent
    }
}

class PushTokenSync(
    private val store: PushStore,
    private val sender: PushSender,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** Sends the token when needed. Returns whether the server accepted it in this run. */
    fun sync(): Boolean {
        val apiUrl = store.apiUrl
        val key = store.deviceKey
        val token = store.pushToken
        if (apiUrl.isNullOrEmpty() || key.isNullOrEmpty() || token.isNullOrEmpty()) return false
        val now = clock()
        if (!PushTokenRules.needsSend(token, store.pushTokenSent, store.pushTokenSentAt, now)) return false
        return when (val result = sender.send(apiUrl, key, token)) {
            is PushSendResult.Sent -> {
                store.recordPushSent(token, now, result.instant)
                true
            }
            // Nothing is recorded: the next run tries again.
            is PushSendResult.Unauthorized, is PushSendResult.Unavailable -> false
        }
    }
}

/** Runs the check, then the token sync: not when the check says STOP (key gone) and not when `syncToken` is false (ring path). */
fun runCheckThenSync(check: () -> CheckRun, syncToken: Boolean, sync: PushTokenSync): CheckRun {
    val run = check()
    if (syncToken && run.result != CheckResult.STOP) {
        try {
            sync.sync()
        } catch (e: RuntimeException) {
            // a failed sync never spoils the check; the next run tries again
        }
    }
    return run
}
