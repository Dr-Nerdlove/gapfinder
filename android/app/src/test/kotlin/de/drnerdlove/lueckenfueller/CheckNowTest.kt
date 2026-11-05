package de.drnerdlove.lueckenfueller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class CheckNowTest {
    @Test
    fun theWireWordsOfCheckNow() {
        assertEquals("ok", LueckenfuellerPlugin.resultWire(CheckOutcome.OK))
        assertEquals("unavailable", LueckenfuellerPlugin.resultWire(CheckOutcome.UNAVAILABLE))
        assertEquals("error", LueckenfuellerPlugin.resultWire(CheckOutcome.BROKEN))
        assertEquals("off", LueckenfuellerPlugin.resultWire(CheckOutcome.STOPPED))
    }

    @Test
    fun twoChecksNeverRunAtTheSameTime() {
        val inside = AtomicInteger(0)
        var overlapped = false
        val start = CountDownLatch(1)
        val threads = List(4) {
            Thread {
                start.await()
                repeat(50) {
                    CheckLock.withLock {
                        if (inside.incrementAndGet() > 1) overlapped = true
                        Thread.sleep(0, 1000)
                        inside.decrementAndGet()
                    }
                }
            }.also { it.start() }
        }
        start.countDown()
        threads.forEach { it.join() }
        assertFalse(overlapped)
    }
}
