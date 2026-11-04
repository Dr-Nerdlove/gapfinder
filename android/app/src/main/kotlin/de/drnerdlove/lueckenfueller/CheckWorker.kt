package de.drnerdlove.lueckenfueller

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** The background check: every 15 minutes (Android's minimum) with a network connection. */
class CheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val result = NotificationCheck(CheckStorage(applicationContext), HttpFetcher(), NotificationPoster(applicationContext)).run()
        if (result == CheckResult.STOP) cancel(applicationContext)
        // Nothing here retries: the home server sleeps from 01:00 to 07:00, the next period simply tries again.
        return Result.success()
    }

    companion object {
        const val WORK_NAME = "notification-check"

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
