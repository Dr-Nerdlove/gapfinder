// The gap search itself: pure functions, no I/O and no clock. Everything (busy times, "now") comes in as
// arguments, so the tests can check every rule, including the daylight saving days, without a server.
import {
  NEAR_MISS_MIN_PEOPLE,
  type HoursDay,
  type HoursNearMiss,
  type Stretch,
  type StretchNearMiss,
  type TimeWindow,
  type Weekday,
} from "@lueckenfueller/shared";
import {
  addDaysToDate,
  berlinDateOf,
  berlinWallToUtc,
  dayNumber,
  datePartsOfDayNumber,
  formatDateParts,
  isoWeekday,
  type DateParts,
} from "../time.js";

const MINUTE_MS = 60 * 1000;
const QUARTER_MS = 15 * MINUTE_MS;

/** UTC milliseconds, `end` exclusive. */
export interface Interval {
  start: number;
  end: number;
}

export interface SearchPersonInput {
  id: number;
  /** Busy times, unsorted, may overlap. */
  busy: Interval[];
}

/** "HH:MM" as minutes after midnight. Only called with text the route has checked. */
export function clockMinutes(text: string): number {
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
}

/** Sorted, with overlapping and touching intervals joined; empty ones dropped. */
function union(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Interval[] = [];
  for (const interval of sorted) {
    const last = result[result.length - 1];
    if (last !== undefined && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      result.push({ start: interval.start, end: interval.end });
    }
  }
  return result;
}

/** Index of the first interval of a sorted, disjoint list that ends after `time`. */
function firstEndingAfter(sorted: Interval[], time: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]!.end > time) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The part of [start, end) that is not busy; `busy` is sorted and disjoint. */
function freeWithin(start: number, end: number, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = start;
  for (let i = firstEndingAfter(busy, start); i < busy.length && busy[i]!.start < end; i++) {
    const interval = busy[i]!;
    if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < end) free.push({ start: cursor, end });
  return free;
}

/** The times that are in both lists (each sorted and disjoint). */
function intersect(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i]!.start, b[j]!.start);
    const end = Math.min(a[i]!.end, b[j]!.end);
    if (start < end) result.push({ start, end });
    if (a[i]!.end < b[j]!.end) i++;
    else j++;
  }
  return result;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export interface HoursSearchInput {
  people: SearchPersonInput[];
  /** First and last German day, both included. */
  from: DateParts;
  to: DateParts;
  weekdays: readonly Weekday[];
  durationMinutes: number;
  window: TimeWindow;
  bufferMinutes: number;
  /** UTC milliseconds; nothing earlier than this (rounded up to a quarter of an hour) is offered. */
  now: number;
}

/**
 * Hours mode. For each German day of the range on one of the weekdays: the times within the window at which
 * everybody is free for at least `durationMinutes`, with the buffer taken off every busy event; and the same
 * for everybody but one person (near misses), unless that is already inside a result for everybody.
 */
export function searchHours(input: HoursSearchInput): { days: HoursDay[]; nearMisses: HoursNearMiss[] } {
  const days: HoursDay[] = [];
  const nearMisses: HoursNearMiss[] = [];
  const { people } = input;
  if (people.length === 0) return { days, nearMisses };

  const bufferMs = input.bufferMinutes * MINUTE_MS;
  const minimumMs = input.durationMinutes * MINUTE_MS;
  const busy = people.map((person) =>
    union(person.busy.map((i) => ({ start: i.start - bufferMs, end: i.end + bufferMs }))),
  );
  const startMinutes = clockMinutes(input.window.start);
  const endMinutes = clockMinutes(input.window.end);
  // An end at or before the start is on the next day.
  const endOffset = endMinutes > startMinutes ? endMinutes : 1440 + endMinutes;
  const earliest = Math.ceil(input.now / QUARTER_MS) * QUARTER_MS;
  const weekdays = new Set<number>(input.weekdays);
  const last = dayNumber(input.to);
  const longEnough = (intervals: Interval[]) => intervals.filter((i) => i.end - i.start >= minimumMs);

  for (let n = dayNumber(input.from); n <= last; n++) {
    const day = datePartsOfDayNumber(n);
    if (!weekdays.has(isoWeekday(day))) continue;
    const windowStart = Math.max(
      berlinWallToUtc(day.year, day.month, day.day, startMinutes).getTime(),
      earliest,
    );
    const windowEnd = berlinWallToUtc(day.year, day.month, day.day, endOffset).getTime();
    if (windowStart >= windowEnd) continue;

    const free = busy.map((list) => freeWithin(windowStart, windowEnd, list));
    // prefix[i]: free for everybody before person i; suffix[i]: free for everybody from person i on.
    const whole: Interval[] = [{ start: windowStart, end: windowEnd }];
    const prefix: Interval[][] = [whole];
    for (let i = 0; i < free.length; i++) prefix.push(intersect(prefix[i]!, free[i]!));
    const suffix: Interval[][] = new Array<Interval[]>(free.length + 1);
    suffix[free.length] = whole;
    for (let i = free.length - 1; i >= 0; i--) suffix[i] = intersect(suffix[i + 1]!, free[i]!);

    const slots = longEnough(prefix[free.length]!);
    if (slots.length > 0) {
      days.push({ date: formatDateParts(day), slots: slots.map((s) => ({ start: iso(s.start), end: iso(s.end) })) });
    }
    if (people.length < NEAR_MISS_MIN_PEOPLE) continue;
    people.forEach((person, index) => {
      const withoutPerson = longEnough(intersect(prefix[index]!, suffix[index + 1]!));
      const missed = withoutPerson.filter((i) => !slots.some((s) => i.start >= s.start && i.end <= s.end));
      if (missed.length > 0) {
        nearMisses.push({
          date: formatDateParts(day),
          missingPersonId: person.id,
          slots: missed.map((s) => ({ start: iso(s.start), end: iso(s.end) })),
        });
      }
    });
  }
  return { days, nearMisses };
}

