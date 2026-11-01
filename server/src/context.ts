import type { DatabaseSync } from "node:sqlite";
import type { RateLimiter } from "./auth/rate-limit.js";
import type { CalendarKeyStatus } from "./calendar-key.js";
import type { CalendarCache } from "./calendars/cache.js";
import type { FetchResult } from "./calendars/fetch.js";
import type { Config } from "./config.js";

/** Everything a route needs; built once per app so tests can swap the clock and the database. */
export interface AppContext {
  config: Config;
  db: DatabaseSync;
  /** The only source of "now": tests move it to check expiry. */
  now: () => Date;
  limiter: RateLimiter;
  /** Whether the configured calendar key is missing, matches the stored links, or does not. Set at startup. */
  calendarKeyStatus: CalendarKeyStatus;
  /** Calendar contents, in memory only. One per app, so tests start empty. */
  calendarCache: CalendarCache;
  /** Fetches a calendar link. Every outgoing request for a user's link goes through here (tests swap it). */
  fetchCalendarText: (url: URL) => Promise<FetchResult>;
}
