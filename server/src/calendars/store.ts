// The only place that runs SQL on the `calendars` table. Only the encrypted link and the settings are stored;
// the contents of a calendar never are.
import type { Calendar, CalendarProvider, CalendarStatus } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";

export interface CalendarRow {
  id: number;
  user_id: number;
  name: string;
  provider: CalendarProvider;
  link_encrypted: string;
  counts_busy: number;
  is_default: number;
  status: CalendarStatus;
  created_at: string;
  updated_at: string;
}

/** The API shape of a row: never the link. */
export function toCalendar(row: CalendarRow): Calendar {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    countsAsBusy: row.counts_busy === 1,
    isDefault: row.is_default === 1,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** The person's calendars: the default first, then in the order they were added. */
export function listCalendars(db: DatabaseSync, userId: number): CalendarRow[] {
  return db
    .prepare("SELECT * FROM calendars WHERE user_id = ? ORDER BY is_default DESC, id")
    .all(userId) as unknown as CalendarRow[];
}

/** A calendar of this person; another person's calendar is simply not there. */
export function findCalendar(db: DatabaseSync, userId: number, id: number): CalendarRow | undefined {
  return db.prepare("SELECT * FROM calendars WHERE id = ? AND user_id = ?").get(id, userId) as CalendarRow | undefined;
}

export function countCalendars(db: DatabaseSync, userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM calendars WHERE user_id = ?").get(userId) as { n: number }).n;
}

/** Inserts a calendar; the person's first one becomes the default. Returns its id. */
export function insertCalendar(
  db: DatabaseSync,
  calendar: { userId: number; name: string; provider: CalendarProvider; linkEncrypted: string; now: string },
): number {
  const isDefault = countCalendars(db, calendar.userId) === 0 ? 1 : 0;
  const result = db
    .prepare(
      `INSERT INTO calendars (user_id, name, provider, link_encrypted, counts_busy, is_default, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 'ok', ?, ?)`,
    )
    .run(calendar.userId, calendar.name, calendar.provider, calendar.linkEncrypted, isDefault, calendar.now, calendar.now);
  return Number(result.lastInsertRowid);
}

export function updateSettings(
  db: DatabaseSync,
  id: number,
  changes: { name?: string | undefined; countsAsBusy?: boolean | undefined },
  now: string,
): void {
  if (changes.name !== undefined) {
    db.prepare("UPDATE calendars SET name = ?, updated_at = ? WHERE id = ?").run(changes.name, now, id);
  }
  if (changes.countsAsBusy !== undefined) {
    db.prepare("UPDATE calendars SET counts_busy = ?, updated_at = ? WHERE id = ?").run(
      changes.countsAsBusy ? 1 : 0,
      now,
      id,
    );
  }
}

/** Makes this calendar the person's only default. Call inside a transaction. */
export function setDefault(db: DatabaseSync, userId: number, id: number, now: string): void {
  db.prepare("UPDATE calendars SET is_default = 0, updated_at = ? WHERE user_id = ? AND is_default = 1 AND id <> ?").run(
    now,
    userId,
    id,
  );
  db.prepare("UPDATE calendars SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?").run(now, id, userId);
}

/** Replaces the link; the calendar counts as working again until a fetch says otherwise. */
export function replaceLink(
  db: DatabaseSync,
  id: number,
  link: { linkEncrypted: string; provider: CalendarProvider },
  now: string,
): void {
  db.prepare("UPDATE calendars SET link_encrypted = ?, provider = ?, status = 'ok', updated_at = ? WHERE id = ?").run(
    link.linkEncrypted,
    link.provider,
    now,
    id,
  );
}

/**
 * Sets the status, but only while the calendar still has the link that was read (a link replaced meanwhile must
 * not inherit the old link's verdict).
 */
export function setStatus(db: DatabaseSync, id: number, linkEncrypted: string, status: CalendarStatus, now: string): void {
  db.prepare("UPDATE calendars SET status = ?, updated_at = ? WHERE id = ? AND link_encrypted = ? AND status <> ?").run(
    status,
    now,
    id,
    linkEncrypted,
    status,
  );
}

/** Deletes the calendar; when it was the default, the person's oldest remaining calendar takes over. */
export function deleteCalendar(db: DatabaseSync, userId: number, id: number, now: string): boolean {
  const row = findCalendar(db, userId, id);
  if (!row) return false;
  db.prepare("DELETE FROM calendars WHERE id = ?").run(id);
  if (row.is_default === 1) {
    db.prepare(
      `UPDATE calendars SET is_default = 1, updated_at = ?
       WHERE id = (SELECT id FROM calendars WHERE user_id = ? ORDER BY id LIMIT 1)`,
    ).run(now, userId);
  }
  return true;
}

/** How many calendars of this person are marked broken. */
export function countBroken(db: DatabaseSync, userId: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM calendars WHERE user_id = ? AND status = 'broken'").get(userId) as { n: number }
  ).n;
}
