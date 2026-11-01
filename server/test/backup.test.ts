import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createBackup, inspectBackup, takeBackupKey } from "../src/backup.js";
import { META_BACKUP_KEY, META_KEY_CHECK, keyCheckValue, prepareCalendarKey } from "../src/calendar-key.js";
import type { Config } from "../src/config.js";
import { runCli } from "../src/cli-commands.js";
import { openDatabase } from "../src/db.js";
import { DatabaseSync } from "node:sqlite";
import { addUser, addUserWithSession, createTestEnv, DEFAULT_PASSWORD, testConfig, TestClock, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
let dir: string | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), "lf-backup-"));
  return dir;
}

const KEY_A = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const KEY_B = Buffer.from(Array.from({ length: 32 }, (_, i) => 200 - i));
const KEY_A_TEXT = KEY_A.toString("base64");

function withKey(key: Buffer): Partial<Config> {
  return { calendarKey: key, calendarKeyProblem: null };
}

function run(e: TestEnv, args: string[], overrides: Partial<Config> = {}): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(args, {
    db: e.db,
    config: testConfig(overrides),
    now: e.clock.now,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("backup", () => {
  it("writes a single self-contained file that a server can run on, with the same accounts", async () => {
    env = await createTestEnv();
    await addUser(env, "Vincent R.", { isAdmin: true });
    await addUserWithSession(env, "Anna K.");
    const target = join(tempDir(), "copy.sqlite");

    const result = run(env, ["backup", target]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("no CALENDAR_KEY is set");
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);

    // Changes after the backup are not in it.
    await addUser(env, "Later L.");
    expect(inspectBackup(target, null)).toMatchObject({ intact: true, accounts: 2, admins: 1 });

    // A server started on the restored file lets the old accounts log in.
    const restored = openDatabase(target);
    const app = await buildApp(testConfig(), { now: new TestClock().now, db: restored });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "anna k.", password: DEFAULT_PASSWORD },
      });
      expect(login.statusCode).toBe(200);
    } finally {
      await app.close(); // also closes the database
    }
  });

  it("refuses to overwrite an existing file", async () => {
    env = await createTestEnv();
    const target = join(tempDir(), "copy.sqlite");
    writeFileSync(target, "keep me");
    const result = run(env, ["backup", target]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("already exists");
    expect(() => createBackup(env!.db, target, null)).toThrow();
  });

  it("needs exactly one file name", async () => {
    env = await createTestEnv();
    expect(run(env, ["backup"]).code).toBe(1);
    expect(run(env, ["check-backup"]).code).toBe(1);
  });
});

describe("check-backup", () => {
  it("describes an intact backup and leaves it unchanged", async () => {
    env = await createTestEnv();
    await addUser(env, "Vincent R.", { isAdmin: true });
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, null);

    const result = run(env, ["check-backup", target]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Backup is intact.");
    expect(result.out).toContain("Accounts: 1 (admins: 1)");
    expect(result.out).toMatch(/Database version: \d+/);
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);
  });

  it("fails for a damaged file, a file that is no database and a missing file", async () => {
    env = await createTestEnv();
    const base = tempDir();
    const garbage = join(base, "garbage.sqlite");
    writeFileSync(garbage, "this is not a database at all, just text ".repeat(200));
    expect(run(env, ["check-backup", garbage]).code).toBe(1);

    const missing = join(base, "missing.sqlite");
    const result = run(env, ["check-backup", missing]);
    expect(result.code).toBe(1);
    expect(existsSync(missing)).toBe(false);
  });

  it("fails for an intact SQLite file that is not a Lückenfüller database", async () => {
    env = await createTestEnv();
    const other = join(tempDir(), "other.sqlite");
    const db = openDatabase(":memory:", []);
    db.exec("CREATE TABLE notes (text TEXT)");
    db.prepare("VACUUM INTO ?").run(other);
    db.close();
    const result = run(env, ["check-backup", other]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("not a Lückenfüller database");
  });
});

/** A database that has stored the key's check value, as if calendar links had been saved with KEY_A. */
async function envWithKey(key: Buffer): Promise<TestEnv> {
  const e = await createTestEnv(withKey(key));
  expect(prepareCalendarKey(e.db, key)).toBe("ok");
  return e;
}

function metaOf(path: string, name: string): string | undefined {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare("SELECT value FROM meta WHERE key = ?").get(name) as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}

