import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createBackup, inspectBackup } from "../src/backup.js";
import { runCli } from "../src/cli-commands.js";
import { openDatabase } from "../src/db.js";
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

function run(e: TestEnv, args: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(args, {
    db: e.db,
    config: testConfig(),
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
    expect(readdirSync(dir!)).toEqual(["copy.sqlite"]);

    // Changes after the backup are not in it.
    await addUser(env, "Later L.");
    expect(inspectBackup(target)).toMatchObject({ intact: true, accounts: 2, admins: 1 });

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
    expect(() => createBackup(env!.db, target)).toThrow();
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
    createBackup(env.db, target);

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
