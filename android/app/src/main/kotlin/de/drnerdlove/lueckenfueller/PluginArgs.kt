package de.drnerdlove.lueckenfueller

/**
 * Reads a number the web app sent through Capacitor. `PluginCall.getLong` returns null unless the JSON value is a
 * java.lang.Long, but a JS number such as 0 or 7 arrives as an Integer; so read it by hand. Returns null for
 * anything that is not a whole number (strings, NaN, 7.5, null, JSONObject.NULL).
 */
fun wholeNumberArg(value: Any?): Long? = when (value) {
    is Long -> value
    is Int -> value.toLong()
    is Short -> value.toLong()
    is Byte -> value.toLong()
    is Double -> if (value.isFinite() && value == Math.floor(value)) value.toLong() else null
    is Float -> if (value.isFinite() && value == Math.floor(value.toDouble()).toFloat()) value.toLong() else null
    else -> null
}