export interface DaysSearchInput {
  people: SearchPersonInput[];
  from: DateParts;
  to: DateParts;
  days: number;
  startWeekday?: Weekday | undefined;
  now: number;
}

/** A run of consecutive day numbers, both ends included. */
interface Run {
  first: number;
  last: number;
}

/** The stretch for a run if a period fits in it, else null. */
function stretchOf(run: Run, days: number, startWeekday: Weekday | undefined): Stretch | null {
  const stretch: Stretch = {
    first: formatDateParts(datePartsOfDayNumber(run.first)),
    last: formatDateParts(datePartsOfDayNumber(run.last)),
    days: run.last - run.first + 1,
  };
  if (startWeekday === undefined) return stretch.days >= days ? stretch : null;
  const starts: string[] = [];
  for (let n = run.first; n + days - 1 <= run.last; n++) {
    const date = datePartsOfDayNumber(n);
    if (isoWeekday(date) === startWeekday) starts.push(formatDateParts(date));
  }
  if (starts.length === 0) return null;
  stretch.starts = starts;
  return stretch;
}

/** Maximal runs of consecutive days (from `first`) for which `isFree(index)` holds. */
function runsOf(first: number, count: number, isFree: (index: number) => boolean): Run[] {
  const runs: Run[] = [];
  let open: number | null = null;
  for (let i = 0; i <= count; i++) {
    if (i < count && isFree(i)) {
      open ??= i;
    } else if (open !== null) {
      runs.push({ first: first + open, last: first + i - 1 });
      open = null;
    }
  }
  return runs;
}

/**
 * Days mode. A day is free for a person when no busy event overlaps it (German midnight to midnight, no
 * buffer). Result: runs of consecutive days free for everybody that a period of `days` fits in, and the same
 * for everybody but one person, unless that run lies inside a result for everybody. Today is never offered.
 */
export function searchDays(input: DaysSearchInput): { stretches: Stretch[]; nearMisses: StretchNearMiss[] } {
  const { people } = input;
  const result = { stretches: [] as Stretch[], nearMisses: [] as StretchNearMiss[] };
  if (people.length === 0) return result;

  const tomorrow = dayNumber(addDaysToDate(berlinDateOf(new Date(input.now)), 1));
  const first = Math.max(dayNumber(input.from), tomorrow);
  const count = dayNumber(input.to) - first + 1;
  if (count <= 0) return result;

  const busy = people.map((person) => union(person.busy.filter((i) => i.end > i.start)));
  // busyOn[p][i]: person p has a busy event on day first + i.
  const busyOn = busy.map((list) => {
    const flags: boolean[] = [];
    for (let i = 0; i < count; i++) {
      const day = datePartsOfDayNumber(first + i);
      const dayStart = berlinWallToUtc(day.year, day.month, day.day, 0).getTime();
      const dayEnd = berlinWallToUtc(day.year, day.month, day.day, 1440).getTime();
      const next = list[firstEndingAfter(list, dayStart)];
      flags.push(next !== undefined && next.start < dayEnd);
    }
    return flags;
  });
  const busyCount = Array.from({ length: count }, (_, i) => busyOn.reduce((sum, flags) => sum + (flags[i] ? 1 : 0), 0));

  const everybody = runsOf(first, count, (i) => busyCount[i] === 0);
  const qualifying: Run[] = [];
  for (const run of everybody) {
    const stretch = stretchOf(run, input.days, input.startWeekday);
    if (stretch === null) continue;
    qualifying.push(run);
    result.stretches.push(stretch);
  }
  if (people.length < NEAR_MISS_MIN_PEOPLE) return result;

  const found: { first: number; stretch: StretchNearMiss }[] = [];
  people.forEach((person, index) => {
    const flags = busyOn[index]!;
    const runs = runsOf(first, count, (i) => busyCount[i] === 0 || (busyCount[i] === 1 && flags[i] === true));
    for (const run of runs) {
      if (qualifying.some((q) => run.first >= q.first && run.last <= q.last)) continue;
      const stretch = stretchOf(run, input.days, input.startWeekday);
      if (stretch !== null) found.push({ first: run.first, stretch: { ...stretch, missingPersonId: person.id } });
    }
  });
  // Stable: for the same first day, the order of the people stays.
  found.sort((a, b) => a.first - b.first);
  result.nearMisses = found.map((f) => f.stretch);
  return result;
}
