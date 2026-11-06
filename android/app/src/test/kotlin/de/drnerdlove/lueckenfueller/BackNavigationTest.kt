package de.drnerdlove.lueckenfueller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BackNavigationTest {
    private val start = "https://dr-nerdlove.github.io/gapfinder/#/"
    private val profile = "https://dr-nerdlove.github.io/gapfinder/#/profil"
    private val calendars = "https://dr-nerdlove.github.io/gapfinder/#/kalender"
    private val offline = "https://localhost/offline.html"

    @Test
    fun stepsBackOnePageAtATime() {
        val urls = listOf(start, profile, calendars)
        assertEquals(1, BackNavigation.steps(urls, 2))
        assertEquals(1, BackNavigation.steps(urls, 1))
    }

    @Test
    fun leavesTheAppOnTheFirstPage() {
        assertNull(BackNavigation.steps(listOf(start), 0))
        assertNull(BackNavigation.steps(listOf(start, profile), 0))
    }

    @Test
    fun skipsPagesThatAreNotTheApp() {
        assertEquals(2, BackNavigation.steps(listOf(start, offline, profile), 2))
        assertNull(BackNavigation.steps(listOf(offline, start), 1))
    }

    @Test
    fun leavesTheAppFromAPageThatIsNotTheApp() {
        assertNull(BackNavigation.steps(listOf(start, offline), 1))
    }

    @Test
    fun copesWithAnEmptyOrBrokenHistory() {
        assertNull(BackNavigation.steps(emptyList(), -1))
        assertNull(BackNavigation.steps(listOf(start, null, profile), 5))
        assertEquals(2, BackNavigation.steps(listOf(start, null, profile), 2))
    }
}
