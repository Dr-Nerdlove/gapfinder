package de.drnerdlove.lueckenfueller

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PluginArgsTest {
    @Test
    fun smallJsNumbersArriveAsInteger() {
        assertEquals(0L, wholeNumberArg(0))
        assertEquals(7L, wholeNumberArg(7))
    }

    @Test
    fun longStaysTheSame() {
        assertEquals(5_000_000_000L, wholeNumberArg(5_000_000_000L))
    }

    @Test
    fun wholeDoubleIsAccepted() {
        assertEquals(7L, wholeNumberArg(7.0))
    }

    @Test
    fun otherValuesAreRejected() {
        assertNull(wholeNumberArg(7.5))
        assertNull(wholeNumberArg(Double.NaN))
        assertNull(wholeNumberArg(Double.POSITIVE_INFINITY))
        assertNull(wholeNumberArg("7"))
        assertNull(wholeNumberArg(null))
        assertNull(wholeNumberArg(JSONObject.NULL))
    }
}
