// Nightly backup support for the VM scripts (deploy/vm/backup.sh). The scripts run these through the
// command line tool inside the container, so the backup is made by the same SQLite the server uses.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { checkValuesEqual, decodeCalendarKey, keyCheckValue, META_BACKUP_KEY, META_KEY_CHECK } from "./calendar-key.js";

export interface BackupInfo {
  /** Result of SQLite's integrity check: true only when it reports "ok". */
  intact: boolean;
  /** Highest applied migration, 0 when the file has no migration table. */
  schemaVersion: number;
  accounts: number;
  admins: number;
  /** Newest account creation or login (ISO 8601), null when there is none. */
  lastActivity: string | null;
  /** The backup file carries the calendar key (base64) in its `meta` table. */
  keyIncluded: boolean;
  /** The included key decodes to exactly 32 bytes; false when no key is included. */
  includedKeyValid: boolean;
  /**
   * Whether the key a restore would use (the included one, else the current one) fits the stored calendar
   * links: "none" when the backup has no key check value (no links were ever stored).
   */
  keyCheck: "matches" | "differs" | "none";
}

/**
 * Writes a consistent copy of the open database to `target` while the server keeps running.
 * The copy is a single self-contained file (no -wal or -shm next to it). `target` must not exist yet.
 * With a `calendarKey`, the copy also carries the key (in its `meta` table), so a restore can put it back; the
 * VM encrypts the file before it leaves the machine.
 */
export function createBackup(db: DatabaseSync, target: string, calendarKey: Buffer | null): { keyIncluded: boolean } {
  if (existsSync(target)) {
    throw new Error(`${target} already exists`);
  }
  db.prepare("VACUUM INTO ?").run(target);
  if (calendarKey === null) return { keyIncluded: false };
  const copy = new DatabaseSync(target);
  try {
    // Rollback journal, so closing leaves one file and no -wal/-shm next to it.
    copy.exec("PRAGMA journal_mode = DELETE");
    copy
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run(META_BACKUP_KEY, calendarKey.toString("base64"));
  } finally {
    copy.close();
  }
  return { keyIncluded: true };
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/** Opens a backup file read-only and describes it, without changing it. */
export function inspectBackup(path: string, currentKey: Buffer | null): BackupInfo {
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
    const metaValue = (name: string): string | null =>
      tableExists(db, "meta")
        ? (((db.prepare("SELECT value FROM meta WHERE key = ?").get(name) as { value: string } | undefined)?.value) ?? null)
        : null;
    const included = metaValue(META_BACKUP_KEY);
    const includedKey = included === null ? null : decodeCalendarKey(included);
    const storedCheck = metaValue(META_KEY_CHECK);
    const restoreKey = includedKey ?? currentKey;
    const keyCheck =
      storedCheck === null
        ? "none"
        : restoreKey !== null && checkValuesEqual(storedCheck, keyCheckValue(restoreKey))
          ? "matches"
          : "differs";
    return {
      intact,
      schemaVersion,
      accounts,
      admins,
      lastActivity,
      keyIncluded: included !== null,
      includedKeyValid: includedKey !== null,
      keyCheck,
    };
  } finally {
    db.close();
  }
}

/**
 * Takes the calendar key out of a backup file (the restore script needs it separately): returns it and removes
 * it from the file, overwriting the freed space and compacting the file so the key is not left in it.
 * Returns null when the file carries no key. The file stays a single file.
 */
export function takeBackupKey(path: string): string | null {
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist`);
  }
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    if (!tableExists(db, "meta")) return null;
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(META_BACKUP_KEY) as { value: string } | undefined;
    if (row === undefined) return null;
    db.exec("PRAGMA secure_delete = ON");
    db.prepare("DELETE FROM meta WHERE key = ?").run(META_BACKUP_KEY);
    db.exec("VACUUM");
    return row.value;
  } finally {
    db.close();
  }
}
