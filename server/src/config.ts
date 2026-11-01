import { join } from "node:path";
import { decodeCalendarKey } from "./calendar-key.js";

export interface Config {
  port: number;
  host: string;
  /** Directory that holds the SQLite file. */
  dataDir: string;
  /** Full path of the SQLite file, or `:memory:` (tests). */
  databasePath: string;
  /** Exact origins (scheme + host + port) that may call the API from a browser. */
  corsOrigins: string[];
  appVersion: string;
  /** Trust `X-Forwarded-*` headers. Only switch on behind a proxy you control. */
  trustProxy: boolean;
  /**
   * Address of the web app including its path, always ending with `/` (e.g. `https://user.github.io/gapfinder/`).
   * Only the command line tool needs it, to print invite and password links.
   */
  appUrl: string;
  /** Pino log level; `silent` turns logging off (tests). */
  logLevel: LogLevel;
  /** Key (32 bytes) that encrypts calendar subscription links; null when `CALENDAR_KEY` is missing or invalid. */
  calendarKey: Buffer | null;
  /** Why `calendarKey` is null (never contains the value); null when the key is usable. */
  calendarKeyProblem: string | null;
}

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export const DATABASE_FILE_NAME = "lueckenfueller.sqlite";

type Env = Record<string, string | undefined>;

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

/** The address with a trailing slash, or null when it is not an http(s) address without `#` and `?`. */
function parseAppUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hash !== "" || url.search !== "") {
      return null;
    }
    if (value.includes("#") || value.includes("?")) return null;
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    return null;
  }
}

/**
 * Reads `CALENDAR_KEY`: standard base64 of exactly 32 bytes in its canonical form. A missing or invalid key
 * is reported as a problem text, never as an error, and the text never contains the value.
 */
function parseCalendarKey(value: string | undefined): { key: Buffer | null; problem: string | null } {
  const text = value?.trim() ?? "";
  if (text === "") return { key: null, problem: "CALENDAR_KEY is not set" };
  const key = decodeCalendarKey(text);
  if (key === null) {
    return { key: null, problem: "CALENDAR_KEY is not valid: it must be standard base64 of exactly 32 bytes" };
  }
  return { key, problem: null };
}

/** Reads and validates the configuration. Throws a `ConfigError` that lists every problem. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const get = (name: string, fallback: string): string => {
    const value = env[name]?.trim();
    return value ? value : fallback;
  };

  const portText = get("PORT", "8080");
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    problems.push(`PORT must be a whole number from 1 to 65535 (got "${portText}")`);
  }

  const host = get("HOST", "0.0.0.0");
  const dataDir = get("DATA_DIR", "./data");
  const appVersion = get("APP_VERSION", "dev");

  const corsOrigins = get("CORS_ORIGIN", "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  if (corsOrigins.length === 0) {
    problems.push("CORS_ORIGIN must list at least one origin");
  }
  for (const origin of corsOrigins) {
    if (!isOrigin(origin)) {
      problems.push(
        `CORS_ORIGIN contains "${origin}", which is not an origin like https://example.github.io (no path, no trailing slash, no wildcard)`,
      );
    }
  }

  const trustProxyText = get("TRUST_PROXY", "false").toLowerCase();
  if (trustProxyText !== "true" && trustProxyText !== "false") {
    problems.push(`TRUST_PROXY must be "true" or "false" (got "${trustProxyText}")`);
  }

  const appUrlText = get("APP_URL", "http://localhost:5173/");
  const appUrl = parseAppUrl(appUrlText);
  if (appUrl === null) {
    problems.push(
      `APP_URL must be the web app's address like https://example.github.io/gapfinder/ (http or https, no # or ?; got "${appUrlText}")`,
    );
  }

  const logLevelText = get("LOG_LEVEL", "info").toLowerCase();
  const logLevel = LOG_LEVELS.find((level) => level === logLevelText);
  if (!logLevel) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (got "${logLevelText}")`);
  }

  if (problems.length > 0 || !logLevel || appUrl === null) {
    throw new ConfigError(problems);
  }

  // The calendar key must NEVER make loadConfig throw, whatever is wrong with it. A new server image that
  // fails to start is rolled back by the VM and not retried, and the key only reaches the VM's .env when the
  // owner reruns setup.sh, which happens after the image is already out. So the server starts without a
  // key and says so (log, status); features that need the key stay off until it is set.
  const calendar = parseCalendarKey(env.CALENDAR_KEY);

  return {
    port,
    host,
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE_NAME),
    corsOrigins,
    appVersion,
    trustProxy: trustProxyText === "true",
    appUrl,
    logLevel,
    calendarKey: calendar.key,
    calendarKeyProblem: calendar.problem,
  };
}
