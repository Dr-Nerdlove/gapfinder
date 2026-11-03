// Reading the calendars of several people for their busy times: shared by the gap search and the check before
// a poll's date is fixed. `kind` picks which switch of a calendar counts: the hour search or the multi-day
// search. In the multi-day search only events of at least `DAYS_SEARCH_MIN_EVENT_HOURS` hours count (a short
// appointment does not block a whole day); the hour search sees every event. Never returns or logs anything of
// a calendar but the busy times.
import { DAYS_SEARCH_MIN_EVENT_HOURS, SEARCHES_PER_USER, type SkippedPerson } from "@lueckenfueller/shared";
import type { AppContext } from "../context.js";
import { rateLimited } from "../errors.js";
import type { Interval, SearchPersonInput } from "../gaps/search.js";
import { readStoredCalendar } from "./service.js";
import { listCalendars } from "./store.js";

/** At most this many calendars are read at the same time across one whole search. */
const MAX_CONCURRENT_READS = 8;

/**
 * Every search and every check before fixing a date counts, not only failed ones: reading calendars is the
 * expensive part. Both share one bucket per person. Throws `rate_limited` when the person is over the limit.
 */
export function countCalendarReads(ctx: AppContext, userId: number): void {
  const limitKey = `search:${userId}`;
  const wait = ctx.limiter.blockedFor(limitKey, SEARCHES_PER_USER);
  if (wait !== null) throw rateLimited(wait);
  ctx.limiter.recordFailure(limitKey);
}

/** Runs `work` for every item, at most `limit` at a time. `work` must not throw. */
async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Reads the calendars of everybody and tells who can be searched. Never returns or logs anything of a calendar
 * but the busy times; a person with no calendar, or with any calendar that cannot be read completely, is left
 * out (they would look free when they are not).
 */
export async function collectBusyTimes(
  ctx: AppContext,
  personIds: number[],
  kind: "hours" | "days",
): Promise<{ readable: SearchPersonInput[]; skipped: SkippedPerson[] }> {
  const busy: Interval[][] = personIds.map(() => []);
  const unreadable = personIds.map(() => false);
  const noCalendar = personIds.map(() => false);
  const reads: { person: number; row: ReturnType<typeof listCalendars>[number] }[] = [];
  personIds.forEach((id, person) => {
    const rows = listCalendars(ctx.db, id);
    if (rows.length === 0) noCalendar[person] = true;
    for (const row of rows) reads.push({ person, row });
  });

  await runPool(reads, MAX_CONCURRENT_READS, async ({ person, row }) => {
    if (unreadable[person]) return;
    try {
      const read = await readStoredCalendar(ctx, row);
      if (!read.ok || read.calendar.truncated) {
        unreadable[person] = true;
        return;
      }
      if ((kind === "days" ? row.counts_busy_days : row.counts_busy) !== 1) return;
      const minLength = kind === "days" ? DAYS_SEARCH_MIN_EVENT_HOURS * 3600_000 : 0;
      for (const event of read.calendar.events) {
        if (event.busy && event.end - event.start >= minLength) {
          busy[person]!.push({ start: event.start, end: event.end });
        }
      }
    } catch {
      unreadable[person] = true;
    }
  });

  const readable: SearchPersonInput[] = [];
  const skipped: SkippedPerson[] = [];
  personIds.forEach((id, person) => {
    if (noCalendar[person]) skipped.push({ personId: id, reason: "no_calendar" });
    else if (unreadable[person]) skipped.push({ personId: id, reason: "unreadable" });
    else readable.push({ id, busy: busy[person]! });
  });
  return { readable, skipped };
}
