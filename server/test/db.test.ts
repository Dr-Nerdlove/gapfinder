import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type Migration, migrations, openDatabase, runMigrations } from "../src/db.js";

function appliedIds(db: DatabaseSync): number[] {
  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: number }[];
  return rows.map((row) => row.id);
}

describe("migrations", () => {
  it("applies every migration once and is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    runMigrations(db);

    expect(appliedIds(db)).toEqual(migrations.map((m) => m.id));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("meta");
  });

  it("applies only the missing migrations when new ones are added", () => {
    const db = new DatabaseSync(":memory:");
    const first: Migration = { id: 1, name: "one", sql: "CREATE TABLE one (x INTEGER);" };
    const second: Migration = { id: 2, name: "two", sql: "CREATE TABLE two (x INTEGER);" };
    runMigrations(db, [first]);
    runMigrations(db, [first, second]);
    runMigrations(db, [first, second]);
    expect(appliedIds(db)).toEqual([1, 2]);
  });

  it("rolls back a failing migration completely", () => {
    const db = new DatabaseSync(":memory:");
    const broken: Migration = {
      id: 1,
      name: "broken",
      sql: "CREATE TABLE half (x INTEGER); INSERT INTO does_not_exist VALUES (1);",
    };
    expect(() => runMigrations(db, [broken])).toThrow(/Migration 1 \(broken\) failed/);
    expect(appliedIds(db)).toEqual([]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").all();
    expect(tables).toEqual([]);
  });

  it("migration 2 adds the account tables without touching the first migration's table", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.slice(0, 1));
    db.prepare("INSERT INTO meta (key, value) VALUES ('keep', 'me')").run();
    runMigrations(db);

    expect(appliedIds(db)).toEqual([1, 2]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(expect.arrayContaining(["meta", "users", "sessions", "invites", "password_resets"]));
    expect(db.prepare("SELECT value FROM meta WHERE key = 'keep'").get()).toEqual({ value: "me" });
  });

  it("migration 2 enforces unique usernames and cascades deletes", () => {
    const db = openDatabase(":memory:");
    const insert = db.prepare(
      "INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, 'h', '2026-01-01T00:00:00.000Z')",
    );
    insert.run("Anna", "anna");
    expect(() => insert.run("ANNA", "anna")).toThrow(/UNIQUE/);

    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES ('t', 1, 'a', 'a', 'a')",
    ).run();
    db.prepare(
      "INSERT INTO invites (token_hash, suggested_username, created_by, created_at, expires_at) VALUES ('i', 'X', 1, 'a', 'a')",
    ).run();
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT created_by FROM invites").get()).toEqual({ created_by: null });
  });

  it("waits for a locked database instead of failing at once", () => {
    const db = openDatabase(":memory:");
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });
});
