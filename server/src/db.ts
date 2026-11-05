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
  {
    id: 3,
    name: "calendars",
    // Additive only: an older server keeps running on this database and never touches the table. Only the
    // encrypted link and the settings are stored, never the contents of a calendar.
    sql: `CREATE TABLE calendars (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      link_encrypted TEXT NOT NULL,
      counts_busy INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'broken')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX calendars_user_id ON calendars (user_id);`,
  },
  {
    id: 4,
    name: "polls",
    // Additive only (new tables, no old table is touched): the VM rolls back to the previous image when a new
    // one is not healthy, and that older server then runs on this already migrated database. The share token is
    // stored as is (the creator must be able to open the link again); guest vote keys only as a hash. A guest
    // vote has no user (`user_id` NULL) but a name; an account vote has a user and no name.
    sql: `CREATE TABLE polls (
      id INTEGER PRIMARY KEY,
      share_token TEXT NOT NULL UNIQUE,
      creator_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK (kind IN ('timed', 'days')),
      deadline TEXT,
      closed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX polls_creator_id ON polls (creator_id);
    CREATE INDEX polls_expires_at ON polls (expires_at);
    CREATE TABLE poll_proposals (
      id INTEGER PRIMARY KEY,
      poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      first_date TEXT,
      last_date TEXT
    ) STRICT;
    CREATE INDEX poll_proposals_poll_id ON poll_proposals (poll_id);
    CREATE TABLE poll_participants (
      poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      PRIMARY KEY (poll_id, user_id)
    ) STRICT;
    CREATE INDEX poll_participants_user_id ON poll_participants (user_id);
    CREATE TABLE poll_votes (
      id INTEGER PRIMARY KEY,
      poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
      guest_name TEXT,
      guest_name_key TEXT,
      key_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (user_id IS NOT NULL AND guest_name IS NULL AND guest_name_key IS NULL AND key_hash IS NULL) OR
        (user_id IS NULL AND guest_name IS NOT NULL AND guest_name_key IS NOT NULL AND key_hash IS NOT NULL)
      )
    ) STRICT;
    CREATE UNIQUE INDEX poll_votes_account ON poll_votes (poll_id, user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX poll_votes_guest_name ON poll_votes (poll_id, guest_name_key) WHERE guest_name_key IS NOT NULL;
    CREATE INDEX poll_votes_user_id ON poll_votes (user_id);
    CREATE TABLE poll_vote_answers (
      vote_id INTEGER NOT NULL REFERENCES poll_votes (id) ON DELETE CASCADE,
      proposal_id INTEGER NOT NULL REFERENCES poll_proposals (id) ON DELETE CASCADE,
      answer TEXT NOT NULL CHECK (answer IN ('yes', 'maybe', 'no')),
      PRIMARY KEY (vote_id, proposal_id)
    ) STRICT;
    CREATE INDEX poll_vote_answers_proposal_id ON poll_vote_answers (proposal_id);`,
  },
  {
    id: 5,
    name: "fixed poll dates and calendar feeds",
    // Additive only (new columns with defaults, one new table): an older server keeps running on this database
    // and ignores them. `fixed_sequence` only ever grows; it is the SEQUENCE of the event in calendar files, so
    // a calendar app sees that the event changed. The feed token is stored as is (the profile shows the link
    // again), like the poll share token.
    sql: `ALTER TABLE polls ADD COLUMN fixed_proposal_id INTEGER REFERENCES poll_proposals (id) ON DELETE SET NULL;
    ALTER TABLE polls ADD COLUMN fixed_at TEXT;
    ALTER TABLE polls ADD COLUMN fixed_sequence INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE calendar_feeds (
      user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    ) STRICT;`,
  },
  {
    id: 6,
    name: "busy per search kind",
    // Additive only (one new column with a default): `counts_busy` keeps meaning the hour search, so an older
    // server (after a rollback) still runs and uses `counts_busy` for both kinds of search. Existing calendars
    // take over their old setting for the multi-day search.
    sql: `ALTER TABLE calendars ADD COLUMN counts_busy_days INTEGER NOT NULL DEFAULT 1;
    UPDATE calendars SET counts_busy_days = counts_busy;`,
  },
  {
    id: 7,
    name: "notifications",
    // Additive only: new tables and one nullable column, so an older server (after a rollback) ignores them.
    // `notification_prefs` has one row per user who changed a setting; a missing row means the defaults. All
    // three tables go away with their user, and `notifications` with its poll. The `data` column holds the
    // structured notification as JSON (kind, poll title, share token, who, which date) and is deleted after 7 days.
    sql: `CREATE TABLE notification_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      poll_created INTEGER NOT NULL DEFAULT 1,
      vote_own INTEGER NOT NULL DEFAULT 1,
      vote_others INTEGER NOT NULL DEFAULT 0,
      all_voted_own INTEGER NOT NULL DEFAULT 1,
      all_voted_others INTEGER NOT NULL DEFAULT 0,
      date_fixed INTEGER NOT NULL DEFAULT 1,
      reminder INTEGER NOT NULL DEFAULT 1
    ) STRICT;
    CREATE TABLE push_subscriptions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX push_subscriptions_user_id ON push_subscriptions (user_id);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX notifications_user_id_id ON notifications (user_id, id);
    ALTER TABLE polls ADD COLUMN last_reminder_at TEXT;`,
  },
  {
    id: 8,
    name: "app_devices",
    // Additive only: one new table, so an older server (after a rollback) ignores it. One row per phone with the
    // Android app; only the hash of its device key is stored. A key can do nothing but read the user's
    // notifications. Rows go away with their user, when the app switches notifications off, with a password
    // change and after 90 days without use.
    sql: `CREATE TABLE app_devices (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX app_devices_user_id ON app_devices (user_id);`,
  },
  {
    id: 9,
    name: "app_devices_fcm_token",
    // Additive only: one nullable column and an index. An older server (after a rollback) never reads or writes
    // the column, and its INSERTs leave it NULL. The token is the phone's Firebase address for the "doorbell"
    // ring; it lives and dies with the row. Unique, because a token belongs to one phone at most (NULLs repeat).
    sql: `ALTER TABLE app_devices ADD COLUMN fcm_token TEXT;
    CREATE UNIQUE INDEX app_devices_fcm_token ON app_devices (fcm_token);`,
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
