package de.drnerdlove.lueckenfueller

import org.junit.Assert.assertEquals
import org.junit.Test

class FileNameTest {
    @Test
    fun keepsOnlyAPlainFileName() {
        assertEquals("termin.ics", LueckenfuellerPlugin.safeFileName("termin.ics"))
        assertEquals("passwd", LueckenfuellerPlugin.safeFileName("../../etc/passwd"))
        assertEquals("x.ics", LueckenfuellerPlugin.safeFileName("C:\\a\\x.ics"))
        assertEquals("datei", LueckenfuellerPlugin.safeFileName(".."))
        assertEquals("datei", LueckenfuellerPlugin.safeFileName(null))
        assertEquals("a_b.ics", LueckenfuellerPlugin.safeFileName("a b.ics"))
    }
}
