import {
  SEARCH_DEFAULT_WINDOW,
  SEARCH_MAX_BUFFER_MINUTES,
  SEARCH_MAX_DURATION_MINUTES,
  SEARCH_MAX_PEOPLE,
  SEARCH_MAX_PERIOD_DAYS,
  SEARCH_MAX_RANGE_DAYS,
  SEARCHES_PER_USER,
  type PeopleList,
  type SearchResult,
  type SkippedPerson,
  type TimeWindow,
  type Weekday,
} from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { findUserById, listUsers, toPerson } from "../accounts/users.js";
import { authOf, createGuards } from "../auth/guards.js";
import { requireCalendarKey, readStoredCalendar } from "../calendars/service.js";
import { listCalendars } from "../calendars/store.js";
import type { AppContext } from "../context.js";
import { rateLimited, validation } from "../errors.js";
import { clockMinutes, searchDays, searchHours, type Interval, type SearchPersonInput } from "../gaps/search.js";
import { berlinDateOf, dayNumber, parseDateParts, type DateParts } from "../time.js";

/** At most this many calendars are read at the same time across one whole search. */
const MAX_CONCURRENT_READS = 8;
/** The calendars are read up to 400 days ahead; a search may end a year from today at the latest. */
const MAX_DAYS_AHEAD = 365;
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;

const optionalInteger = { type: "integer" } as const;
const searchBody = {
  type: "object",
  required: ["mode", "people", "from", "to"],
  properties: {
    mode: { enum: ["hours", "days"] },
    // The caller may be in the list too; more than that cannot pass the limit anyway.
    people: { type: "array", maxItems: SEARCH_MAX_PEOPLE, items: { type: "integer" } },
    from: { type: "string", maxLength: 10 },
    to: { type: "string", maxLength: 10 },
    weekdays: { type: "array", maxItems: 7, items: optionalInteger },
    durationMinutes: optionalInteger,
    // What is missing or wrong inside is reported as "window" by `checkedWindow`.
    window: { type: "object" },
    bufferMinutes: optionalInteger,
    days: optionalInteger,
    startWeekday: optionalInteger,
  },
} as const;

/** What the JSON schema lets through; every rule beyond the types is checked in `checkedSearch`. */
interface RawSearch {
  mode: "hours" | "days";
  people: number[];
  from: string;
  to: string;
  weekdays?: number[];
  durationMinutes?: number;
  window?: { start?: unknown; end?: unknown };
  bufferMinutes?: number;
  days?: number;
  startWeekday?: number;
}

interface CheckedSearch {
  /** Caller first, then the others in the order of the request, each once. */
  personIds: number[];
  from: DateParts;
  to: DateParts;
  request:
    | { mode: "hours"; weekdays: Weekday[]; durationMinutes: number; window: TimeWindow; bufferMinutes: number }
    | { mode: "days"; days: number; startWeekday: Weekday | undefined };
}

const isWeekday = (value: number): value is Weekday => value >= 1 && value <= 7;

function checkedWindow(raw: RawSearch["window"]): TimeWindow {
  if (raw === undefined) return SEARCH_DEFAULT_WINDOW;
  const { start, end } = raw;
  if (typeof start !== "string" || typeof end !== "string") throw validation("window");
  if (!CLOCK_PATTERN.test(start) || !CLOCK_PATTERN.test(end) || start === end) throw validation("window");
  return { start, end };
}

