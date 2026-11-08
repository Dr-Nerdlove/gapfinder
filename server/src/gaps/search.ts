// The gap search itself: pure functions, no I/O and no clock. Everything (busy times, "now") comes in as
// arguments, so the tests can check every rule, including the daylight saving days, without a server.
import {
  PARTIAL_MAX_ROWS,
  partialMaxMissing,
  type HoursDay,
  type HoursNearMiss,
  type HoursPartial,
  type Stretch,
  type StretchNearMiss,
  type StretchPartial,
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

/** A run of consecutive units (time pieces or days), both ends included, and who is busy somewhere in it. */
interface PartialRun {
  first: number;
  last: number;
  /** Indexes of the people, ascending; at least one. */
  missing: number[];
}

/**
 * The runs of consecutive units in which at most `maxMissing` people are busy, each as long as it can be for
 * exactly the people busy in it: one more unit on either side would add somebody. `busy[u]` lists who is busy
 * in unit `u`. Runs in which nobody is busy (times for everybody) are not returned. In order of `first`.
 *
 * A run that can be made longer without adding anybody is never returned, so the same people never appear
 * for two overlapping runs, and a run is never inside a run of fewer missing people.
 */
function partialRuns(busy: readonly (readonly number[])[], peopleCount: number, maxMissing: number): PartialRun[] {
  const runs: PartialRun[] = [];
  const inRun = new Uint8Array(peopleCount);
  const members: number[] = [];
  const within = (people: readonly number[]) => people.every((p) => inRun[p] === 1);
  for (let first = 0; first < busy.length; first++) {
    const before = first > 0 ? busy[first - 1]! : null;
    // Nobody busy just before: every run from here can start one unit earlier.
    if (before !== null && before.length === 0) continue;
    for (const p of members) inRun[p] = 0;
    members.length = 0;
    for (let last = first; last < busy.length; last++) {
      for (const p of busy[last]!) {
        if (inRun[p] === 0) {
          inRun[p] = 1;
          members.push(p);
        }
      }
      if (members.length > maxMissing) break;
      // From here on the unit before adds nobody: these runs all start earlier.
      if (before !== null && within(before)) break;
      const after = last + 1 < busy.length ? busy[last + 1]! : null;
      if (members.length > 0 && (after === null || !within(after))) {
        runs.push({ first, last, missing: [...members].sort((a, b) => a - b) });
      }
    }
  }
  for (const p of members) inRun[p] = 0;
  return runs;
}

/** Fewest missing first, then the earlier time, then by the people's ids. */
function byFewestMissing(a: { missing: number[]; at: number; to: number }, b: { missing: number[]; at: number; to: number }): number {
  if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
  if (a.at !== b.at) return a.at - b.at;
  if (a.to !== b.to) return a.to - b.to;
  for (let i = 0; i < a.missing.length; i++) {
    if (a.missing[i] !== b.missing[i]) return a.missing[i]! - b.missing[i]!;
  }
  return 0;
}

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
 * everybody is free for at least `durationMinutes`, with the buffer taken off every busy event. With at least
 * `NEAR_MISS_MIN_PEOPLE` people also the times free for all but a few (`partial`, see `partialRuns`), and the
 * ones with exactly one missing as `nearMisses` for older apps.
 */
export function searchHours(input: HoursSearchInput): {
  days: HoursDay[];
  nearMisses: HoursNearMiss[];
  partial: HoursPartial[];
} {
  const days: HoursDay[] = [];
  const nearMisses: HoursNearMiss[] = [];
  const partialRows: { missing: number[]; at: number; to: number; row: HoursPartial }[] = [];
  const { people } = input;
  if (people.length === 0) return { days, nearMisses, partial: [] };

  const bufferMs = input.bufferMinutes * MINUTE_MS;
  const minimumMs = input.durationMinutes * MINUTE_MS;
  const busy = people.map((person) =>
    union(person.busy.map((i) => ({ start: i.start - bufferMs, end: i.end + bufferMs }))),
  );
  const maxMissing = partialMaxMissing(people.length);
  const startMinutes = clockMinutes(input.window.start);
  const endMinutes = clockMinutes(input.window.end);
  // An end at or before the start is on the next day.
  const endOffset = endMinutes > startMinutes ? endMinutes : 1440 + endMinutes;
  const earliest = Math.ceil(input.now / QUARTER_MS) * QUARTER_MS;
  const weekdays = new Set<number>(input.weekdays);
  const last = dayNumber(input.to);
  const longEnough = (intervals: Interval[]) => intervals.filter((i) => i.end - i.start >= minimumMs);
  const toSlot = (i: Interval) => ({ start: iso(i.start), end: iso(i.end) });

  for (let n = dayNumber(input.from); n <= last; n++) {
    const day = datePartsOfDayNumber(n);
    if (!weekdays.has(isoWeekday(day))) continue;
    const windowStart = Math.max(
      berlinWallToUtc(day.year, day.month, day.day, startMinutes).getTime(),
      earliest,
    );
    const windowEnd = berlinWallToUtc(day.year, day.month, day.day, endOffset).getTime();
    if (windowStart >= windowEnd) continue;
    const date = formatDateParts(day);

    let everybody: Interval[] = [{ start: windowStart, end: windowEnd }];
    for (const list of busy) everybody = intersect(everybody, freeWithin(windowStart, windowEnd, list));
    const slots = longEnough(everybody);
    if (slots.length > 0) days.push({ date, slots: slots.map(toSlot) });
    if (maxMissing === 0) continue;

    // The window cut into pieces at every start and end of a busy time; who is busy in each piece.
    const inWindow = busy.map((list) => {
      const clipped: Interval[] = [];
      for (let i = firstEndingAfter(list, windowStart); i < list.length && list[i]!.start < windowEnd; i++) {
        clipped.push({ start: Math.max(list[i]!.start, windowStart), end: Math.min(list[i]!.end, windowEnd) });
      }
      return clipped;
    });
    const points = [...new Set([windowStart, windowEnd, ...inWindow.flatMap((l) => l.flatMap((i) => [i.start, i.end]))])];
    points.sort((x, y) => x - y);
    const pointIndex = new Map(points.map((point, index) => [point, index]));
    const pieceBusy: number[][] = Array.from({ length: points.length - 1 }, () => []);
    inWindow.forEach((list, person) => {
      for (const interval of list) {
        const to = pointIndex.get(interval.end)!;
        for (let piece = pointIndex.get(interval.start)!; piece < to; piece++) pieceBusy[piece]!.push(person);
      }
    });

    // One line per group of missing people, with all of its times on this day (they never overlap).
    const groups = new Map<string, { missing: number[]; slots: Interval[] }>();
    for (const run of partialRuns(pieceBusy, people.length, maxMissing)) {
      const interval = { start: points[run.first]!, end: points[run.last + 1]! };
      if (interval.end - interval.start < minimumMs) continue;
      const key = run.missing.join(",");
      const group = groups.get(key);
      if (group === undefined) groups.set(key, { missing: run.missing, slots: [interval] });
      else group.slots.push(interval);
    }
    const alone: { person: number; slots: Interval[] }[] = [];
    for (const group of groups.values()) {
      const ids = group.missing.map((index) => people[index]!.id).sort((x, y) => x - y);
      const first = group.slots[0]!;
      partialRows.push({
        missing: ids,
        at: first.start,
        to: first.end,
        row: { date, missingPersonIds: ids, slots: group.slots.map(toSlot) },
      });
      if (group.missing.length === 1) alone.push({ person: group.missing[0]!, slots: group.slots });
    }
    alone.sort((x, y) => x.person - y.person);
    for (const near of alone) {
      nearMisses.push({ date, missingPersonId: people[near.person]!.id, slots: near.slots.map(toSlot) });
    }
  }
  partialRows.sort(byFewestMissing);
  return { days, nearMisses, partial: partialRows.slice(0, PARTIAL_MAX_ROWS).map((r) => r.row) };
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
 * buffer). Result: runs of consecutive days free for everybody that a period of `days` fits in; with at least
 * `NEAR_MISS_MIN_PEOPLE` people also the runs free for all but a few (`partial`, see `partialRuns`) that a period
 * fits in, and the ones with exactly one missing as `nearMisses` for older apps. Today is never offered.
 */
export function searchDays(input: DaysSearchInput): {
  stretches: Stretch[];
  nearMisses: StretchNearMiss[];
  partial: StretchPartial[];
} {
  const { people } = input;
  const result = { stretches: [] as Stretch[], nearMisses: [] as StretchNearMiss[], partial: [] as StretchPartial[] };
  if (people.length === 0) return result;

  const tomorrow = dayNumber(addDaysToDate(berlinDateOf(new Date(input.now)), 1));
  const first = Math.max(dayNumber(input.from), tomorrow);
  const count = dayNumber(input.to) - first + 1;
  if (count <= 0) return result;

  const busy = people.map((person) => union(person.busy.filter((i) => i.end > i.start)));
  // busyOn[i]: the people (indexes, ascending) with a busy event on day first + i.
  const busyOn: number[][] = [];
  for (let i = 0; i < count; i++) {
    const day = datePartsOfDayNumber(first + i);
    const dayStart = berlinWallToUtc(day.year, day.month, day.day, 0).getTime();
    const dayEnd = berlinWallToUtc(day.year, day.month, day.day, 1440).getTime();
    const onDay: number[] = [];
    busy.forEach((list, person) => {
      const next = list[firstEndingAfter(list, dayStart)];
      if (next !== undefined && next.start < dayEnd) onDay.push(person);
    });
    busyOn.push(onDay);
  }

  for (const run of runsOf(first, count, (i) => busyOn[i]!.length === 0)) {
    const stretch = stretchOf(run, input.days, input.startWeekday);
    if (stretch !== null) result.stretches.push(stretch);
  }
  const maxMissing = partialMaxMissing(people.length);
  if (maxMissing === 0) return result;

  const rows: { missing: number[]; at: number; to: number; row: StretchPartial }[] = [];
  const alone: { at: number; person: number; stretch: Stretch }[] = [];
  for (const run of partialRuns(busyOn, people.length, maxMissing)) {
    const stretch = stretchOf({ first: first + run.first, last: first + run.last }, input.days, input.startWeekday);
    if (stretch === null) continue;
    const ids = run.missing.map((index) => people[index]!.id).sort((x, y) => x - y);
    rows.push({ missing: ids, at: run.first, to: run.last, row: { ...stretch, missingPersonIds: ids } });
    if (run.missing.length === 1) alone.push({ at: run.first, person: run.missing[0]!, stretch });
  }
  alone.sort((x, y) => x.at - y.at || x.person - y.person);
  result.nearMisses = alone.map((a) => ({ ...a.stretch, missingPersonId: people[a.person]!.id }));
  rows.sort(byFewestMissing);
  result.partial = rows.slice(0, PARTIAL_MAX_ROWS).map((r) => r.row);
  return result;
}
