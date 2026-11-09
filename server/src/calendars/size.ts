// Remembers how big each linked calendar is (bytes only, never contents) and tells the admins once when a calendar
// or all calendars together get too large. The owner of a calendar gets no notification; the app shows them the size.
import {
  CALENDAR_LARGE_BYTES,
  CALENDARS_LARGE_TOTAL_BYTES,
  type CalendarSizes,
} from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import type { AppContext } from "../context.js";
import { notifyAdmins } from "../notifications/dispatch.js";

const META_TOTAL_WARNED = "calendars_total_warned";

function totalBytes(db: DatabaseSync): number {
  return (db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM calendars").get() as { n: number }).n;
}

/**
 * Stores the size of a calendar's feed, but only while the calendar still has the link that was read. Notifies every
 * admin once when the calendar passes `CALENDAR_LARGE_BYTES` (and again only after it was smaller in between), and
 * once when all calendars together pass `CALENDARS_LARGE_TOTAL_BYTES`. Never throws, never logs a link or contents.
 */
export function recordCalendarSize(ctx: AppContext, calendarId: number, linkEncrypted: string, bytes: number): void {
  try {
    const db = ctx.db;
    const updated = db
      .prepare("UPDATE calendars SET size_bytes = ? WHERE id = ? AND link_encrypted = ?")
      .run(bytes, calendarId, linkEncrypted);
    if (Number(updated.changes) === 0) return;

    const row = db
      .prepare(
        `SELECT c.size_warned AS warned, u.username AS username
         FROM calendars c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      )
      .get(calendarId) as { warned: number; username: string } | undefined;
    if (row) {
      if (bytes > CALENDAR_LARGE_BYTES && row.warned === 0) {
        db.prepare("UPDATE calendars SET size_warned = 1 WHERE id = ?").run(calendarId);
        notifyAdmins(ctx, { kind: "calendar_large", actorName: row.username, sizeBytes: bytes });
      } else if (bytes <= CALENDAR_LARGE_BYTES && row.warned === 1) {
        db.prepare("UPDATE calendars SET size_warned = 0 WHERE id = ?").run(calendarId);
      }
    }

    const total = totalBytes(db);
    const marked = db.prepare("SELECT value FROM meta WHERE key = ?").get(META_TOTAL_WARNED) !== undefined;
    if (total > CALENDARS_LARGE_TOTAL_BYTES && !marked) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").run(META_TOTAL_WARNED);
      notifyAdmins(ctx, { kind: "calendars_large_total", totalBytes: total });
    } else if (total <= CALENDARS_LARGE_TOTAL_BYTES && marked) {
      db.prepare("DELETE FROM meta WHERE key = ?").run(META_TOTAL_WARNED);
    }
  } catch (error) {
    ctx.log.warn({ kind: "calendar_size", err: (error as Error).name }, "Calendar size could not be recorded");
  }
}

/** For the admin page: the total and the usernames (not the calendars) of people with a very large calendar. */
export function readCalendarSizes(db: DatabaseSync): CalendarSizes {
  const owners = db
    .prepare(
      `SELECT DISTINCT u.username AS username FROM calendars c JOIN users u ON u.id = c.user_id
       WHERE c.size_bytes > ?`,
    )
    .all(CALENDAR_LARGE_BYTES) as { username: string }[];
  return {
    totalBytes: totalBytes(db),
    largeCalendarOwners: owners.map((o) => o.username).sort((a, b) => a.localeCompare(b, "de")),
  };
}
