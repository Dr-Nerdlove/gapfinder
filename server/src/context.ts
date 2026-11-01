import type { DatabaseSync } from "node:sqlite";
import type { RateLimiter } from "./auth/rate-limit.js";
import type { Config } from "./config.js";

/** Everything a route needs; built once per app so tests can swap the clock and the database. */
export interface AppContext {
  config: Config;
  db: DatabaseSync;
  /** The only source of "now": tests move it to check expiry. */
  now: () => Date;
  limiter: RateLimiter;
}
