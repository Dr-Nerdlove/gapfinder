package de.drnerdlove.lueckenfueller

/** Where Android's Back gesture leads inside the app's WebView. */
object BackNavigation {
    /**
     * How many entries Back steps back in the WebView history ([urls], oldest first, [current] = the page shown now):
     * to the nearest earlier page of the app, skipping anything else (such as the offline page). `null` means there is
     * no earlier app page, or the page shown now is not one of the app's, so Back leaves the app.
     */
    fun steps(urls: List<String?>, current: Int): Int? {
        if (current !in urls.indices || !NotificationTexts.isAppUrl(urls[current])) return null
        for (index in current - 1 downTo 0) {
            if (NotificationTexts.isAppUrl(urls[index])) return current - index
        }
        return null
    }
}
