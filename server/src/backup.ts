// Nightly backup support for the VM scripts (deploy/vm/backup.sh). The scripts run these through the
// command line tool inside the container, so the backup is made by the same SQLite the server uses.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface BackupInfo {
  /** Result of SQLite's integrity check: true only when it reports "ok". */
  intact: boolean;
  /** Highest applied migration, 0 when the file has no migration table. */
  schemaVersion: number;
  accounts: number;
  admins: number;
  /** Newest account creation or login (ISO 8601), null when there is none. */
  lastActivity: string | null;
}

/**
 * Writes a consistent copy of the open database to `target` while the server keeps running.
 * The copy is a single self-contained file (no -wal or -shm next to it). `target` must not exist yet.
 */
export function createBackup(db: DatabaseSync, target: string): void {
  if (existsSync(target)) {
    throw new Error(`${target} already exists`);
  }
  db.prepare("VACUUM INTO ?").run(target);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/** Opens a backup file read-only and describes it, without changing it. */
export function inspectBackup(path: string): BackupInfo {
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist`);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    const intact = rows.length === 1 && Object.values(rows[0]!)[0] === "ok";
    const schemaVersion = tableExists(db, "schema_migrations")
      ? Number(db.prepare("SELECT coalesce(max(id), 0) AS v FROM schema_migrations").get()!.v)
      : 0;
    let accounts = 0;
    let admins = 0;
    let lastActivity: string | null = null;
    if (tableExists(db, "users")) {
      const users = db.prepare("SELECT count(*) AS n, coalesce(sum(is_admin), 0) AS a, max(created_at) AS c FROM users").get()!;
      accounts = Number(users.n);
      admins = Number(users.a);
      lastActivity = (users.c as string | null) ?? null;
    }
    if (tableExists(db, "sessions")) {
      const used = db.prepare("SELECT max(last_used_at) AS u FROM sessions").get()!.u as string | null;
      if (used && (!lastActivity || used > lastActivity)) lastActivity = used;
    }
    return { intact, schemaVersion, accounts, admins, lastActivity };
  } finally {
    db.close();
  }
}
