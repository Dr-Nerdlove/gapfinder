package de.drnerdlove.lueckenfueller

import android.content.Context
import android.content.SharedPreferences

/**
 * The device key, the server address and the last shown notification, in app-private storage (the app is excluded
 * from backups and device transfer, see data_extraction_rules.xml). Never logged.
 */
class CheckStorage(context: Context) : CheckStore, PushStore {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences("notification_check", Context.MODE_PRIVATE)

    override val apiUrl: String? get() = prefs.getString("api_url", null)
    override val deviceKey: String? get() = prefs.getString("device_key", null)

    override var lastNotificationId: Long
        get() = prefs.getLong("last_id", 0)
        set(value) {
            // A check that was running while the key was removed must not write anything back.
            if (deviceKey != null) prefs.edit().putLong("last_id", value).commit()
        }

    /** The last check (epoch millis, wire outcome, number of notifications shown), or null when there was none yet. */
    val lastCheck: LastCheck?
        get() {
            val at = prefs.getLong("last_check_at", 0)
            val result = prefs.getString("last_check_result", null)
            return if (at > 0 && result != null) LastCheck(at, result, prefs.getInt("last_check_count", 0)) else null
        }

    override fun recordCheck(at: Long, outcome: CheckOutcome, count: Int) {
        // Same rule as the last id: a run that was going while the key was removed writes nothing back.
        if (deviceKey != null) {
            prefs.edit().putLong("last_check_at", at).putString("last_check_result", outcome.wire).putInt("last_check_count", count).commit()
        }
    }

    /** Switching on: a new key starts with no check seen yet. */
    fun save(apiUrl: String, deviceKey: String, lastNotificationId: Long) {
        prefs.edit().putString("api_url", apiUrl).putString("device_key", deviceKey).putLong("last_id", lastNotificationId)
            .remove("last_check_at").remove("last_check_result").remove("last_check_count")
            // A new key is unknown to the server: it has not been told the token yet.
            .remove("push_token_sent").remove("push_token_sent_at").remove("push_instant").commit()
    }

    override var pushToken: String?
        get() = prefs.getString("push_token", null)
        set(value) {
            // Same rule as the last id: nothing is stored without a key.
            if (deviceKey != null && value != null) prefs.edit().putString("push_token", value).commit()
        }
    override val pushTokenSent: String? get() = prefs.getString("push_token_sent", null)
    override val pushTokenSentAt: Long get() = prefs.getLong("push_token_sent_at", 0)
    override val pushInstant: Boolean get() = prefs.getBoolean("push_instant", false)

    override fun recordPushSent(token: String, at: Long, instant: Boolean) {
        if (deviceKey != null) prefs.edit().putString("push_token_sent", token).putLong("push_token_sent_at", at).putBoolean("push_instant", instant).commit()
    }

    override fun clear() {
        prefs.edit().clear().commit()
    }
}

/** What the notifications card shows about the last check. */
data class LastCheck(val at: Long, val result: String, val count: Int)
