import type { LightMyRequestResponse } from "fastify";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { createSession } from "../src/accounts/sessions.js";
import { insertUser } from "../src/accounts/users.js";
import { buildApp, type BuildAppOptions } from "../src/app.js";
import { hashPassword } from "../src/auth/passwords.js";
import type { Config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { usernameKey } from "@lueckenfueller/shared";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir: ":memory:",
    databasePath: ":memory:",
    corsOrigins: ["https://friends.example.github.io"],
    appVersion: "test",
    trustProxy: false,
    appUrl: "https://friends.example.github.io/app/",
    logLevel: "silent",
    ...overrides,
  };
}

/** A clock the test moves by hand. */
export class TestClock {
  private time: number;
  constructor(start = "2026-11-01T10:00:00.000Z") {
    this.time = Date.parse(start);
  }
  readonly now = (): Date => new Date(this.time);
  advance(ms: number): void {
    this.time += ms;
  }
  advanceMinutes(minutes: number): void {
    this.advance(minutes * 60 * 1000);
  }
  advanceHours(hours: number): void {
    this.advance(hours * 60 * 60 * 1000);
  }
  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }
}

export interface TestEnv {
  app: FastifyInstance;
  db: DatabaseSync;
  clock: TestClock;
}

export async function createTestEnv(
  overrides: Partial<Config> = {},
  options: Omit<BuildAppOptions, "now" | "db"> = {},
): Promise<TestEnv> {
  const clock = new TestClock();
  const db = openDatabase(":memory:");
  const app = await buildApp(testConfig(overrides), { ...options, now: clock.now, db });
  return { app, db, clock };
}

const hashCache = new Map<string, Promise<string>>();
export const DEFAULT_PASSWORD = "correct horse battery";

/** Inserts a user straight into the database (hashes are cached, hashing is slow on purpose). */
export async function addUser(
  env: TestEnv,
  username: string,
  options: { password?: string; isAdmin?: boolean } = {},
): Promise<{ id: number; username: string; password: string }> {
  const password = options.password ?? DEFAULT_PASSWORD;
  let hash = hashCache.get(password);
  if (!hash) {
    hash = hashPassword(password);
    hashCache.set(password, hash);
  }
  const id = insertUser(env.db, {
    username,
    usernameKey: usernameKey(username),
    passwordHash: await hash,
    isAdmin: options.isAdmin ?? false,
    createdAt: env.clock.now().toISOString(),
  });
  return { id, username, password };
}

/** A user plus a ready session token. */
export async function addUserWithSession(
  env: TestEnv,
  username: string,
  options: { password?: string; isAdmin?: boolean } = {},
): Promise<{ id: number; username: string; password: string; token: string }> {
  const user = await addUser(env, username, options);
  return { ...user, token: createSession(env.db, user.id, env.clock.now()) };
}

export function call(
  env: TestEnv,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options: { token?: string; body?: unknown; ip?: string } = {},
): Promise<LightMyRequestResponse> {
  return env.app.inject({
    method,
    url,
    ...(options.token ? { headers: { authorization: `Bearer ${options.token}` } } : {}),
    ...(options.body !== undefined ? { payload: options.body as object } : {}),
    ...(options.ip ? { remoteAddress: options.ip } : {}),
  });
}

/** Every string value in a JSON document, to look for secrets that must not leak. */
export function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, v]) => [key, ...allStrings(v)]);
  return [];
}