describe("backup with the calendar key", () => {
  it("puts the key into the copy only, as one single file", async () => {
    env = await envWithKey(KEY_A);
    const target = join(tempDir(), "copy.sqlite");
    expect(createBackup(env.db, target, KEY_A)).toEqual({ keyIncluded: true });
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);
    expect(metaOf(target, META_BACKUP_KEY)).toBe(KEY_A_TEXT);
    expect(metaOf(target, META_KEY_CHECK)).toBe(keyCheckValue(KEY_A));
    // The live database never holds the key itself.
    expect(env.db.prepare("SELECT 1 FROM meta WHERE key = ?").get(META_BACKUP_KEY)).toBeUndefined();
  });

  it("leaves the key out without a key", async () => {
    env = await envWithKey(KEY_A);
    const target = join(tempDir(), "copy.sqlite");
    expect(createBackup(env.db, target, null)).toEqual({ keyIncluded: false });
    expect(metaOf(target, META_BACKUP_KEY)).toBeUndefined();
    expect(readFileSync(target).includes(KEY_A_TEXT)).toBe(false);
  });

  it("the backup command says whether the key is included", async () => {
    env = await envWithKey(KEY_A);
    const base = tempDir();
    const withIt = run(env, ["backup", join(base, "a.sqlite")], withKey(KEY_A));
    expect(withIt).toMatchObject({ code: 0, err: "" });
    expect(withIt.out).toBe(`Backup written to ${join(base, "a.sqlite")}.\nCalendar key included.`);
    expect(metaOf(join(base, "a.sqlite"), META_BACKUP_KEY)).toBe(KEY_A_TEXT);

    const without = run(env, ["backup", join(base, "b.sqlite")]);
    expect(without.code).toBe(0);
    expect(without.out).toContain(
      "Warning: no CALENDAR_KEY is set, so calendar links in this backup cannot be read after a restore.",
    );
    expect(metaOf(join(base, "b.sqlite"), META_BACKUP_KEY)).toBeUndefined();
  });
});

describe("inspectBackup key information", () => {
  async function backupWith(stored: Buffer | null, included: Buffer | null): Promise<string> {
    env = await createTestEnv();
    if (stored) prepareCalendarKey(env.db, stored);
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, included);
    return target;
  }

  it("matches when the included key fits the stored check value", async () => {
    const target = await backupWith(KEY_A, KEY_A);
    expect(inspectBackup(target, null)).toMatchObject({ keyIncluded: true, includedKeyValid: true, keyCheck: "matches" });
    // The included key wins over the current one.
    expect(inspectBackup(target, KEY_B).keyCheck).toBe("matches");
  });

  it("differs when the included key does not fit the stored check value", async () => {
    const target = await backupWith(KEY_A, KEY_B);
    expect(inspectBackup(target, KEY_A)).toMatchObject({ keyIncluded: true, includedKeyValid: true, keyCheck: "differs" });
  });

  it("is none when the backup has no check value", async () => {
    const target = await backupWith(null, KEY_A);
    expect(inspectBackup(target, KEY_B)).toMatchObject({ keyIncluded: true, keyCheck: "none" });
    const plain = join(dir!, "plain.sqlite");
    createBackup(env!.db, plain, null);
    expect(inspectBackup(plain, null)).toMatchObject({ keyIncluded: false, includedKeyValid: false, keyCheck: "none" });
  });

  it("treats an included key that is not a valid key as invalid and falls back to the current key", async () => {
    const target = await backupWith(KEY_A, null);
    for (const bad of ["not a key", Buffer.alloc(16, 1).toString("base64"), KEY_A_TEXT.replace(/=$/, "")]) {
      const db = new DatabaseSync(target);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(META_BACKUP_KEY, bad);
      db.close();
      expect(inspectBackup(target, KEY_A)).toMatchObject({ keyIncluded: true, includedKeyValid: false, keyCheck: "matches" });
      expect(inspectBackup(target, KEY_B)).toMatchObject({ includedKeyValid: false, keyCheck: "differs" });
      expect(inspectBackup(target, null).keyCheck).toBe("differs");
    }
  });

  it("uses the current key when the backup has none, and differs without any usable key", async () => {
    const target = await backupWith(KEY_A, null);
    expect(inspectBackup(target, KEY_A)).toMatchObject({ keyIncluded: false, includedKeyValid: false, keyCheck: "matches" });
    expect(inspectBackup(target, KEY_B).keyCheck).toBe("differs");
    expect(inspectBackup(target, null).keyCheck).toBe("differs");
  });

  it("does not change the file", async () => {
    const target = await backupWith(KEY_A, KEY_A);
    const before = readFileSync(target);
    inspectBackup(target, KEY_A);
    expect(readFileSync(target).equals(before)).toBe(true);
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);
  });
});

