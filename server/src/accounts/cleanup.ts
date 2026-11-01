import type { DatabaseSync } from "node:sqlite";

/** Deletes expired sessions, invites and password resets. Called at start and on every login. */
export function purgeExpired(db: DatabaseSync, now: Date): void {
  const iso = now.toISOString();
  for (const table of ["sessions", "invites", "password_resets"]) {
    db.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).run(iso);
  }
}
