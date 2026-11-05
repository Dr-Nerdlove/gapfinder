package de.drnerdlove.lueckenfueller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class NotificationCheckTest {
    private class FakeStore(var url: String? = "https://api.example", var key: String? = "k1", var last: Long = 5) : CheckStore {
        override val apiUrl get() = url
        override val deviceKey get() = key
        override var lastNotificationId: Long
            get() = last
            set(value) { last = value }
        override fun clear() { url = null; key = null; last = 0; checks.clear() }
        val checks = mutableListOf<Pair<Long, CheckOutcome>>()
        override fun recordCheck(at: Long, outcome: CheckOutcome) { if (key != null) checks.add(at to outcome) }
    }

    private val shown = mutableListOf<Pair<NotificationText, String>>()
    private val asked = mutableListOf<Triple<String, String, Long>>()
    private var answer: FetchResult = FetchResult.Body("""{"items":[]}""")
    private val store = FakeStore()

    @Before fun reset() { shown.clear(); asked.clear() }

    private fun run(): CheckResult = runFull().result

    private fun runFull(): CheckRun =
        NotificationCheck(store, { u, k, a -> asked.add(Triple(u, k, a)); answer }, { t, target -> shown.add(t to target) }, { 1000L }).run()

    private fun item(id: Long, kind: String = "vote", token: String = "tok") =
        """{"id":$id,"createdAt":"2026-11-04T10:00:00.000Z","data":{"kind":"$kind","pollTitle":"Grillen","actorName":"Anna","shareToken":"$token"}}"""

    @Test
    fun showsNewItemsOldestFirstAndAdvancesTheLastId() {
        answer = FetchResult.Body("""{"items":[${item(9, "reminder", "b")},${item(7, "vote", "a")},${item(5)},${item(8, "all_voted", "a")}]}""")
        assertEquals(CheckResult.CONTINUE, run())
        assertEquals(listOf("a:vote", "a:all_voted", "b:reminder"), shown.map { it.first.tag }) // id 5 is not new
        assertEquals("https://dr-nerdlove.github.io/gapfinder/#/abstimmung/a", shown[0].second)
        assertEquals(9L, store.last)
        assertEquals(listOf(Triple("https://api.example", "k1", 5L)), asked)
    }

    @Test
    fun emptyListKeepsTheLastId() {
        assertEquals(CheckResult.CONTINUE, run())
        assertEquals(0, shown.size)
        assertEquals(5L, store.last)
    }

    @Test
    fun unauthorizedClearsEverythingAndStops() {
        answer = FetchResult.Unauthorized
        assertEquals(CheckResult.STOP, run())
        assertNull(store.key)
        assertNull(store.url)
        assertEquals(0, shown.size)
    }

    @Test
    fun noKeyStopsWithoutAsking() {
        store.key = null
        assertEquals(CheckResult.STOP, run())
        assertEquals(0, asked.size)
    }

    @Test
    fun networkErrorOrServerErrorKeepsEverything() {
        answer = FetchResult.Unavailable
        assertEquals(CheckResult.CONTINUE, run())
        assertEquals("k1", store.key)
        assertEquals(5L, store.last)
        assertEquals(0, shown.size)
    }

    @Test
    fun malformedAnswersDoNotCrashAndKeepTheLastId() {
        for (bad in listOf("", "not json", "[]", "{}", """{"items":5}""", """{"items":[1,"x",null,{"id":"7"},{"data":{}}]}""")) {
            answer = FetchResult.Body(bad)
            assertEquals(bad, CheckResult.CONTINUE, run())
            assertEquals(bad, 5L, store.last)
            assertEquals(bad, 0, shown.size)
        }
    }

    @Test
    fun anItemThatCannotBeShownIsTriedAgainNextTime() {
        answer = FetchResult.Body("""{"items":[${item(6)},${item(7)}]}""")
        var calls = 0
        val check = NotificationCheck(store, { _, _, _ -> answer }, { _, _ -> if (++calls == 2) throw IllegalStateException("no") }, { 1000L })
        assertEquals(CheckResult.CONTINUE, check.run().result)
        assertEquals(6L, store.last)
    }

    @Test
    fun anItemWithoutDataGetsTheGeneralText() {
        answer = FetchResult.Body("""{"items":[{"id":6}]}""")
        run()
        assertEquals("Es gibt Neuigkeiten.", shown.single().first.body)
        assertEquals(6L, store.last)
    }

    @Test
    fun okWithItemsIsRecordedWithTheClockTime() {
        answer = FetchResult.Body("""{"items":[${item(7)}]}""")
        assertEquals(CheckRun(CheckResult.CONTINUE, CheckOutcome.OK), runFull())
        assertEquals(listOf(1000L to CheckOutcome.OK), store.checks)
    }

    @Test
    fun okWithoutItemsIsRecorded() {
        assertEquals(CheckOutcome.OK, runFull().outcome)
        assertEquals(listOf(1000L to CheckOutcome.OK), store.checks)
    }

    @Test
    fun unavailableIsRecorded() {
        answer = FetchResult.Unavailable
        assertEquals(CheckRun(CheckResult.CONTINUE, CheckOutcome.UNAVAILABLE), runFull())
        assertEquals(listOf(1000L to CheckOutcome.UNAVAILABLE), store.checks)
    }

    @Test
    fun anUnreadableAnswerIsBroken() {
        for (bad in listOf("", "not json", "[]", "{}", """{"items":5}""")) {
            store.checks.clear()
            answer = FetchResult.Body(bad)
            assertEquals(bad, CheckRun(CheckResult.CONTINUE, CheckOutcome.BROKEN), runFull())
            assertEquals(bad, listOf(1000L to CheckOutcome.BROKEN), store.checks)
        }
    }

    @Test
    fun aFailedNotificationIsBroken() {
        answer = FetchResult.Body("""{"items":[${item(6)}]}""")
        val check = NotificationCheck(store, { _, _, _ -> answer }, { _, _ -> throw IllegalStateException("no") }, { 1000L })
        assertEquals(CheckRun(CheckResult.CONTINUE, CheckOutcome.BROKEN), check.run())
        assertEquals(listOf(1000L to CheckOutcome.BROKEN), store.checks)
    }

    @Test
    fun unauthorizedStopsAndWritesNoCheck() {
        store.checks.add(1L to CheckOutcome.OK)
        answer = FetchResult.Unauthorized
        assertEquals(CheckRun(CheckResult.STOP, CheckOutcome.STOPPED), runFull())
        assertEquals(0, store.checks.size) // cleared with everything else, nothing new
    }

    @Test
    fun missingKeyStopsAndWritesNoCheck() {
        store.key = null
        assertEquals(CheckRun(CheckResult.STOP, CheckOutcome.STOPPED), runFull())
        assertEquals(0, store.checks.size)
    }

    @Test
    fun aCheckIsNotWrittenBackWhenTheKeyIsGoneMeanwhile() {
        answer = FetchResult.Body("""{"items":[]}""")
        val check = NotificationCheck(store, { _, _, _ -> store.key = null; answer }, { _, _ -> }, { 1000L })
        check.run()
        assertEquals(0, store.checks.size)
    }
}
