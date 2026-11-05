package de.drnerdlove.lueckenfueller

/** One lock for every check (the worker, "check now", the check on open): they never run at the same time. */
object CheckLock {
    fun <T> withLock(block: () -> T): T = synchronized(this) { block() }
}
