import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type Migration, migrations, runMigrations } from "../src/db.js";

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
});
