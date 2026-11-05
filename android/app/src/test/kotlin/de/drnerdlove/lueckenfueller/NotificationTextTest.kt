package de.drnerdlove.lueckenfueller

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.TimeZone

/** The same cases as the web app's test (web/src/lib/notification-text.cases.json). */
class NotificationTextTest {
    private fun cases(): JSONObject {
        // Gradle runs unit tests in the app project folder (android/app).
        val file = File("../../web/src/lib/notification-text.cases.json")
        check(file.isFile) { "Missing ${file.absolutePath}: the shared cases file must exist" }
        return JSONObject(file.readText(Charsets.UTF_8))
    }

    @Test
    fun textsMatchTheWebApp() {
        val texts = cases().getJSONArray("texts")
        assertTrue(texts.length() >= 5)
        for (i in 0 until texts.length()) {
            val c = texts.getJSONObject(i)
            val expected = c.getJSONObject("expected")
            val actual = NotificationTexts.of(c.getJSONObject("data"))
            val name = c.getString("name")
            assertEquals(name, expected.getString("title"), actual.title)
            assertEquals(name, expected.getString("body"), actual.body)
            assertEquals(name, expected.optString("shareToken", null), actual.shareToken)
            assertEquals(name, expected.getString("tag"), actual.tag)
        }
    }

    @Test
    fun targetsMatchTheWebApp() {
        val targets = cases().getJSONArray("targets")
        assertTrue(targets.length() >= 2)
        for (i in 0 until targets.length()) {
            val c = targets.getJSONObject(i)
            val token = if (c.isNull("shareToken")) null else c.getString("shareToken")
            assertEquals(c.getString("name"), c.getString("url"), NotificationTexts.target(token, c.getString("scope")))
        }
    }

    @Test
    fun datesAreGermanTimeWhateverTheDeviceZone() {
        val old = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            val text = NotificationTexts.of(JSONObject("""{"kind":"date_fixed","pollTitle":"A","actorName":"B","shareToken":"t","proposal":{"id":1,"start":"2026-12-12T13:00:00.000Z","end":"2026-12-12T16:00:00.000Z"}}"""))
            assertEquals("B hat den Termin festgelegt: Sa 12.12., 14:00–17:00.", text.body)
        } finally {
            TimeZone.setDefault(old)
        }
    }

    @Test
    fun otherProposalShapes() {
        fun body(proposal: String) = NotificationTexts.of(JSONObject("""{"kind":"date_fixed","pollTitle":"A","actorName":"B","shareToken":"t","proposal":$proposal}""")).body
        // Over midnight (summer time: UTC+2) and a run of days.
        assertEquals("B hat den Termin festgelegt: Fr 3.7., 23:00–Sa 4.7., 01:00.", body("""{"id":1,"start":"2026-07-03T21:00:00Z","end":"2026-07-03T23:00:00Z"}"""))
        assertEquals("B hat den Termin festgelegt: 14.–28. Feb.", body("""{"id":1,"first":"2027-02-14","last":"2027-02-28"}""").removeSuffix("."))
        assertEquals("B hat den Termin festgelegt: 30. Dez. 2026–2. Jan. 2027.", body("""{"id":1,"first":"2026-12-30","last":"2027-01-02"}"""))
        // Broken proposals give the general text, not a crash.
        for (broken in listOf("null", "5", "{}", """{"start":1}""", """{"start":"x","end":"y"}""", """{"first":3,"last":4}""")) {
            assertEquals(broken, "Es gibt Neuigkeiten zu „A“.", body(broken))
        }
    }

    @Test
    fun unknownKindsAndBrokenDataGiveGeneralTexts() {
        val unknown = NotificationTexts.of(JSONObject("""{"kind":"something_new","pollTitle":"Grillen","actorName":"Anna","shareToken":"tok_1"}"""))
        assertEquals(NotificationText("Lückenfüller", "Es gibt Neuigkeiten zu „Grillen“.", "tok_1", "tok_1:something_new"), unknown)
        assertEquals(NotificationText("Lückenfüller", "Es gibt Neuigkeiten.", null, "lueckenfueller"), NotificationTexts.of(null))
        assertEquals(NotificationText("Lückenfüller", "Es gibt Neuigkeiten.", null, "lueckenfueller"), NotificationTexts.of("x"))
        assertNull(NotificationTexts.of(JSONObject("""{"pollTitle":"X","shareToken":""}""")).shareToken)
        assertEquals("Es gibt Neuigkeiten.", NotificationTexts.of(JSONObject("""{"pollTitle":3,"shareToken":4}""")).body)
    }

    @Test
    fun encodesTokensLikeEncodeURIComponent() {
        assertEquals("a%20b", NotificationTexts.encodeUriComponent("a b"))
        assertEquals("%C3%A4%2F%3F%23-_.!~*'()", NotificationTexts.encodeUriComponent("ä/?#-_.!~*'()"))
    }

    @Test
    fun onlyAddressesInsideTheAppAreOpened() {
        assertTrue(NotificationTexts.isAppUrl("https://dr-nerdlove.github.io/gapfinder/"))
        assertTrue(NotificationTexts.isAppUrl("https://dr-nerdlove.github.io/gapfinder/#/abstimmung/abc"))
        for (bad in listOf(
            null, "", "http://dr-nerdlove.github.io/gapfinder/", "https://dr-nerdlove.github.io/other/",
            "https://dr-nerdlove.github.io/gapfinder/../other/", "https://dr-nerdlove.github.io.evil.example/gapfinder/",
            "https://user@dr-nerdlove.github.io/gapfinder/", "https://dr-nerdlove.github.io:8443/gapfinder/",
            "https://evil.example/https://dr-nerdlove.github.io/gapfinder/", "javascript:alert(1)",
        )) assertFalse(bad.toString(), NotificationTexts.isAppUrl(bad))
    }
}
