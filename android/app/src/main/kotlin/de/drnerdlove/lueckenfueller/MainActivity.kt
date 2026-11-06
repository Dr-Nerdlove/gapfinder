package de.drnerdlove.lueckenfueller

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    private var restored = false

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(LueckenfuellerPlugin::class.java) // must come before super.onCreate, which builds the bridge
        // A recreated activity (after the system ended the process) must not jump to the old tap target again.
        // BridgeActivity hands the start intent to onNewIntent itself, at the end of its onCreate.
        restored = savedInstanceState != null
        super.onCreate(savedInstanceState)
        restored = false
        onBackPressedDispatcher.addCallback(this, backToEarlierPage)
    }

    /**
     * Capacitor has no Back handling of its own, so Android's Back gesture used to close the app on every page.
     * Now it goes to the app's previous page, and only on the first page does it leave the app as usual.
     */
    private val backToEarlierPage = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val steps = try {
                val webView = bridge?.webView
                val history = webView?.copyBackForwardList()
                val found = history?.let { list ->
                    BackNavigation.steps((0 until list.size).map { list.getItemAtIndex(it)?.url }, list.currentIndex)
                }
                if (webView != null && found != null) webView.goBackOrForward(-found)
                found
            } catch (e: RuntimeException) {
                null // never trap the user in the app
            }
            if (steps != null) return
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (!restored) openTarget(intent)
    }

    override fun onResume() {
        super.onResume()
        // Opening the app anywhere looks for news once (at most once a minute), as a background job so the lock applies.
        val now = SystemClock.elapsedRealtime()
        if (lastOpenCheck != 0L && now - lastOpenCheck < OPEN_CHECK_GAP_MS) return
        try {
            if (CheckStorage(this).deviceKey == null) return
            lastOpenCheck = now
            CheckWorker.checkOnce(this)
        } catch (e: RuntimeException) {
            // Never let the optional check keep the app from opening.
        }
    }

    /** A tap on a notification carries the address to open; only addresses inside the app are loaded. */
    private fun openTarget(intent: Intent?) {
        val url = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return
        intent.removeExtra(EXTRA_OPEN_URL)
        if (!NotificationTexts.isAppUrl(url)) return
        bridge?.webView?.post { bridge?.webView?.loadUrl(url) }
    }

    companion object {
        private const val OPEN_CHECK_GAP_MS = 60_000L
        private var lastOpenCheck = 0L // in memory only: a new process checks again

        const val EXTRA_OPEN_URL = "de.drnerdlove.lueckenfueller.OPEN_URL"
    }
}
