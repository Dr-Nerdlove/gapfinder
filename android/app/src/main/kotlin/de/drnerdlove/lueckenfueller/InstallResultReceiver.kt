package de.drnerdlove.lueckenfueller

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import androidx.core.content.IntentCompat

/** Gets the installer's result (not exported; only our own PendingIntent reaches it). */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android wants the user to confirm: it hands over the screen to show.
            val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else {
            Log.i(TAG, "install status $status")
        }
    }

    companion object {
        const val ACTION = "de.drnerdlove.lueckenfueller.INSTALL_RESULT"
        private const val TAG = "AppUpdate"
    }
}
