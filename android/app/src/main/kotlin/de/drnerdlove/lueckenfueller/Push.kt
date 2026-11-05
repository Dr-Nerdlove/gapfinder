package de.drnerdlove.lueckenfueller

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Firebase as a doorbell (phase 7d). Firebase stays off (manifest) until notifications are switched on; every call is
 * guarded and wrapped, so a missing google-services.json or any Firebase failure never breaks switching on or off:
 * the 15-minute check is the fallback.
 */
object Push {
    /** False without google-services.json (Firebase is then never initialised). */
    fun available(context: Context): Boolean = try {
        FirebaseApp.getApps(context).isNotEmpty()
    } catch (e: RuntimeException) {
        false
    }

    /** Turns Firebase on and fetches the token; the token goes to the server by the next check. */
    fun enable(context: Context) {
        try {
            if (!available(context)) return
            val messaging = FirebaseMessaging.getInstance()
            messaging.isAutoInitEnabled = true
            val app = context.applicationContext
            messaging.token.addOnCompleteListener { task ->
                try {
                    val token = if (task.isSuccessful) task.result else null
                    if (!token.isNullOrEmpty()) {
                        CheckStorage(app).pushToken = token
                        CheckWorker.checkOnce(app) // sends the token
                    }
                } catch (e: RuntimeException) {
                    // the periodic check is the fallback
                }
            }
        } catch (e: RuntimeException) {
            // ignored on purpose
        }
    }

    /** Turns Firebase off again and deletes the token, so Google forgets this phone. */
    fun disable(context: Context) {
        try {
            if (!available(context)) return
            val messaging = FirebaseMessaging.getInstance()
            messaging.isAutoInitEnabled = false
            messaging.deleteToken()
        } catch (e: RuntimeException) {
            // ignored on purpose
        }
    }
}
