package de.drnerdlove.lueckenfueller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushTokenSyncTest {
    private class FakeStore(
        var url: String? = "https://api.example",
        var key: String? = "k1",
        override var pushToken: String? = "t1",
        override var pushTokenSent: String? = null,
        override var pushTokenSentAt: Long = 0,
        override var pushInstant: Boolean = false,
    ) : PushStore {
        override val apiUrl get() = url
        override val deviceKey get() = key
        override fun recordPushSent(token: String, at: Long, instant: Boolean) {
            pushTokenSent = token; pushTokenSentAt = at; pushInstant = instant
        }
    }

    private val day = PushTokenRules.RESEND_AFTER_MS
    private val sent = mutableListOf<Triple<String, String, String>>()
    private var answer: PushSendResult = PushSendResult.Sent(true)
    private val store = FakeStore()

    private fun sync(now: Long = 1000L): Boolean =
        PushTokenSync(store, { u, k, t -> sent.add(Triple(u, k, t)); answer }, { now }).sync()

    @Test fun needsSendWithoutAToken() {
        assertFalse(PushTokenRules.needsSend(null, null, 0, 10))
        assertFalse(PushTokenRules.needsSend("", "x", 0, 10))
    }

    @Test fun needsSendForANewOrChangedToken() {
        assertTrue(PushTokenRules.needsSend("a", null, 0, 10))
        assertTrue(PushTokenRules.needsSend("b", "a", 5, 10))
    }

    @Test fun needsSendOnlyAfterADayForTheSameToken() {
        assertFalse(PushTokenRules.needsSend("a", "a", 100, 100 + day))
        assertTrue(PushTokenRules.needsSend("a", "a", 100, 101 + day))
    }

    @Test fun sentRecordsTokenTimeAndInstant() {
        assertTrue(sync(5000))
        assertEquals(listOf(Triple("https://api.example", "k1", "t1")), sent)
        assertEquals("t1", store.pushTokenSent)
        assertEquals(5000L, store.pushTokenSentAt)
        assertTrue(store.pushInstant)
    }

    @Test fun serverThatCannotRingRecordsInstantFalse() {
        answer = PushSendResult.Sent(false)
        assertTrue(sync())
        assertEquals("t1", store.pushTokenSent)
        assertFalse(store.pushInstant)
    }

    @Test fun unavailableRecordsNothing() {
        answer = PushSendResult.Unavailable
        assertFalse(sync())
        assertEquals(1, sent.size)
        assertEquals(null, store.pushTokenSent)
        assertEquals(0L, store.pushTokenSentAt)
    }

    @Test fun unauthorizedRecordsNothing() {
        answer = PushSendResult.Unauthorized
        assertFalse(sync())
        assertEquals(null, store.pushTokenSent)
    }

    @Test fun nothingIsSentWhenAlreadyKnown() {
        store.pushTokenSent = "t1"; store.pushTokenSentAt = 900
        assertFalse(sync(1000))
        assertEquals(0, sent.size)
    }

    @Test fun nothingIsSentWithoutKeyOrToken() {
        store.key = null
        assertFalse(sync())
        store.key = "k1"; store.pushToken = null
        assertFalse(sync())
        assertEquals(0, sent.size)
    }

    @Test fun parseInstantReadsTheAnswer() {
        assertTrue(PushTokenRules.parseInstant("""{"instant":true}"""))
        assertFalse(PushTokenRules.parseInstant("""{"instant":false}"""))
        assertFalse(PushTokenRules.parseInstant("""{}"""))
        assertFalse(PushTokenRules.parseInstant("no json"))
    }

    @Test fun instantStatusNeedsEverythingInPlace() {
        store.pushTokenSent = "t1"; store.pushInstant = true
        assertTrue(PushTokenRules.isInstant(true, true, store))
        assertFalse(PushTokenRules.isInstant(false, true, store))
        assertFalse(PushTokenRules.isInstant(true, false, store))
        store.pushInstant = false
        assertFalse(PushTokenRules.isInstant(true, true, store))
        store.pushInstant = true; store.pushToken = "t2" // refreshed, not yet sent
        assertFalse(PushTokenRules.isInstant(true, true, store))
        store.pushToken = null
        assertFalse(PushTokenRules.isInstant(true, true, store))
    }

    private fun checkThenSync(result: CheckResult, syncToken: Boolean = true): Boolean {
        val run = CheckRun(result, CheckOutcome.OK)
        runCheckThenSync({ run }, syncToken, PushTokenSync(store, { u, k, t -> sent.add(Triple(u, k, t)); answer }, { 1000L }))
        return sent.isNotEmpty()
    }

    @Test fun syncRunsAfterAnOrdinaryCheck() = assertTrue(checkThenSync(CheckResult.CONTINUE))

    @Test fun syncIsSkippedWhenTheCheckStops() = assertFalse(checkThenSync(CheckResult.STOP))

    @Test fun syncIsSkippedOnTheRingPath() = assertFalse(checkThenSync(CheckResult.CONTINUE, syncToken = false))
}
