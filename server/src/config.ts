import { join } from "node:path";
import { normalizeCalendarUrl } from "./calendars/fetch.js";
import { PROPOSAL_PLACE_MAX_LENGTH, type CinemaInfo } from "@lueckenfueller/shared";
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
  /** Trust one proxy hop: the last `X-Forwarded-For` entry is the visitor address. Only behind a proxy you control. */
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
  /** Firebase service account for the "doorbell" (instant Android notifications); null when missing or invalid. */
  fcm: FcmAccount | null;
  /** Why `fcm` is null (never contains the value); null when the key is usable. */
  fcmProblem: string | null;
  /** Cinemas for the admin-only showtimes test (`CINEMAS`); empty when not set or invalid (the feature is then off). */
  cinemas: CinemaConfig[];
  /** Why `cinemas` is empty (never contains the value); null when cinemas are configured. */
  cinemasProblem: string | null;
}

/** A configured cinema as the server knows it: `roomPage` (the address of a page of the cinema's site) never leaves the server. */
export interface CinemaConfig extends CinemaInfo {
  roomPage?: string;
}

export const MAX_CINEMAS = 20;
export const MAX_CINEMA_ROOM_PAGE_LENGTH = 300;
export const MAX_CINEMA_ROOM_LENGTH = 60;

export interface FcmAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
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

/**
 * Reads `FCM_SERVICE_ACCOUNT`: standard base64 of Firebase's service-account JSON file. Like the calendar key, a
 * missing or invalid value is a problem text, never an error, and the text never contains the value.
 */
export function parseFcmAccount(value: string | undefined): { account: FcmAccount | null; problem: string | null } {
  const text = value?.trim() ?? "";
  if (text === "") return { account: null, problem: "FCM_SERVICE_ACCOUNT is not set" };
  const invalid = (why: string) => ({ account: null, problem: `FCM_SERVICE_ACCOUNT is not valid: ${why}` });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) return invalid("it must be standard base64");
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
  } catch {
    return invalid("it does not contain a JSON file");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return invalid("the JSON is not an object");
  const file = json as Record<string, unknown>;
  if (file.type !== "service_account") return invalid('"type" is not "service_account"');
  if (typeof file.project_id !== "string" || !/^[a-z0-9-]+$/.test(file.project_id)) {
    return invalid('"project_id" is missing or malformed');
  }
  if (typeof file.client_email !== "string" || file.client_email === "") return invalid('"client_email" is missing');
  if (typeof file.private_key !== "string" || !file.private_key.includes("-----BEGIN PRIVATE KEY-----")) {
    return invalid('"private_key" is missing or malformed');
  }
  return {
    account: { projectId: file.project_id, clientEmail: file.client_email, privateKey: file.private_key },
    problem: null,
  };
}

/**
 * Reads `CINEMAS`: `<cineamo id>=<name>;<id>=<name>`, each optionally with a preferred screen: `<id>=<name>|<screen>`, and the screen with the address of a page that lists its showings: `<id>=<name>|<screen>@<https address>`. Like the keys, a missing or invalid value is a problem text,
 * never an error, and the text never contains the value. One broken entry makes the whole value invalid.
 */
export function parseCinemas(value: string | undefined): { cinemas: CinemaConfig[]; problem: string | null } {
  const text = value?.trim() ?? "";
  if (text === "") return { cinemas: [], problem: "CINEMAS is not set" };
  const invalid = (why: string) => ({ cinemas: [], problem: `CINEMAS is not valid: ${why}` });
  const entries = text.split(";").map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (entries.length === 0) return invalid("it has no entries");
  if (entries.length > MAX_CINEMAS) return invalid(`at most ${MAX_CINEMAS} cinemas are allowed`);
  const cinemas: CinemaConfig[] = [];
  const seen = new Set<number>();
  for (const entry of entries) {
    const at = entry.indexOf("=");
    const idText = at < 0 ? "" : entry.slice(0, at).trim();
    const rest = at < 0 ? "" : entry.slice(at + 1);
    const bar = rest.indexOf("|");
    const name = (bar < 0 ? rest : rest.slice(0, bar)).trim();
    const afterBar = bar < 0 ? undefined : rest.slice(bar + 1);
    const atSign = afterBar?.indexOf("@") ?? -1;
    const room = afterBar === undefined ? undefined : (atSign < 0 ? afterBar : afterBar.slice(0, atSign)).trim();
    const pageText = afterBar === undefined || atSign < 0 ? undefined : afterBar.slice(atSign + 1).trim();
    if (!/^\d{1,9}$/.test(idText) || Number(idText) < 1) {
      return invalid("every entry must look like <id>=<name> with a whole number as id");
    }
    if (name === "" || [...name].length > PROPOSAL_PLACE_MAX_LENGTH) {
      return invalid(`every name must have 1 to ${PROPOSAL_PLACE_MAX_LENGTH} characters`);
    }
    if (room !== undefined && (room === "" || room.includes("|") || [...room].length > MAX_CINEMA_ROOM_LENGTH)) {
      return invalid(`a screen after "|" must have 1 to ${MAX_CINEMA_ROOM_LENGTH} characters and no second "|"`);
    }
    let roomPage: string | undefined;
    if (pageText !== undefined) {
      const url = pageText.length > MAX_CINEMA_ROOM_PAGE_LENGTH ? null : normalizeCalendarUrl(pageText);
      if (url === null) {
        return invalid(`an address after "@" must be a public https address of at most ${MAX_CINEMA_ROOM_PAGE_LENGTH} characters`);
      }
      roomPage = url.href;
    }
    const id = Number(idText);
    if (seen.has(id)) return invalid("an id is listed twice");
    seen.add(id);
    cinemas.push({ id, name, ...(room === undefined ? {} : { room }), ...(roomPage === undefined ? {} : { roomPage }) });
  }
  return { cinemas, problem: null };
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
  // The same holds for the Firebase key: without it only the instant ring is off, the 15-minute check carries on.
  const fcm = parseFcmAccount(env.FCM_SERVICE_ACCOUNT);

  // Likewise the cinema list: a bad value only switches the showtimes test off.
  const cinemas = parseCinemas(env.CINEMAS);

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
    fcm: fcm.account,
    fcmProblem: fcm.problem,
    cinemas: cinemas.cinemas,
    cinemasProblem: cinemas.problem,
  };
}
