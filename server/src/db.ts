import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** Strictly increasing, starting at 1. Never change or renumber a migration that has been released. */
  id: number;
  name: string;
  sql: string;
}

/** Ordered list of all schema changes. Only ever append. */
export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: "create meta table",
    sql: `CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;`,
  },
];

/** Opens the database (creating its directory if needed) and applies all missing migrations. */
export function openDatabase(path: string, list: readonly Migration[] = migrations): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, list);
  return db;
}

/** Applies every migration that is not yet recorded in `schema_migrations`, each in its own transaction. */
export function runMigrations(db: DatabaseSync, list: readonly Migration[] = migrations): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);

  const rows = db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[];
  const applied = new Set(rows.map((row) => row.id));

  for (const migration of [...list].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) {
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.id} (${migration.name}) failed`, { cause: error });
    }
  }
}
