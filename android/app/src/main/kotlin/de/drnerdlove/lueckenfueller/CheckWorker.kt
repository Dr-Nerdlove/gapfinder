package de.drnerdlove.lueckenfueller

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** The background check: every 15 minutes (Android's minimum) with a network connection. */
class CheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        runCheck(applicationContext)
        // Nothing here retries: the home server sleeps from 01:00 to 07:00, the next period simply tries again.
        return Result.success()
    }

    companion object {
        const val WORK_NAME = "notification-check"

        /** One check right now, for the "check on open" run. Its own unique name, so it never touches the periodic work. */
        const val NOW_WORK_NAME = "notification-check-now"

        /**
         * One check (then, unless `syncToken` is false, the push token sync), with the same parts for the worker and the plugin's checkNow. Only one runs at a time (a notification
         * must not be shown twice, nor the last id raced). Stops the periodic work when the key is gone.
         */
        fun runCheck(context: Context, syncToken: Boolean = true): CheckRun = CheckLock.withLock {
            val storage = CheckStorage(context)
            val run = runCheckThenSync(
                { NotificationCheck(storage, HttpFetcher(), NotificationPoster(context)).run() },
                syncToken,
                PushTokenSync(storage, PushTokenSender()),
            )
            if (run.result == CheckResult.STOP) {
                cancel(context)
            } else if (syncToken && storage.deviceKey != null && storage.pushToken == null) {
                // Switched on, but no doorbell token yet: an app updated from before phase 7d, google-services.json
                // added later, or a token fetch that failed. Fetch it now; the next check sends it.
                Push.enable(context)
            }
            run
        }

        /** Looks for news once in the background (when the app opens); ignored while one is already queued or running. */
        fun checkOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<CheckWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CheckWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        /** Whether the periodic work is waiting for its next run (or running). */
        fun isScheduled(context: Context): Boolean =
            WorkManager.getInstance(context).getWorkInfosForUniqueWork(WORK_NAME).get().any { !it.state.isFinished }
    }
}
