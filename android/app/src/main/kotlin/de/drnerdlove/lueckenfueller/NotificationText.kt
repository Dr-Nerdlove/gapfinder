package de.drnerdlove.lueckenfueller

import org.json.JSONObject
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

// A faithful port of web/src/lib/notification-text.ts (and the date helpers it uses from poll-view.ts and
// gap-search.ts). Both sides are tested against web/src/lib/notification-text.cases.json: change one, change the
// other. No android.* imports, so the JVM tests can run it.

data class NotificationText(
    val title: String,
    val body: String,
    /** Opens the poll; null when the message does not carry one. */
    val shareToken: String?,
    /** Messages with the same tag replace each other. */
    val tag: String,
)

object NotificationTexts {
    /** The app's address; a tap on a notification may only open addresses below it. */
    const val APP_URL = "https://dr-nerdlove.github.io/gapfinder/"

    private const val APP_NAME = "Lückenfüller"
    private const val FALLBACK_TAG = "lueckenfueller"

    private fun textOf(value: Any?): String? = if (value is String && value != "") value else null

    /** Makes the text of a notification from its data (a JSONObject). Never throws: anything else gives a general text. */
    fun of(data: Any?): NotificationText {
        val record = data as? JSONObject ?: JSONObject()
        val shareToken = textOf(record.opt("shareToken"))
        val pollTitle = textOf(record.opt("pollTitle"))
        val actor = textOf(record.opt("actorName"))
        val kind = record.opt("kind") as? String
        val tag = if (shareToken != null && kind != null) "$shareToken:$kind" else shareToken ?: FALLBACK_TAG

        if (pollTitle != null && actor != null) {
            when (kind) {
                "poll_created" -> return NotificationText("Neue Abstimmung: $pollTitle", "$actor fragt, wann du Zeit hast. Stimm jetzt ab.", shareToken, tag)
                "vote" -> return NotificationText(pollTitle, "$actor hat abgestimmt.", shareToken, tag)
                "all_voted" -> return NotificationText("Alle haben abgestimmt: $pollTitle", "Zuletzt hat $actor abgestimmt.", shareToken, tag)
                "reminder" -> return NotificationText("Erinnerung: $pollTitle", "$actor bittet dich, abzustimmen.", shareToken, tag)
                "date_fixed" -> {
                    val label = proposalText(record.opt("proposal"))
                    if (label != null) {
                        return NotificationText("Termin steht: $pollTitle", "$actor hat den Termin festgelegt: $label.", shareToken, tag)
                    }
                }
            }
        }
        return NotificationText(
            APP_NAME,
            if (pollTitle != null) "Es gibt Neuigkeiten zu „$pollTitle“." else "Es gibt Neuigkeiten.",
            shareToken,
            tag,
        )
    }

    private fun proposalText(proposal: Any?): String? {
        if (proposal !is JSONObject) return null
        val label = GermanDates.proposalLabel(proposal) ?: return null
        return if (label.contains("undefined") || label.contains("NaN")) null else label
    }

    /** The address a tap on the message opens: the poll, or the start page without a token. `scope` ends with "/". */
    fun target(shareToken: String?, scope: String): String =
        if (!shareToken.isNullOrEmpty()) "$scope#/abstimmung/${encodeUriComponent(shareToken)}" else scope

    /** Like JavaScript's encodeURIComponent: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) as UTF-8 percent codes. */
    internal fun encodeUriComponent(text: String): String {
        val out = StringBuilder()
        for (byte in text.toByteArray(Charsets.UTF_8)) {
            val c = byte.toInt() and 0xff
            val ch = c.toChar()
            if (c < 0x80 && (ch.isLetterOrDigit() || ch in "-_.!~*'()")) out.append(ch)
            else out.append('%').append("%02X".format(Locale.ROOT, c))
        }
        return out.toString()
    }

    /** True for an address inside the app (https, this host, below the app's folder); the only ones a tap may open. */
    fun isAppUrl(url: String?): Boolean {
        if (url == null) return false
        return try {
            val uri = java.net.URI(url)
            uri.scheme == "https" && uri.host == "dr-nerdlove.github.io" && uri.port == -1 && uri.userInfo == null &&
                (uri.rawPath ?: "").startsWith("/gapfinder/") && !(uri.rawPath ?: "").contains("..") && !url.contains('\\')
        } catch (e: java.net.URISyntaxException) {
            false
        }
    }
}

