package de.drnerdlove.lueckenfueller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateTest {
    private val sha = "a".repeat(64)

    private fun json(version: String = "1.7.0", shell: String = "3", apk: String = "lueckenfueller-1.7.0.apk", hash: String = sha) =
        """{"version":"$version","shell":$shell,"apk":"$apk","sha256":"$hash"}"""

    @Test
    fun parsesAGoodFile() {
        val info = AppUpdate.parse(json())
        assertEquals(AppUpdateInfo("1.7.0", 3, "lueckenfueller-1.7.0.apk", sha), info)
    }

    @Test
    fun refusesAnythingOdd() {
        assertNull(AppUpdate.parse("not json"))
        assertNull(AppUpdate.parse("{}"))
        assertNull(AppUpdate.parse(json(version = "1.7")))
        assertNull(AppUpdate.parse(json(version = "v1.7.0", apk = "lueckenfueller-v1.7.0.apk")))
        assertNull(AppUpdate.parse(json(shell = "0")))
        assertNull(AppUpdate.parse(json(shell = "-1")))
        assertNull(AppUpdate.parse(json(shell = "\"3\"")))
        assertNull(AppUpdate.parse(json(shell = "3.5")))
        assertNull(AppUpdate.parse(json(apk = "lueckenfueller-1.6.0.apk")))
        assertNull(AppUpdate.parse(json(apk = "https://evil.example/lueckenfueller-1.7.0.apk")))
        assertNull(AppUpdate.parse(json(hash = "a".repeat(63))))
        assertNull(AppUpdate.parse(json(hash = "g".repeat(64))))
    }

    @Test
    fun offersAnUpdateOnlyForANewerShell() {
        val info = AppUpdate.parse(json(shell = "3"))!!
        assertTrue(AppUpdate.isAvailable(info, 2))
        assertFalse(AppUpdate.isAvailable(info, 3))
        assertFalse(AppUpdate.isAvailable(info, 4))
        assertEquals("available", AppUpdate.state(info, 2))
        assertEquals("current", AppUpdate.state(info, 3))
        assertEquals("unknown", AppUpdate.state(null, 3))
    }

    @Test
    fun buildsTheApkAddressItself() {
        assertEquals(
            "https://github.com/Dr-Nerdlove/gapfinder/releases/download/v1.7.0/lueckenfueller-1.7.0.apk",
            AppUpdate.apkUrl("1.7.0"),
        )
        assertEquals("https://github.com/Dr-Nerdlove/gapfinder/releases/latest/download/app-update.json", AppUpdate.JSON_URL)
    }

    @Test
    fun allowsOnlyHttpsOnGithubHosts() {
        assertTrue(AppUpdate.isAllowedUrl("https://github.com/Dr-Nerdlove/gapfinder/releases/latest/download/app-update.json"))
        assertTrue(AppUpdate.isAllowedUrl("https://release-assets.githubusercontent.com/x?y=1"))
        assertTrue(AppUpdate.isAllowedUrl("https://objects.githubusercontent.com/x"))
        assertFalse(AppUpdate.isAllowedUrl("http://github.com/x"))
        assertFalse(AppUpdate.isAllowedUrl("https://evil.example/x"))
        assertFalse(AppUpdate.isAllowedUrl("https://github.com.evil.example/x"))
        assertFalse(AppUpdate.isAllowedUrl("https://evilgithub.com/x"))
        assertFalse(AppUpdate.isAllowedUrl("https://github.com@evil.example/x"))
        assertFalse(AppUpdate.isAllowedUrl("https://github.com:8443/x"))
        assertFalse(AppUpdate.isAllowedUrl("ftp://github.com/x"))
        assertFalse(AppUpdate.isAllowedUrl("not a url"))
    }

    @Test
    fun followsOnlyAllowedRedirects() {
        val from = "https://github.com/a/b"
        assertEquals("https://release-assets.githubusercontent.com/x", AppUpdate.nextHop(from, "https://release-assets.githubusercontent.com/x"))
        assertEquals("https://github.com/other/path", AppUpdate.nextHop(from, "/other/path"))
        assertNull(AppUpdate.nextHop(from, "https://evil.example/x"))
        assertNull(AppUpdate.nextHop(from, "http://github.com/x"))
        assertNull(AppUpdate.nextHop(from, null))
        assertNull(AppUpdate.nextHop(from, ""))
        assertNull(AppUpdate.nextHop(from, "https://exa mple/x"))
    }

    @Test
    fun comparesTheChecksum() {
        val bytes = "hello".toByteArray()
        val hash = AppUpdate.sha256Hex(bytes)
        assertEquals("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", hash)
        assertTrue(AppUpdate.sha256Matches(hash, hash.uppercase()))
        assertFalse(AppUpdate.sha256Matches(hash, AppUpdate.sha256Hex("hellO".toByteArray())))
    }

    private val cert = byteArrayOf(1, 2, 3)
    private val other = byteArrayOf(9, 9)
    private fun facts(name: String? = "app", signers: List<ByteArray> = listOf(cert), code: Long = 10) = AppUpdate.PackageFacts(name, signers, code)
    private val info = AppUpdate.parse(json())!!

    @Test
    fun comparesSigners() {
        assertTrue(AppUpdate.sameSigners(listOf(cert), listOf(byteArrayOf(1, 2, 3))))
        assertTrue(AppUpdate.sameSigners(listOf(cert, other), listOf(other, cert)))
        assertFalse(AppUpdate.sameSigners(listOf(cert), listOf(other)))
        assertFalse(AppUpdate.sameSigners(listOf(cert), listOf(cert, other)))
        assertFalse(AppUpdate.sameSigners(emptyList(), emptyList()))
    }

    @Test
    fun verifiesAGoodPackage() {
        assertNull(AppUpdate.verify(info, sha, facts(code = 10), facts(code = 11)))
    }

    @Test
    fun verifyRefusesAWrongChecksum() {
        assertEquals(InstallFailure.CHECKSUM, AppUpdate.verify(info, "b".repeat(64), facts(), facts(code = 11)))
    }

    @Test
    fun verifyRefusesAnotherPackageOrNone() {
        assertEquals(InstallFailure.PACKAGE, AppUpdate.verify(info, sha, facts(), facts(name = "evil", code = 11)))
        assertEquals(InstallFailure.PACKAGE, AppUpdate.verify(info, sha, facts(), null))
        assertEquals(InstallFailure.PACKAGE, AppUpdate.verify(info, sha, facts(), facts(name = null, code = 11)))
    }

    @Test
    fun verifyRefusesAnotherSignature() {
        assertEquals(InstallFailure.SIGNATURE, AppUpdate.verify(info, sha, facts(), facts(signers = listOf(other), code = 11)))
        assertEquals(InstallFailure.SIGNATURE, AppUpdate.verify(info, sha, facts(), facts(signers = emptyList(), code = 11)))
    }

    @Test
    fun verifyRefusesANotHigherVersion() {
        assertEquals(InstallFailure.VERSION, AppUpdate.verify(info, sha, facts(code = 10), facts(code = 10)))
        assertEquals(InstallFailure.VERSION, AppUpdate.verify(info, sha, facts(code = 10), facts(code = 9)))
    }

    @Test
    fun verifyChecksInOrder() {
        // Everything is wrong at once: the checksum is reported first, then the package, then the signature.
        val bad = facts(name = "evil", signers = listOf(other), code = 1)
        assertEquals(InstallFailure.CHECKSUM, AppUpdate.verify(info, "b".repeat(64), facts(), bad))
        assertEquals(InstallFailure.PACKAGE, AppUpdate.verify(info, sha, facts(), bad))
        assertEquals(InstallFailure.SIGNATURE, AppUpdate.verify(info, sha, facts(), facts(signers = listOf(other), code = 1)))
    }

    @Test
    fun outcomesUseTheWireWords() {
        assertEquals(InstallOutcome("failed", "signature"), InstallOutcome.failed(InstallFailure.SIGNATURE))
        assertEquals("started", InstallOutcome.STARTED.result)
        assertNull(InstallOutcome.STARTED.reason)
        assertEquals("needs-permission", InstallOutcome.NEEDS_PERMISSION.result)
        assertNotNull(AppUpdate.parse(json()))
    }
}
