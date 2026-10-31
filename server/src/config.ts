import { join } from "node:path";

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
  /** Pino log level; `silent` turns logging off (tests). */
  logLevel: LogLevel;
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

  const logLevelText = get("LOG_LEVEL", "info").toLowerCase();
  const logLevel = LOG_LEVELS.find((level) => level === logLevelText);
  if (!logLevel) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (got "${logLevelText}")`);
  }

  if (problems.length > 0 || !logLevel) {
    throw new ConfigError(problems);
  }

  return {
    port,
    host,
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE_NAME),
    corsOrigins,
    appVersion,
    trustProxy: trustProxyText === "true",
    logLevel,
  };
}
