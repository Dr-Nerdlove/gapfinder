package de.drnerdlove.lueckenfueller

import android.content.Context
import android.content.SharedPreferences

/**
 * The device key, the server address and the last shown notification, in app-private storage (the app is excluded
 * from backups and device transfer, see data_extraction_rules.xml). Never logged.
 */
class CheckStorage(context: Context) : CheckStore {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences("notification_check", Context.MODE_PRIVATE)

    override val apiUrl: String? get() = prefs.getString("api_url", null)
    override val deviceKey: String? get() = prefs.getString("device_key", null)

    override var lastNotificationId: Long
        get() = prefs.getLong("last_id", 0)
        set(value) {
            // A check that was running while the key was removed must not write anything back.
            if (deviceKey != null) prefs.edit().putLong("last_id", value).commit()
        }

    /** The last check as (epoch millis, wire outcome), or null when there was none yet. */
    val lastCheck: Pair<Long, String>?
        get() {
            val at = prefs.getLong("last_check_at", 0)
            val result = prefs.getString("last_check_result", null)
            return if (at > 0 && result != null) at to result else null
        }

    override fun recordCheck(at: Long, outcome: CheckOutcome) {
        // Same rule as the last id: a run that was going while the key was removed writes nothing back.
        if (deviceKey != null) prefs.edit().putLong("last_check_at", at).putString("last_check_result", outcome.wire).commit()
    }

    /** Switching on: a new key starts with no check seen yet. */
    fun save(apiUrl: String, deviceKey: String, lastNotificationId: Long) {
        prefs.edit().putString("api_url", apiUrl).putString("device_key", deviceKey).putLong("last_id", lastNotificationId)
            .remove("last_check_at").remove("last_check_result").commit()
    }

    override fun clear() {
        prefs.edit().clear().commit()
    }
}
