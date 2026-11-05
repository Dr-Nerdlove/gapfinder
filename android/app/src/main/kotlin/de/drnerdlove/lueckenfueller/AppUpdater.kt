package de.drnerdlove.lueckenfueller

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.pm.PackageInfoCompat
import java.io.File

/**
 * The self-update (phase 7c): reads app-update.json of the latest release, and on request downloads the APK, checks
 * it and hands it to Android's installer, which asks the user. Runs on the plugin's background thread.
 */
class AppUpdater(private val context: Context, private val http: AppUpdateHttp = AppUpdateHttp()) {
    private val installedShell = BuildConfig.SHELL_VERSION

    /** The latest release's file, or null when it cannot be read (no connection, a release before 1.7.0, odd content). */
    fun latest(): AppUpdateInfo? = http.fetchText(AppUpdate.JSON_URL, AppUpdate.MAX_JSON_BYTES)?.let { AppUpdate.parse(it) }

    fun installedShell(): Int = installedShell

    fun install(): InstallOutcome {
        // Read again here: nothing the web app passes is trusted.
        val info = latest() ?: return InstallOutcome.failed(InstallFailure.DOWNLOAD)
        if (!AppUpdate.isAvailable(info, installedShell)) return InstallOutcome.failed(InstallFailure.VERSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return InstallOutcome.NEEDS_PERMISSION
        }
        val folder = File(context.cacheDir, FOLDER).apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        val file = File(folder, AppUpdate.apkName(info.version))
        try {
            val sha = http.download(AppUpdate.apkUrl(info.version), file, AppUpdate.MAX_APK_BYTES)
                ?: return InstallOutcome.failed(InstallFailure.DOWNLOAD)
            val failure = AppUpdate.verify(info, sha, factsOfInstalled(), factsOfFile(file))
            if (failure != null) return InstallOutcome.failed(failure)
            return if (commit(file)) InstallOutcome.STARTED else InstallOutcome.failed(InstallFailure.INSTALL)
        } finally {
            file.delete()
        }
    }

    private fun factsOfInstalled(): AppUpdate.PackageFacts {
        val info = context.packageManager.getPackageInfo(context.packageName, signatureFlag())
        return factsOf(info)!!
    }

    private fun factsOfFile(file: File): AppUpdate.PackageFacts? {
        val info = context.packageManager.getPackageArchiveInfo(file.absolutePath, signatureFlag()) ?: return null
        return factsOf(info)
    }

    @Suppress("DEPRECATION")
    private fun signatureFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun factsOf(info: PackageInfo): AppUpdate.PackageFacts? {
        val signers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        }?.map { it.toByteArray() } ?: emptyList()
        return AppUpdate.PackageFacts(info.packageName, signers, PackageInfoCompat.getLongVersionCode(info))
    }

    /** Writes the APK into an install session and commits it; the result comes to `InstallResultReceiver`. */
    private fun commit(file: File): Boolean {
        val installer = context.packageManager.packageInstaller
        var sessionId = -1
        return try {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(context.packageName)
            sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                file.inputStream().use { input ->
                    session.openWrite("app.apk", 0, file.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                val intent = Intent(context, InstallResultReceiver::class.java).setAction(InstallResultReceiver.ACTION)
                // PackageInstaller fills in the result, so from Android 12 the PendingIntent has to be mutable.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                session.commit(PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender)
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "install session failed: ${e.javaClass.simpleName}")
            if (sessionId >= 0) {
                try {
                    installer.abandonSession(sessionId)
                } catch (ignored: Exception) {
                    // already gone
                }
            }
            false
        }
    }

    private companion object {
        const val FOLDER = "app-update"
        const val TAG = "AppUpdate"
    }
}
