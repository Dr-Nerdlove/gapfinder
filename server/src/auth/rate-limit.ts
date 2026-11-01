export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURES_PER_USERNAME = 5;
export const LOGIN_FAILURES_PER_IP = 20;
export const PASSWORD_FAILURES_PER_USER = 5;
export const TOKEN_FAILURES_PER_IP = 30;

/**
 * Counts failed attempts per key within a sliding window, in memory (a restart forgets them, which is fine for
 * a few friends). Only failures are counted, so honest use never runs into the limit.
 */
export class RateLimiter {
  private readonly failures = new Map<string, number[]>();
  private lastSweep: number;

  constructor(
    private readonly now: () => Date,
    private readonly windowMs: number = RATE_WINDOW_MS,
  ) {
    this.lastSweep = now().getTime();
  }

  /** Seconds to wait when `key` already has `limit` failures in the window, otherwise null. */
  blockedFor(key: string, limit: number): number | null {
    const times = this.recent(key);
    if (times.length < limit) return null;
    const freesUp = times[times.length - limit]! + this.windowMs;
    return Math.max(1, Math.ceil((freesUp - this.now().getTime()) / 1000));
  }

  /** The largest wait over several (key, limit) pairs, or null when none is blocked. */
  blockedForAny(checks: readonly (readonly [key: string, limit: number])[]): number | null {
    let longest: number | null = null;
    for (const [key, limit] of checks) {
      const wait = this.blockedFor(key, limit);
      if (wait !== null && (longest === null || wait > longest)) longest = wait;
    }
    return longest;
  }

  recordFailure(key: string): void {
    this.sweep();
    const times = this.recent(key);
    times.push(this.now().getTime());
    this.failures.set(key, times);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now().getTime() - this.windowMs;
    const times = (this.failures.get(key) ?? []).filter((time) => time > cutoff);
    if (times.length === 0) this.failures.delete(key);
    else this.failures.set(key, times);
    return times;
  }

  /** Drops keys whose failures have all expired, at most once per window. */
  private sweep(): void {
    const now = this.now().getTime();
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const key of [...this.failures.keys()]) this.recent(key);
  }
}