/** Throws `validation(field)` for the first rule that is broken. */
function checkedSearch(ctx: AppContext, callerId: number, raw: RawSearch): CheckedSearch {
  const from = parseDateParts(raw.from);
  if (from === null) throw validation("from");
  const to = parseDateParts(raw.to);
  if (to === null) throw validation("to");
  const today = dayNumber(berlinDateOf(ctx.now()));
  if (dayNumber(from) < today) throw validation("from");
  if (dayNumber(to) < dayNumber(from)) throw validation("to");
  if (dayNumber(to) - dayNumber(from) + 1 > SEARCH_MAX_RANGE_DAYS) throw validation("to");
  if (dayNumber(to) > today + MAX_DAYS_AHEAD) throw validation("to");

  const personIds = [...new Set([callerId, ...raw.people])];
  if (personIds.length > SEARCH_MAX_PEOPLE) throw validation("people");
  if (personIds.some((id) => findUserById(ctx.db, id) === undefined)) throw validation("people");

  if (raw.mode === "days") {
    const { days, startWeekday } = raw;
    if (days === undefined || days < 1 || days > SEARCH_MAX_PERIOD_DAYS) throw validation("days");
    if (startWeekday !== undefined && !isWeekday(startWeekday)) throw validation("startWeekday");
    return { personIds, from, to, request: { mode: "days", days, startWeekday: startWeekday as Weekday | undefined } };
  }

  const weekdays = [...new Set(raw.weekdays ?? [])];
  if (weekdays.length === 0 || !weekdays.every(isWeekday)) throw validation("weekdays");
  const window = checkedWindow(raw.window);
  const { durationMinutes } = raw;
  if (
    durationMinutes === undefined ||
    durationMinutes % 30 !== 0 ||
    durationMinutes < 30 ||
    durationMinutes > SEARCH_MAX_DURATION_MINUTES
  ) {
    throw validation("durationMinutes");
  }
  const start = clockMinutes(window.start);
  const end = clockMinutes(window.end);
  const windowMinutes = end > start ? end - start : 1440 - start + end;
  if (durationMinutes > windowMinutes) throw validation("durationMinutes");
  const bufferMinutes = raw.bufferMinutes ?? 0;
  if (bufferMinutes % 15 !== 0 || bufferMinutes < 0 || bufferMinutes > SEARCH_MAX_BUFFER_MINUTES) {
    throw validation("bufferMinutes");
  }
  return {
    personIds,
    from,
    to,
    request: { mode: "hours", weekdays: weekdays as Weekday[], durationMinutes, window, bufferMinutes },
  };
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
async function collectBusyTimes(
  ctx: AppContext,
  personIds: number[],
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
      if (row.counts_busy !== 1) return;
      for (const event of read.calendar.events) {
        if (event.busy) busy[person]!.push({ start: event.start, end: event.end });
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

/** `GET /api/people` and `POST /api/searches`: choosing whom to search with, and the search. */
export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.get("/api/people", { onRequest: requireUser }, async (): Promise<PeopleList> => {
    return { people: listUsers(ctx.db).map(toPerson) };
  });

  app.post<{ Body: RawSearch }>(
    "/api/searches",
    { onRequest: requireUser, schema: { body: searchBody } },
    async (request): Promise<SearchResult> => {
      const { user } = authOf(request);
      const search = checkedSearch(ctx, user.id, request.body);
      requireCalendarKey(ctx);

      // Every search counts, not only failed ones: reading calendars is the expensive part.
      const limitKey = `search:${user.id}`;
      const wait = ctx.limiter.blockedFor(limitKey, SEARCHES_PER_USER);
      if (wait !== null) throw rateLimited(wait);
      ctx.limiter.recordFailure(limitKey);

      const { readable, skipped } = await collectBusyTimes(ctx, search.personIds);
      const now = ctx.now().getTime();
      const base = { people: readable, from: search.from, to: search.to, now };
      const { request: kind } = search;
      if (kind.mode === "days") {
        const found = searchDays({ ...base, days: kind.days, startWeekday: kind.startWeekday });
        return { mode: "days", skipped, ...found };
      }
      const found = searchHours({
        ...base,
        weekdays: kind.weekdays,
        durationMinutes: kind.durationMinutes,
        window: kind.window,
        bufferMinutes: kind.bufferMinutes,
      });
      return { mode: "hours", skipped, ...found };
    },
  );
}
