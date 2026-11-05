package de.drnerdlove.lueckenfueller

import org.json.JSONException
import org.json.JSONObject
import java.net.URI
import java.net.URISyntaxException
import java.security.MessageDigest

/** What `app-update.json` of a release says (written by scripts/app-update-json.sh). */
data class AppUpdateInfo(val version: String, val shell: Int, val apk: String, val sha256: String)

/** Why an install did not start. The wire word goes to the web app; there is never an exception text. */
enum class InstallFailure(val wire: String) {
    DOWNLOAD("download"),
    CHECKSUM("checksum"),
    PACKAGE("package"),
    SIGNATURE("signature"),
    VERSION("version"),
    INSTALL("install"),
}

/** The answer of `installAppUpdate()`: "started", "needs-permission" or "failed" with a reason. */
data class InstallOutcome(val result: String, val reason: String? = null) {
    companion object {
        val STARTED = InstallOutcome("started")
        val NEEDS_PERMISSION = InstallOutcome("needs-permission")
        fun failed(failure: InstallFailure) = InstallOutcome("failed", failure.wire)
    }
}

/**
 * The pure parts of the self-update (phase 7c): no Android classes, so the JVM tests run them. The app decides from
 * the shell number only; the APK address is built here and never taken from the JSON.
 */
object AppUpdate {
    const val RELEASES = "https://github.com/Dr-Nerdlove/gapfinder/releases"
    const val JSON_URL = "$RELEASES/latest/download/app-update.json"
    const val MAX_JSON_BYTES = 64 * 1024
    const val MAX_APK_BYTES = 64L * 1024 * 1024
    const val MAX_HOPS = 5

    /** The only hosts a download may come from or be redirected to (GitHub, its release storage). */
    val ALLOWED_HOSTS = setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")

    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+$")
    private val SHA256 = Regex("^[0-9a-fA-F]{64}$")

    fun apkName(version: String) = "lueckenfueller-$version.apk"

    fun apkUrl(version: String) = "$RELEASES/download/v$version/${apkName(version)}"

    /** The parsed file, or null when anything is off (not JSON, wrong type, odd version, wrong apk name, bad hash). */
    fun parse(text: String): AppUpdateInfo? {
        val json = try {
            JSONObject(text)
        } catch (e: JSONException) {
            return null
        }
        val version = json.opt("version") as? String ?: return null
        val shell = json.opt("shell") as? Int ?: return null
        val apk = json.opt("apk") as? String ?: return null
        val sha256 = json.opt("sha256") as? String ?: return null
        if (!VERSION.matches(version)) return null
        if (shell < 1) return null
        if (apk != apkName(version)) return null
        if (!SHA256.matches(sha256)) return null
        return AppUpdateInfo(version, shell, apk, sha256.lowercase())
    }

    /** An update is offered only when the release's shell is newer than the installed one. */
    fun isAvailable(info: AppUpdateInfo, installedShell: Int): Boolean = info.shell > installedShell

    /** True for an https address on one of the allowed hosts. */
    fun isAllowedUrl(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (e: URISyntaxException) {
            return false
        }
        return uri.scheme == "https" && uri.host?.lowercase() in ALLOWED_HOSTS && uri.userInfo == null && (uri.port == -1 || uri.port == 443)
    }

    /** The next address of a redirect (the Location header may be relative), or null when it is missing or not allowed. */
    fun nextHop(current: String, location: String?): String? {
        if (location.isNullOrBlank()) return null
        val next = try {
            URI(current).resolve(location).toString()
        } catch (e: URISyntaxException) {
            return null
        } catch (e: IllegalArgumentException) {
            return null
        }
        return if (isAllowedUrl(next)) next else null
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    fun sha256Hex(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

    fun sha256Matches(actualHex: String, expectedHex: String): Boolean = actualHex.equals(expectedHex, ignoreCase = true)

    /** The signing certificates of two packages are the same set (and not empty). */
    fun sameSigners(installed: List<ByteArray>, candidate: List<ByteArray>): Boolean {
        if (installed.isEmpty() || candidate.isEmpty()) return false
        return installed.map { sha256Hex(it) }.toSet() == candidate.map { sha256Hex(it) }.toSet()
    }

    /** What was read from the downloaded file or the installed app (the package manager does this on the phone). */
    class PackageFacts(val packageName: String?, val signers: List<ByteArray>, val versionCode: Long)

    /**
     * The checks before the installer is called, in this order: checksum, package name, signing certificates,
     * version code (it must be higher). Returns the first one that fails, or null.
     */
    fun verify(info: AppUpdateInfo, downloadedSha256: String, own: PackageFacts, downloaded: PackageFacts?): InstallFailure? {
        if (!sha256Matches(downloadedSha256, info.sha256)) return InstallFailure.CHECKSUM
        if (downloaded == null || downloaded.packageName != own.packageName) return InstallFailure.PACKAGE
        if (!sameSigners(own.signers, downloaded.signers)) return InstallFailure.SIGNATURE
        if (downloaded.versionCode <= own.versionCode) return InstallFailure.VERSION
        return null
    }

    /** The wire answer of `appUpdate()`: "available", "current" or "unknown" (no readable file). */
    fun state(info: AppUpdateInfo?, installedShell: Int): String = when {
        info == null -> "unknown"
        isAvailable(info, installedShell) -> "available"
        else -> "current"
    }
}
