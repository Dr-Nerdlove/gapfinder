// What the calendar routes do: checking a link, reading a stored calendar through the cache, the preview.
// The link (and anything taken from it) never goes into an error, a log line or a response.
import {
  CALENDAR_NAME_MAX_LENGTH,
  CALENDAR_PREVIEW_DAYS,
  normalizeName,
  type CalendarPreview,
  type CalendarProvider,
  type PreviewEvent,
} from "@lueckenfueller/shared";
import { CALENDAR_LINK_CHECKS_PER_USER } from "../auth/rate-limit.js";
import { decryptSecret, encryptSecret } from "../calendar-key.js";
import type { AppContext } from "../context.js";
import { ApiError, rateLimited, validation } from "../errors.js";
import { addDays, berlinMidnight } from "../time.js";
import type { CalendarRead } from "./cache.js";
import { normalizeCalendarUrl, type FetchFailure } from "./fetch.js";
import { parseCalendar, type ParsedCalendar } from "./ics.js";
import { providerOfLink } from "./provider.js";
import { listCalendars, setStatus, type CalendarRow } from "./store.js";

/** Calendars are read from a day ago to this many days ahead; the gap search needs up to a year. */
export const HORIZON_PAST_DAYS = 1;
export const HORIZON_FUTURE_DAYS = 400;

function horizon(now: Date): { start: Date; end: Date } {
  return { start: addDays(now, -HORIZON_PAST_DAYS), end: addDays(now, HORIZON_FUTURE_DAYS) };
}

/** The calendar key as a usable Buffer; only called while `ctx.calendarKeyStatus === "ok"`. */
function keyOf(ctx: AppContext): Buffer {
  if (ctx.calendarKeyStatus !== "ok" || ctx.config.calendarKey === null) {
    throw new ApiError(503, "calendars_unavailable");
  }
  return ctx.config.calendarKey;
}

/** Throws 503 `calendars_unavailable` unless the server can encrypt and decrypt links. */
export function requireCalendarKey(ctx: AppContext): Buffer {
  return keyOf(ctx);
}

/** A name from a request: normalized and checked; `null` when it is empty. Too long → validation error. */
export function checkedCalendarName(raw: string): string {
  const name = normalizeName(raw);
  if ([...name].length > CALENDAR_NAME_MAX_LENGTH) throw validation("name");
  return name;
}

function cutName(text: string): string {
  return [...normalizeName(text)].slice(0, CALENDAR_NAME_MAX_LENGTH).join("").trim();
}

function failureError(reason: FetchFailure): ApiError {
  switch (reason) {
    case "invalid_link":
      return new ApiError(400, "calendar_link_invalid", { field: "link" });
    case "blocked_address":
      return new ApiError(400, "calendar_link_blocked");
    case "gone":
      return new ApiError(400, "calendar_gone");
    case "too_large":
      return new ApiError(400, "calendar_too_large");
    case "unreachable":
      return new ApiError(502, "calendar_unreachable");
  }
}

export interface CheckedLink {
  linkEncrypted: string;
  provider: CalendarProvider;
  parsed: ParsedCalendar;
}

/**
 * Tries a new link at once: counts as an attempt, fetches it and reads it. Throws the API error to answer with
 * when it does not work. Nothing is stored here.
 */
export async function checkLink(ctx: AppContext, userId: number, rawLink: string): Promise<CheckedLink> {
  const key = keyOf(ctx);
  const url = normalizeCalendarUrl(rawLink);
  if (url === null) throw new ApiError(400, "calendar_link_invalid", { field: "link" });

  const limitKey = `calendar-link:${userId}`;
  const wait = ctx.limiter.blockedFor(limitKey, CALENDAR_LINK_CHECKS_PER_USER);
  if (wait !== null) throw rateLimited(wait);
  ctx.limiter.recordFailure(limitKey);

  const fetched = await ctx.fetchCalendarText(url);
  if (!fetched.ok) throw failureError(fetched.reason);
  const parsed = parseCalendar(fetched.text, horizon(ctx.now()));
  if (parsed === null) throw new ApiError(400, "calendar_not_ics");
  return { linkEncrypted: encryptSecret(key, url.href), provider: providerOfLink(url), parsed };
}

/** The name to store for a new calendar: the given one, else the feed's, else "". */
export function nameForNew(given: string | undefined, parsed: ParsedCalendar): string {
  if (given !== undefined) {
    const name = checkedCalendarName(given);
    if (name !== "") return name;
  }
  return parsed.name === null ? "" : cutName(parsed.name);
}

/** Puts freshly read contents into the cache (after a successful check). */
export function rememberContents(ctx: AppContext, calendarId: number, linkEncrypted: string, parsed: ParsedCalendar): void {
  void ctx.calendarCache.read(calendarId, linkEncrypted, async () => ({ ok: true, calendar: parsed }));
}

/**
 * Reads a stored calendar through the cache. Never throws and never logs the link. Updates the stored status:
 * "gone" marks it broken at once (nothing is deleted), a successful read marks it ok again.
 */
export function readStoredCalendar(ctx: AppContext, row: CalendarRow): Promise<CalendarRead> {
  return ctx.calendarCache.read(row.id, row.link_encrypted, async (): Promise<CalendarRead> => {
    const key = ctx.config.calendarKey;
    if (ctx.calendarKeyStatus !== "ok" || key === null) return { ok: false, problem: "unreachable" };
    let url: URL | null;
    try {
      url = normalizeCalendarUrl(decryptSecret(key, row.link_encrypted));
    } catch {
      return { ok: false, problem: "unreachable" };
    }
    if (url === null) return { ok: false, problem: "unreachable" };

    const fetched = await ctx.fetchCalendarText(url);
    if (!fetched.ok) {
      if (fetched.reason === "gone") {
        setStatus(ctx.db, row.id, row.link_encrypted, "broken", ctx.now().toISOString());
        return { ok: false, problem: "broken" };
      }
      return { ok: false, problem: "unreachable" };
    }
    const parsed = parseCalendar(fetched.text, horizon(ctx.now()));
    if (parsed === null) return { ok: false, problem: "unreachable" };
    setStatus(ctx.db, row.id, row.link_encrypted, "ok", ctx.now().toISOString());
    return { ok: true, calendar: parsed };
  });
}

/** The person's own events of the next `CALENDAR_PREVIEW_DAYS` days, from 00:00 German time today. */
export async function buildPreview(ctx: AppContext, userId: number): Promise<CalendarPreview> {
  const from = berlinMidnight(ctx.now());
  const to = berlinMidnight(ctx.now(), CALENDAR_PREVIEW_DAYS);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  const rows = listCalendars(ctx.db, userId);
  const reads = await Promise.all(
    rows.map(async (row) => {
      try {
        return await readStoredCalendar(ctx, row);
      } catch {
        return { ok: false, problem: "unreachable" } as const;
      }
    }),
  );

  const events: PreviewEvent[] = [];
  const problems: CalendarPreview["problems"] = [];
  rows.forEach((row, index) => {
    const read = reads[index]!;
    if (!read.ok) {
      problems.push({ calendarId: row.id, problem: read.problem });
      return;
    }
    for (const event of read.calendar.events) {
      if (event.start >= toMs || (event.end <= fromMs && event.start < fromMs)) continue;
      events.push({
        calendarId: row.id,
        title: event.title,
        start: new Date(event.start).toISOString(),
        end: new Date(event.end).toISOString(),
        allDay: event.allDay,
        countsAsBusy: event.busy && row.counts_busy === 1,
      });
    }
  });
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  return { state: "ready", from: from.toISOString(), to: to.toISOString(), events, problems };
}