/** The date texts, always in German time (Europe/Berlin), like the web app. */
internal object GermanDates {
    private val BERLIN: TimeZone = TimeZone.getTimeZone("Europe/Berlin")
    private val WEEKDAYS = arrayOf("So", "Mo", "Di", "Mi", "Do", "Fr", "Sa") // Calendar.DAY_OF_WEEK - 1
    private val MONTH_SHORT = arrayOf("Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez.")
    private val INSTANT = Regex("""^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$""")
    private val DATE = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")

    private class Day(val year: Int, val month: Int, val day: Int, val weekday: Int, val hour: Int, val minute: Int) {
        fun sameDay(o: Day) = year == o.year && month == o.month && day == o.day
        fun label() = "${WEEKDAYS[weekday - 1]} $day.$month."
        fun clock() = "%02d:%02d".format(Locale.ROOT, hour, minute)
    }

    /** Epoch milliseconds of an ISO 8601 text, or null when it is not a valid date. */
    internal fun parseInstant(text: String): Long? {
        val m = INSTANT.matchEntire(text) ?: return null
        val g = m.groupValues
        val cal = GregorianCalendar(TimeZone.getTimeZone("GMT"), Locale.ROOT)
        cal.isLenient = false
        cal.clear()
        return try {
            cal.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].ifEmpty { "0" }.toInt(), g[5].ifEmpty { "0" }.toInt(), g[6].ifEmpty { "0" }.toInt())
            var millis = cal.timeInMillis + (g[7] + "000").take(3).toInt()
            val zone = g[8]
            if (zone.isNotEmpty() && zone != "Z") {
                val digits = zone.substring(1).replace(":", "")
                val offset = (digits.take(2).toInt() * 60 + digits.substring(2).toInt()) * 60_000L
                millis -= if (zone[0] == '+') offset else -offset
            }
            millis
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    private fun berlinDay(millis: Long): Day {
        val cal = Calendar.getInstance(BERLIN, Locale.ROOT)
        cal.timeInMillis = millis
        return Day(
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH),
            cal.get(Calendar.DAY_OF_WEEK), cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE),
        )
    }

    /** "14.–28. Feb." / "28. Aug.–3. Sept." / "5. Mai" / with another year "30. Dez. 2026–2. Jan. 2027". */
    private fun stretch(first: String, last: String): String {
        val a = DATE.matchEntire(first)
        val b = DATE.matchEntire(last)
        if (a == null || b == null) return "$first–$last"
        val (ay, am, ad) = a.destructured.toList().map { it.toInt() }
        val (by, bm, bd) = b.destructured.toList().map { it.toInt() }
        return when {
            first == last -> "$ad. ${MONTH_SHORT[am - 1]}"
            ay != by -> "$ad. ${MONTH_SHORT[am - 1]} $ay–$bd. ${MONTH_SHORT[bm - 1]} $by"
            am == bm -> "$ad.–$bd. ${MONTH_SHORT[bm - 1]}"
            else -> "$ad. ${MONTH_SHORT[am - 1]}–$bd. ${MONTH_SHORT[bm - 1]}"
        }
    }

    /** "Sa 12.12., 14:00–17:00" or "14.–28. Feb."; null when the proposal cannot be read. */
    fun proposalLabel(proposal: org.json.JSONObject): String? {
        if (proposal.has("first")) {
            val first = proposal.opt("first") as? String ?: return null
            val last = proposal.opt("last") as? String ?: return null
            return stretch(first, last)
        }
        val start = (proposal.opt("start") as? String)?.let { parseInstant(it) } ?: return null
        val end = (proposal.opt("end") as? String)?.let { parseInstant(it) } ?: return null
        val day = berlinDay(start)
        val endDay = berlinDay(end)
        val endText = if (day.sameDay(endDay)) endDay.clock() else "${endDay.label()}, ${endDay.clock()}"
        return "${day.label()}, ${day.clock()}–$endText"
    }
}