describe("check-backup and the calendar key", () => {
  async function check(stored: Buffer | null, included: Buffer | null, current: Buffer | null) {
    env = await createTestEnv();
    if (stored) prepareCalendarKey(env.db, stored);
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, included);
    return run(env, ["check-backup", target], current ? withKey(current) : {});
  }

  it("is fine when the included key fits", async () => {
    const result = await check(KEY_A, KEY_A, null);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Calendar key: included and matches the stored calendar links.");
  });

  it("fails for a damaged backup: the included key does not fit", async () => {
    const result = await check(KEY_A, KEY_B, KEY_A);
    expect(result.code).toBe(1);
    expect(result.err).toContain("the backup is damaged");
  });

  it("fails when the included key is not a valid key", async () => {
    env = await envWithKey(KEY_A);
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, KEY_A);
    const db = new DatabaseSync(target);
    db.prepare("UPDATE meta SET value = 'garbage' WHERE key = ?").run(META_BACKUP_KEY);
    db.close();
    const result = run(env, ["check-backup", target]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("not a valid key");
  });

  it("warns, but succeeds, when there is no key and this VM's key does not fit", async () => {
    for (const current of [KEY_B, null]) {
      const result = await check(KEY_A, null, current);
      expect(result.code).toBe(0);
      expect(result.out).toContain(
        "Warning: the backup has no calendar key, and this VM's key does not fit its calendar links.",
      );
      expect(result.out).toContain("people would have to enter their calendar links again");
    }
  });

  it("says plainly when there is no key but this VM's key fits, or no links are stored", async () => {
    const fits = await check(KEY_A, null, KEY_A);
    expect(fits.code).toBe(0);
    expect(fits.out).toContain("Calendar key: not included, but this VM's key fits the stored calendar links.");
    const none = await check(null, null, null);
    expect(none.code).toBe(0);
    expect(none.out).toContain("Calendar key: no calendar links are stored.");
  });
});

describe("takeBackupKey", () => {
  it("returns the key, removes it for good, and leaves a single file", async () => {
    env = await envWithKey(KEY_A);
    // Some other content, so the file has pages to reuse and a lazy delete would leave the key behind.
    await addUser(env, "Vincent R.", { isAdmin: true });
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, KEY_A);
    expect(readFileSync(target).includes(KEY_A_TEXT)).toBe(true);

    expect(takeBackupKey(target)).toBe(KEY_A_TEXT);
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);
    expect(readFileSync(target).includes(KEY_A_TEXT)).toBe(false);
    expect(metaOf(target, META_BACKUP_KEY)).toBeUndefined();
    expect(metaOf(target, META_KEY_CHECK)).toBe(keyCheckValue(KEY_A));
    expect(inspectBackup(target, null)).toMatchObject({ intact: true, accounts: 1, keyIncluded: false });

    expect(takeBackupKey(target)).toBeNull();
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);
  });

  it("returns null for a backup without a key, and throws for a missing file", async () => {
    env = await createTestEnv();
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, null);
    expect(takeBackupKey(target)).toBeNull();
    expect(() => takeBackupKey(join(dir!, "missing.sqlite"))).toThrow();
    expect(existsSync(join(dir!, "missing.sqlite"))).toBe(false);
  });
});

describe("take-calendar-key", () => {
  it("prints exactly the key and nothing else, and removes it from the file", async () => {
    env = await envWithKey(KEY_A);
    const target = join(tempDir(), "copy.sqlite");
    createBackup(env.db, target, KEY_A);

    const first = run(env, ["take-calendar-key", target]);
    expect(first).toEqual({ code: 0, out: KEY_A_TEXT, err: "" });
    expect(readFileSync(target).includes(KEY_A_TEXT)).toBe(false);

    const second = run(env, ["take-calendar-key", target]);
    expect(second).toEqual({ code: 0, out: "", err: "" });
  });

  it("fails with a message on stderr for a missing file, a file that is no backup, and wrong usage", async () => {
    env = await createTestEnv();
    const base = tempDir();
    const missing = run(env, ["take-calendar-key", join(base, "missing.sqlite")]);
    expect(missing.code).toBe(1);
    expect(missing.out).toBe("");
    expect(missing.err).toContain("not a readable Lückenfüller backup");
    expect(existsSync(join(base, "missing.sqlite"))).toBe(false);

    const garbage = join(base, "garbage.sqlite");
    writeFileSync(garbage, "this is not a database at all, just text ".repeat(200));
    const bad = run(env, ["take-calendar-key", garbage]);
    expect(bad.code).toBe(1);
    expect(bad.out).toBe("");
    expect(bad.err).toContain("not a readable Lückenfüller backup");

    const usage = run(env, ["take-calendar-key"]);
    expect(usage.code).toBe(1);
    expect(usage.out).toBe("");
  });

  it("is listed in the help text", async () => {
    env = await createTestEnv();
    expect(run(env, []).err).toContain("take-calendar-key <file>");
  });
});
