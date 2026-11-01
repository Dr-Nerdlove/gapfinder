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
  {
    id: 2,
    name: "accounts, sessions, invites and password resets",
    // Tokens are never stored, only their SHA-256 hash. Timestamps are ISO 8601 strings in UTC.
    sql: `CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      seed_color TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX sessions_user_id ON sessions (user_id);
    CREATE TABLE invites (
      id INTEGER PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      suggested_username TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by INTEGER REFERENCES users (id) ON DELETE SET NULL
    ) STRICT;
    CREATE TABLE password_resets (
      id INTEGER PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    ) STRICT;
    CREATE INDEX password_resets_user_id ON password_resets (user_id);`,
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
  // The command line tool and the running server share the file: wait for a lock instead of failing.
  db.exec("PRAGMA busy_timeout = 5000");
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

/** Runs `work` in one transaction that takes the write lock at once; rolls back when `work` throws. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** True when `error` is SQLite refusing a duplicate value of a UNIQUE column. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}
