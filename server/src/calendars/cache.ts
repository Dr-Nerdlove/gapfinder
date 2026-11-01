// Calendar contents live here and nowhere else: in memory, for 15 minutes, never on disk. Concurrent reads of
// the same calendar share one fetch.
import type { CalendarReadProblem } from "@lueckenfueller/shared";
import type { ParsedCalendar } from "./ics.js";

export const CALENDAR_CACHE_MS = 15 * 60 * 1000;

export type CalendarRead = { ok: true; calendar: ParsedCalendar } | { ok: false; problem: CalendarReadProblem };

interface Entry {
  calendarId: number;
  /** Set while the fetch is under way; shared by everybody who asks meanwhile. */
  pending: Promise<CalendarRead> | null;
  value: ParsedCalendar | null;
  expiresAt: number;
}

export class CalendarCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => Date) {}

  /**
   * The contents for this calendar and this exact (encrypted) link: from memory when fresh, otherwise `load`
   * is run once for all callers. Failures are handed to the callers waiting at that moment but not kept.
   */
  read(calendarId: number, linkEncrypted: string, load: () => Promise<CalendarRead>): Promise<CalendarRead> {
    this.sweep();
    // A new link has a new key, so it can never be served the old link's contents.
    const key = `${calendarId}:${linkEncrypted}`;
    const known = this.entries.get(key);
    if (known?.value) return Promise.resolve({ ok: true, calendar: known.value });
    if (known?.pending) return known.pending;

    const entry: Entry = { calendarId, pending: null, value: null, expiresAt: 0 };
    // `new Promise` also turns a loader that throws at once into a failed load.
    const pending = new Promise<CalendarRead>((resolve) => resolve(load())).then(
      (result) => this.settle(key, entry, result),
      () => this.settle(key, entry, { ok: false, problem: "unreachable" }),
    );
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }

  /** Forgets everything about a calendar (deleted, or given a new link). */
  drop(calendarId: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.calendarId === calendarId) this.entries.delete(key);
    }
  }

  size(): number {
    this.sweep();
    return this.entries.size;
  }

  private settle(key: string, entry: Entry, result: CalendarRead): CalendarRead {
    // Only touch the map while this entry is still the current one (it may have been dropped meanwhile).
    if (this.entries.get(key) === entry) {
      if (result.ok) {
        entry.value = result.calendar;
        entry.pending = null;
        entry.expiresAt = this.now().getTime() + CALENDAR_CACHE_MS;
      } else {
        this.entries.delete(key);
      }
    }
    return result;
  }

  private sweep(): void {
    const now = this.now().getTime();
    for (const [key, entry] of this.entries) {
      if (entry.value && entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
