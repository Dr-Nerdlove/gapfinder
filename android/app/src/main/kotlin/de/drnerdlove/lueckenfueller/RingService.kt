package de.drnerdlove.lueckenfueller

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** The doorbell: Firebase rings, the app looks for news itself (the message carries no content). */
class RingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        try {
            if (CheckStorage(applicationContext).deviceKey == null) return
            // One quick GET under the usual lock; a high-priority message gives only a short window, so no WorkManager.
            val run = CheckWorker.runCheck(applicationContext, syncToken = false)
            if (run.outcome == CheckOutcome.UNAVAILABLE) CheckWorker.checkOnce(applicationContext)
        } catch (e: RuntimeException) {
            // the 15-minute check is the fallback
        }
    }

    override fun onNewToken(token: String) {
        try {
            val storage = CheckStorage(applicationContext)
            if (storage.deviceKey == null) return
            storage.pushToken = token
            CheckWorker.checkOnce(applicationContext) // sends it
        } catch (e: RuntimeException) {
            // ignored on purpose
        }
    }
}
