import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  META_BACKUP_KEY,
  META_KEY_CHECK,
  decryptSecret,
  encryptSecret,
  keyCheckValue,
  prepareCalendarKey,
} from "../src/calendar-key.js";
import type { Config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { TestClock, testConfig, type TestEnv } from "./helpers.js";

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const OTHER_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 100 + i));
const LINK = "webcal://calendar.example.com/feed/secret-token-123.ics";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

/** Flips one bit of the byte at `index` of the decoded payload. */
function tamper(stored: string, index: number): string {
  const raw = Buffer.from(stored.slice(3), "base64url");
  raw[index === -1 ? raw.length - 1 : index]! ^= 1;
  return `v1.${raw.toString("base64url")}`;
}

describe("encryptSecret / decryptSecret", () => {
  it("roundtrips, also with non-ASCII text and the empty string", () => {
    for (const text of [LINK, "Termine für Lückenfüller ✓", ""]) {
      expect(decryptSecret(KEY, encryptSecret(KEY, text))).toBe(text);
    }
  });

  it("has the documented format and hides the text", () => {
    const stored = encryptSecret(KEY, LINK);
    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(Buffer.from(stored.slice(3), "base64url").length).toBe(12 + Buffer.byteLength(LINK) + 16);
    expect(stored).not.toContain("secret-token");
  });

  it("uses a new nonce for every call", () => {
    const a = encryptSecret(KEY, LINK);
    const b = encryptSecret(KEY, LINK);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.slice(3), "base64url").subarray(0, 12).equals(Buffer.from(b.slice(3), "base64url").subarray(0, 12))).toBe(false);
  });

  it("detects tampering with the nonce, the ciphertext and the tag", () => {
    const stored = encryptSecret(KEY, LINK);
    expect(() => decryptSecret(KEY, tamper(stored, 0))).toThrow(); // nonce
    expect(() => decryptSecret(KEY, tamper(stored, 12))).toThrow(); // ciphertext
    expect(() => decryptSecret(KEY, tamper(stored, -1))).toThrow(); // tag
  });

  it("refuses a wrong key, an unknown prefix and a too short value", () => {
    const stored = encryptSecret(KEY, LINK);
    expect(() => decryptSecret(OTHER_KEY, stored)).toThrow();
    expect(() => decryptSecret(KEY, `v2.${stored.slice(3)}`)).toThrow(/Unknown format/);
    expect(() => decryptSecret(KEY, stored.slice(3))).toThrow(/Unknown format/);
    expect(() => decryptSecret(KEY, "v1.")).toThrow(/too short/);
    expect(() => decryptSecret(KEY, `v1.${randomBytes(27).toString("base64url")}`)).toThrow(/too short/);
  });
});

describe("keyCheckValue", () => {
  it("is a stable hex value per key, different for other keys, and does not contain the key", () => {
    expect(keyCheckValue(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyCheckValue(KEY)).toBe(keyCheckValue(Buffer.from(KEY)));
    expect(keyCheckValue(KEY)).not.toBe(keyCheckValue(OTHER_KEY));
    expect(keyCheckValue(KEY)).not.toContain(KEY.toString("hex"));
  });
});

describe("prepareCalendarKey", () => {
  const stored = (db: ReturnType<typeof openDatabase>, name: string) =>
    (db.prepare("SELECT value FROM meta WHERE key = ?").get(name) as { value: string } | undefined)?.value;

  it("writes nothing without a key", () => {
    const db = openDatabase(":memory:");
    expect(prepareCalendarKey(db, null)).toBe("not-configured");
    expect(stored(db, META_KEY_CHECK)).toBeUndefined();
    db.close();
  });

  it("remembers the key on first use, then accepts it again and rejects another one", () => {
    const db = openDatabase(":memory:");
    expect(prepareCalendarKey(db, KEY)).toBe("ok");
    expect(stored(db, META_KEY_CHECK)).toBe(keyCheckValue(KEY));
    expect(prepareCalendarKey(db, KEY)).toBe("ok");
    expect(prepareCalendarKey(db, OTHER_KEY)).toBe("wrong");
    expect(stored(db, META_KEY_CHECK)).toBe(keyCheckValue(KEY)); // never overwritten
    expect(prepareCalendarKey(db, null)).toBe("not-configured");
    db.close();
  });

  it("removes a stray backup key row from the live database, whatever the status", () => {
    for (const key of [null, KEY, OTHER_KEY]) {
      const db = openDatabase(":memory:");
      prepareCalendarKey(db, KEY);
      db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(META_BACKUP_KEY, KEY.toString("base64"));
      prepareCalendarKey(db, key);
      expect(stored(db, META_BACKUP_KEY)).toBeUndefined();
      expect(stored(db, META_KEY_CHECK)).toBe(keyCheckValue(KEY));
      db.close();
    }
  });
});

describe("the key at server start", () => {
  async function startWith(overrides: Partial<Config>, seed?: (db: TestEnv["db"]) => void) {
    const lines: string[] = [];
    const logStream = new PassThrough();
    logStream.on("data", (chunk: Buffer) => lines.push(chunk.toString()));
    const db = openDatabase(":memory:");
    seed?.(db);
    const app = await buildApp(testConfig({ logLevel: "info", ...overrides }), { now: new TestClock().now, db, logStream });
    env = { app, db, clock: new TestClock() };
    return lines.join("");
  }

  it("logs info when the key is fine, without the key", async () => {
    const log = await startWith({ calendarKey: KEY, calendarKeyProblem: null });
    expect(log).toContain('"level":30');
    expect(log).toContain("Calendar key is set");
    expect(log).not.toContain(KEY.toString("base64"));
  });

  it("warns with the reason when no key is configured", async () => {
    const log = await startWith({});
    expect(log).toContain('"level":40');
    expect(log).toContain("CALENDAR_KEY is not set");
  });

  it("logs an error when the key does not match the stored links", async () => {
    const log = await startWith({ calendarKey: OTHER_KEY, calendarKeyProblem: null }, (db) => prepareCalendarKey(db, KEY));
    expect(log).toContain('"level":50');
    expect(log).toContain("CALENDAR_KEY does not match the key the stored calendar links were encrypted with");
    expect(log).not.toContain(OTHER_KEY.toString("base64"));
  });

  it("removes a stray backup key row while starting", async () => {
    await startWith({ calendarKey: KEY, calendarKeyProblem: null }, (db) =>
      db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(META_BACKUP_KEY, KEY.toString("base64")),
    );
    expect(env!.db.prepare("SELECT 1 FROM meta WHERE key = ?").get(META_BACKUP_KEY)).toBeUndefined();
  });
});
