package de.drnerdlove.lueckenfueller

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.io.File

/** The bridge the web app calls; the contract is web/src/lib/native.ts. Every method rejects when it fails. */
@CapacitorPlugin(
    name = "Lueckenfueller",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class LueckenfuellerPlugin : Plugin() {
    private val storage get() = CheckStorage(context)

    private fun permission(): String {
        // Before Android 13 there is no runtime permission; only the switch in the system settings.
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return "denied"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted"
        return when (getPermissionState("notifications")) {
            PermissionState.GRANTED -> "granted"
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
    }

    @PluginMethod
    fun notificationStatus(call: PluginCall) {
        try {
            val enabled = storage.deviceKey != null && CheckWorker.isScheduled(context)
            val last = if (enabled) storage.lastCheck else null
            val lastCheck: Any = if (last == null) JSONObject.NULL else JSObject().put("at", last.at).put("result", last.result).put("count", last.count)
            val instant = PushTokenRules.isInstant(enabled, Push.available(context), storage)
            call.resolve(JSObject().put("enabled", enabled).put("permission", permission()).put("lastCheck", lastCheck).put("instant", instant))
        } catch (e: Exception) {
            call.reject("Der Benachrichtigungsstatus ließ sich nicht lesen.", e)
        }
    }

    /**
     * One check right now, on the plugin's own background thread, with the same parts and the same lock as the
     * background worker. "off": no key stored (or the server said 401): the periodic work is stopped as well.
     */
    @PluginMethod
    fun checkNow(call: PluginCall) {
        try {
            val run = CheckWorker.runCheck(context)
            call.resolve(JSObject().put("result", resultWire(run.outcome)).put("count", run.count))
        } catch (e: Exception) {
            call.reject("Das Nachsehen hat nicht geklappt.", e)
        }
    }

    /**
     * Whether the latest release has a newer app shell than this one (phase 7c). "unknown": the release's
     * app-update.json cannot be read (no connection, a release before 1.7.0).
     */
    @PluginMethod
    fun appUpdate(call: PluginCall) {
        try {
            val updater = AppUpdater(context)
            val info = updater.latest()
            val answer = JSObject().put("state", AppUpdate.state(info, updater.installedShell())).put("installedShell", updater.installedShell())
            if (info != null) answer.put("version", info.version)
            call.resolve(answer)
        } catch (e: Exception) {
            call.reject("Die App-Version ließ sich nicht prüfen.", e)
        }
    }

    /** Downloads, checks and installs the update; it reads app-update.json itself and trusts nothing from the web app. */
    @PluginMethod
    fun installAppUpdate(call: PluginCall) {
        try {
            val outcome = AppUpdater(context).install()
            val answer = JSObject().put("result", outcome.result)
            outcome.reason?.let { answer.put("reason", it) }
            call.resolve(answer)
        } catch (e: Exception) {
            call.reject("Das Update ließ sich nicht starten.", e)
        }
    }

    /** Shows one notification right now, to tell "Android blocks it" from "nothing new". */
    @PluginMethod
    fun testNotification(call: PluginCall) {
        try {
            val poster = NotificationPoster(context)
            val text = NotificationText(TEST_TITLE, TEST_BODY, null, TEST_TAG)
            val shown = poster.show(text, NotificationTexts.APP_URL)
            call.resolve(if (shown) JSObject().put("shown", true) else JSObject().put("shown", false).put("reason", "blocked"))
        } catch (e: Exception) {
            call.reject("Die Test-Benachrichtigung ließ sich nicht zeigen.", e)
        }
    }

    @PluginMethod
    fun enableNotifications(call: PluginCall) {
        val apiUrl = call.getString("apiUrl")
        val key = call.getString("deviceKey")
        val lastId = wholeNumberArg(call.data.opt("lastNotificationId"))
        if (apiUrl.isNullOrBlank() || !apiUrl.startsWith("https://") || key.isNullOrBlank() || lastId == null || lastId < 0) {
            call.reject("apiUrl (https), deviceKey and lastNotificationId are required")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionResult")
            return
        }
        finishEnable(call)
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        finishEnable(call)
    }

    private fun finishEnable(call: PluginCall) {
        try {
            if (permission() != "granted") {
                call.resolve(JSObject().put("permission", "denied"))
                return
            }
            NotificationPoster(context).ensureChannel()
            storage.save(call.getString("apiUrl")!!, call.getString("deviceKey")!!, wholeNumberArg(call.data.opt("lastNotificationId"))!!)
            CheckWorker.schedule(context)
            Push.enable(context) // the doorbell; a failure here leaves the 15-minute check as it is
            call.resolve(JSObject().put("permission", "granted"))
        } catch (e: Exception) {
            storage.clear()
            CheckWorker.cancel(context)
            call.reject("Die Benachrichtigungen ließen sich nicht einschalten.", e)
        }
    }

    @PluginMethod
    fun disableNotifications(call: PluginCall) {
        try {
            val old = storage.deviceKey
            CheckWorker.cancel(context)
            storage.clear()
            Push.disable(context)
            call.resolve(JSObject().put("deviceKey", old ?: JSObject.NULL))
        } catch (e: Exception) {
            call.reject("Die Benachrichtigungen ließen sich nicht ausschalten.", e)
        }
    }

    /**
     * The phone's Material You palettes (Android 12+). Read by name like `android.R.color.system_accent1_600`, so a
     * colour that a phone lacks drops out instead of failing. Resolved with the activity's theme, which carries
     * the current wallpaper colours.
     */
    @PluginMethod
    fun systemColors(call: PluginCall) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                call.resolve(JSObject().put("available", false))
                return
            }
            val resources = activity.resources
            val theme = activity.theme
            val palettes = JSObject()
            var found = false
            for (palette in SYSTEM_PALETTES) {
                val shades = JSObject()
                for (shade in SYSTEM_SHADES) {
                    val id = resources.getIdentifier("system_${palette}_$shade", "color", "android")
                    if (id == 0) continue
                    shades.put(shade.toString(), String.format("#%06X", 0xFFFFFF and resources.getColor(id, theme)))
                    found = true
                }
                palettes.put(palette, shades)
            }
            val answer = JSObject().put("available", found)
            if (found) answer.put("palettes", palettes)
            call.resolve(answer)
        } catch (e: Exception) {
            call.reject("Die Systemfarben ließen sich nicht lesen.", e)
        }
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val text = call.getString("text").orEmpty()
        val url = call.getString("url").orEmpty()
        val body = listOf(text, url).filter { it.isNotEmpty() }.joinToString("\n")
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, body)
        call.getString("title")?.takeIf { it.isNotEmpty() }?.let { intent.putExtra(Intent.EXTRA_SUBJECT, it) }
        start(call, Intent.createChooser(intent, null))
    }

    @PluginMethod
    fun openFile(call: PluginCall) {
        try {
            val base64 = call.getString("base64") ?: return call.reject("base64 is required")
            val mimeType = call.getString("mimeType")?.takeIf { it.isNotBlank() } ?: return call.reject("mimeType is required")
            val name = safeFileName(call.getString("name"))
            val folder = File(context.cacheDir, SHARED_FOLDER).apply { mkdirs() }
            folder.listFiles()?.forEach { it.delete() } // only the file being opened stays
            val file = File(folder, name)
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            start(call, intent)
        } catch (e: Exception) {
            call.reject("Die Datei ließ sich nicht öffnen.", e)
        }
    }

    @PluginMethod
    fun openExternal(call: PluginCall) {
        val url = call.getString("url")
        val scheme = try {
            url?.let { Uri.parse(it).scheme?.lowercase() }
        } catch (e: Exception) {
            null
        }
        if (url == null || scheme !in ALLOWED_SCHEMES) {
            call.reject("This kind of address cannot be opened")
            return
        }
        start(call, Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    /** Starts the intent from the main thread; rejects when no app can handle it. */
    private fun start(call: PluginCall, intent: Intent) {
        val activity = activity
        activity.runOnUiThread {
            try {
                activity.startActivity(intent)
                call.resolve()
            } catch (e: ActivityNotFoundException) {
                call.reject("Keine App gefunden, die das öffnen kann.", e)
            } catch (e: Exception) {
                call.reject("Das ließ sich nicht öffnen.", e)
            }
        }
    }

    internal companion object {
        const val SHARED_FOLDER = "shared"
        const val TEST_TITLE = "Test von Lückenfüller"
        const val TEST_BODY = "So sehen Benachrichtigungen aus. Wenn du das liest, kann die App dir Benachrichtigungen zeigen."
        const val TEST_TAG = "test"

        /** checkNow's wire word for a run: "off" when there is no key (any more). */
        fun resultWire(outcome: CheckOutcome): String = if (outcome == CheckOutcome.STOPPED) "off" else outcome.wire
        val SYSTEM_PALETTES = listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")
        val SYSTEM_SHADES = listOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)
        val ALLOWED_SCHEMES = setOf("https", "http", "webcal", "mailto", "tel")

        /** A plain file name: no folders, no leading dots, no odd characters. */
        fun safeFileName(name: String?): String {
            val last = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
            val cleaned = last.replace(Regex("[^A-Za-z0-9._-]"), "_").trimStart('.')
            return cleaned.ifEmpty { "datei" }.take(100)
        }
    }
}
