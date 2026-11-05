package de.drnerdlove.lueckenfueller

import android.content.Intent
import android.os.Bundle
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
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (!restored) openTarget(intent)
    }

    /** A tap on a notification carries the address to open; only addresses inside the app are loaded. */
    private fun openTarget(intent: Intent?) {
        val url = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return
        intent.removeExtra(EXTRA_OPEN_URL)
        if (!NotificationTexts.isAppUrl(url)) return
        bridge?.webView?.post { bridge?.webView?.loadUrl(url) }
    }

    companion object {
        const val EXTRA_OPEN_URL = "de.drnerdlove.lueckenfueller.OPEN_URL"
    }
}
