import type { CalendarPreview, PreviewEvent } from "@lueckenfueller/shared";

// Groups the events of the preview by day in German time. All times are UTC instants from the server;
// the day borders are German midnights, so a day can be 23 or 25 hours long (clock change).

const TIME_ZONE = "Europe/Berlin";
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const MINUTE = 60_000;
/** Safety stop for events with absurd lengths. */
const MAX_DAYS_PER_EVENT = 400;

export const NO_TITLE = "(ohne Titel)";
export const ALL_DAY_LABEL = "ganztägig";

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function berlinParts(ms: number): Parts {
  const parts: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts["year"]!, month: parts["month"]!, day: parts["day"]!, hour: parts["hour"]!, minute: parts["minute"]! };
}

/** German time minus UTC at this instant, in ms (1 h in winter, 2 h in summer). */
function offsetMs(ms: number): number {
  const p = berlinParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / MINUTE) * MINUTE;
}

/** The instant of 00:00 German time on a calendar day (month 1-12; days beyond the month roll over). */
function berlinMidnight(year: number, month: number, day: number): number {
  const utcMidnight = Date.UTC(year, month - 1, day);
  // German midnight is never inside the clock change (that happens at 02:00/03:00), so the offset of the
  // instant just before it is the right one.
  return utcMidnight - offsetMs(utcMidnight - 3 * 60 * MINUTE);
}

const pad = (n: number): string => String(n).padStart(2, "0");

function timeOf(ms: number): string {
  const p = berlinParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * How an event looks on one day:
 * - `all-day`: an all-day event (every day it covers)
 * - `whole`: a timed event that fills the whole day (the middle days of a long one)
 * - `within`: starts and ends this day
 * - `from`: starts this day and goes on ("ab 18:00")
 * - `until`: started before and ends this day ("bis 10:00")
 */
export type EntryKind = "all-day" | "whole" | "within" | "from" | "until";

export interface PreviewEntry {
  calendarId: number;
  title: string;
  kind: EntryKind;
  /** "09:00–10:30", "ab 18:00", "bis 10:00" or "ganztägig". */
  timeLabel: string;
  /** False: the event does not make the person busy (shown greyed with "zählt nicht"). */
  countsAsBusy: boolean;
  /** Start of the part of the event on this day, for sorting. */
  sortStart: number;
}

export interface PreviewDay {
  /** "2026-11-02", the German date. */
  key: string;
  /** "Mo, 2.11." */
  heading: string;
  entries: PreviewEntry[];
}

export interface GroupRange {
  /** ISO 8601 UTC, from `CalendarPreview.from` / `.to`: days outside are left out. */
  from?: string;
  to?: string;
}

/** "Mo, 2.11." for a German date. */
export function dayHeading(year: number, month: number, day: number): string {
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
  return `${weekday}, ${day}.${month}.`;
}

const dayKey = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

function rank(entry: PreviewEntry): number {
  return entry.kind === "all-day" || entry.kind === "whole" ? 0 : 1;
}

function compareEntries(a: PreviewEntry, b: PreviewEntry): number {
  return (
    rank(a) - rank(b) ||
    a.sortStart - b.sortStart ||
    a.calendarId - b.calendarId ||
    a.title.localeCompare(b.title, "de")
  );
}

/**
 * Groups events per German day, sorted by day and, within a day, all-day entries first and then by time.
 * An event that spans several days appears on each day, cut to that day. Days without events are left out.
 */
export function groupPreviewByDay(events: readonly PreviewEvent[], range: GroupRange = {}): PreviewDay[] {
  const rangeFrom = range.from === undefined ? -Infinity : Date.parse(range.from);
  const rangeTo = range.to === undefined ? Infinity : Date.parse(range.to);
  const days = new Map<string, PreviewDay & { dayStart: number }>();

  for (const event of events) {
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    const title = event.title.trim() === "" ? NO_TITLE : event.title.trim();
    // An event without length still shows on its day.
    const lastMs = Math.max(endMs, startMs);

    const first = berlinParts(startMs);
    let [year, month, day] = [first.year, first.month, first.day];
    for (let i = 0; i < MAX_DAYS_PER_EVENT; i++) {
      const dayStart = berlinMidnight(year, month, day);
      const nextStart = berlinMidnight(year, month, day + 1);
      // Past the event (an event that ends at midnight does not touch the next day), unless it has no length.
      if (i > 0 && dayStart >= lastMs) break;
      if (dayStart >= rangeTo) break;

      const next = berlinParts(nextStart);
      if (nextStart > rangeFrom) {
        const startsHere = startMs >= dayStart;
        const endsHere = lastMs <= nextStart;
        let kind: EntryKind;
        let timeLabel: string;
        if (event.allDay) {
          kind = "all-day";
          timeLabel = ALL_DAY_LABEL;
        } else if (startMs <= dayStart && lastMs >= nextStart) {
          kind = "whole";
          timeLabel = ALL_DAY_LABEL;
        } else if (startsHere && endsHere) {
          kind = "within";
          timeLabel = endMs > startMs ? `${timeOf(startMs)}–${timeOf(endMs)}` : timeOf(startMs);
        } else if (startsHere) {
          kind = "from";
          timeLabel = `ab ${timeOf(startMs)}`;
        } else {
          kind = "until";
          timeLabel = `bis ${timeOf(endMs)}`;
        }
        const key = dayKey(year, month, day);
        let entry = days.get(key);
        if (!entry) {
          entry = { key, heading: dayHeading(year, month, day), entries: [], dayStart };
          days.set(key, entry);
        }
        entry.entries.push({
          calendarId: event.calendarId,
          title,
          kind,
          timeLabel,
          countsAsBusy: event.countsAsBusy,
          sortStart: Math.max(startMs, dayStart),
        });
      }
      [year, month, day] = [next.year, next.month, next.day];
    }
  }

  return [...days.values()]
    .sort((a, b) => a.dayStart - b.dayStart)
    .map(({ key, heading, entries }) => ({ key, heading, entries: entries.sort(compareEntries) }));
}

/** The days of a preview answer. */
export function previewDays(preview: Pick<CalendarPreview, "events" | "from" | "to">): PreviewDay[] {
  return groupPreviewByDay(preview.events, { from: preview.from, to: preview.to });
}

export interface ProblemNotice {
  calendarId: number;
  /** The calendar's name, or a general word when it is no longer in the list. */
  name: string;
  /** "broken": the link must be entered again; "unreachable": try again later. */
  problem: "broken" | "unreachable";
  text: string;
}

/** One notice per calendar that could not be read for the preview. */
export function problemNotices(
  problems: CalendarPreview["problems"],
  calendars: readonly { id: number; name: string }[],
): ProblemNotice[] {
  return problems.map(({ calendarId, problem }) => {
    const name = calendars.find((calendar) => calendar.id === calendarId)?.name ?? "Ein Kalender";
    const text =
      problem === "broken"
        ? `Der Link von „${name}“ funktioniert nicht mehr.`
        : `„${name}“ konnte gerade nicht gelesen werden.`;
    return { calendarId, name, problem, text };
  });
}
