// The times for most but not all people (9c): `partial` of both search modes. Checked against examples and
// against a plain search that tries every group of missing people on a quarter-hour (or day) grid.
import { PARTIAL_MAX_ROWS, partialMaxMissing, type HoursPartial, type StretchPartial } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { searchDays, searchHours, type Interval, type SearchPersonInput } from "../src/gaps/search.js";
import { berlinWallToUtc, parseDateParts } from "../src/time.js";

const date = (text: string) => parseDateParts(text)!;
const ms = (text: string) => Date.parse(text);
const iso = (text: string) => new Date(text).toISOString();
const busy = (start: string, end: string): Interval => ({ start: ms(start), end: ms(end) });
const slot = (start: string, end: string) => ({ start: iso(start), end: iso(end) });
const person = (id: number, ...intervals: Interval[]): SearchPersonInput => ({ id, busy: intervals });
const free = (count: number, firstId = 100) => Array.from({ length: count }, (_, i) => person(firstId + i));

function allDay(first: string, last = first): Interval {
  const a = parseDateParts(first)!;
  const b = parseDateParts(last)!;
  return {
    start: berlinWallToUtc(a.year, a.month, a.day, 0).getTime(),
    end: berlinWallToUtc(b.year, b.month, b.day, 1440).getTime(),
  };
}

// 2026-11-07 is a Saturday, German winter time (UTC+1): 09:00 is 08:00 UTC, 23:00 is 22:00 UTC.
function hours(people: SearchPersonInput[], durationMinutes = 60, to = "2026-11-07") {
  return searchHours({
    people,
    from: date("2026-11-07"),
    to: date(to),
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    durationMinutes,
    window: { start: "09:00", end: "23:00" },
    bufferMinutes: 0,
    now: ms("2026-11-01T10:00:00Z"),
  });
}

function days(people: SearchPersonInput[], from: string, to: string, period: number) {
  return searchDays({ people, from: date(from), to: date(to), days: period, now: ms("2026-11-01T10:00:00Z") });
}

describe("partialMaxMissing", () => {
  it("allows a fifth of the people to be missing, at least one, from three people on", () => {
    expect([0, 1, 2].map(partialMaxMissing)).toEqual([0, 0, 0]);
    expect([3, 9, 10, 14, 15, 19, 20, 49, 50].map(partialMaxMissing)).toEqual([1, 1, 2, 2, 3, 3, 4, 9, 10]);
  });
});

describe("partial, hours", () => {
  it("names who is busy in a time, however many, up to a fifth", () => {
    // 15 people: 3 may be missing. 1 is busy 10–11, 2 is busy 12–13, 3 is busy 14–15 (German time).
    const people = [
      person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")),
      person(2, busy("2026-11-07T11:00:00Z", "2026-11-07T12:00:00Z")),
      person(3, busy("2026-11-07T13:00:00Z", "2026-11-07T14:00:00Z")),
      ...free(12),
    ];
    const { partial } = hours(people);
    expect(partial).toEqual<HoursPartial[]>([
      { date: "2026-11-07", missingPersonIds: [1], slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T11:00:00Z")] },
      { date: "2026-11-07", missingPersonIds: [2], slots: [slot("2026-11-07T10:00:00Z", "2026-11-07T13:00:00Z")] },
      { date: "2026-11-07", missingPersonIds: [3], slots: [slot("2026-11-07T12:00:00Z", "2026-11-07T22:00:00Z")] },
      { date: "2026-11-07", missingPersonIds: [1, 2], slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T13:00:00Z")] },
      { date: "2026-11-07", missingPersonIds: [2, 3], slots: [slot("2026-11-07T10:00:00Z", "2026-11-07T22:00:00Z")] },
      { date: "2026-11-07", missingPersonIds: [1, 2, 3], slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] },
    ]);
  });

  it("never lets more than a fifth be missing", () => {
    // 10 people, 2 may be missing; the three busy ones together are never offered.
    const people = [
      person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")),
      person(2, busy("2026-11-07T11:00:00Z", "2026-11-07T12:00:00Z")),
      person(3, busy("2026-11-07T13:00:00Z", "2026-11-07T14:00:00Z")),
      ...free(7),
    ];
    const { partial } = hours(people);
    expect(partial.map((p) => p.missingPersonIds)).toEqual([[1], [2], [3], [1, 2], [2, 3]]);
  });

  it("keeps the old list of exactly one missing next to it", () => {
    const people = [person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")), ...free(2)];
    const result = hours(people);
    expect(result.nearMisses).toEqual([
      { date: "2026-11-07", missingPersonId: 1, slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] },
    ]);
    expect(result.partial).toEqual([
      { date: "2026-11-07", missingPersonIds: [1], slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] },
    ]);
  });

  it("puts all lines with fewer missing before the earlier days", () => {
    // Saturday: 1 and 2 are busy at the same time. Sunday: only 3 is busy.
    const people = [
      person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")),
      person(2, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")),
      person(3, busy("2026-11-08T09:00:00Z", "2026-11-08T10:00:00Z")),
      ...free(7),
    ];
    const { partial } = hours(people, 60, "2026-11-08");
    expect(partial.map((p) => [p.date, p.missingPersonIds])).toEqual([
      ["2026-11-08", [3]],
      ["2026-11-07", [1, 2]],
    ]);
  });

  it("leaves out a time too short for the duration", () => {
    // 1 is busy 10–11 and 13–14, 2 is busy 12–13: without 2 only 11–13 is left, two hours.
    const people = [
      person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z"), busy("2026-11-07T12:00:00Z", "2026-11-07T13:00:00Z")),
      person(2, busy("2026-11-07T11:00:00Z", "2026-11-07T12:00:00Z")),
      ...free(1),
    ];
    expect(hours(people, 120).partial.map((p) => p.missingPersonIds)).toEqual([[1], [2]]);
    expect(hours(people, 180).partial.map((p) => p.missingPersonIds)).toEqual([[1]]);
  });

  it("is not looked for with fewer than three people", () => {
    const people = [person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")), person(2)];
    expect(hours(people).partial).toEqual([]);
  });

  it(`stops after ${PARTIAL_MAX_ROWS} lines, keeping the ones with fewest missing`, () => {
    // 60 days, every day person 1 is busy in the morning, 2 and 3 together in the evening.
    const people = [
      person(1, ...Array.from({ length: 60 }, (_, i) => ({ start: ms("2026-11-07T08:00:00Z") + i * 86_400_000, end: ms("2026-11-07T09:00:00Z") + i * 86_400_000 }))),
      person(2, ...Array.from({ length: 60 }, (_, i) => ({ start: ms("2026-11-07T20:00:00Z") + i * 86_400_000, end: ms("2026-11-07T21:00:00Z") + i * 86_400_000 }))),
      person(3, ...Array.from({ length: 60 }, (_, i) => ({ start: ms("2026-11-07T20:00:00Z") + i * 86_400_000, end: ms("2026-11-07T21:00:00Z") + i * 86_400_000 }))),
      ...free(7),
    ];
    const { partial } = hours(people, 60, "2027-01-05");
    expect(partial).toHaveLength(PARTIAL_MAX_ROWS);
    expect(partial.every((p) => p.missingPersonIds.length === 1)).toBe(true);
    expect(partial[0]!.date).toBe("2026-11-07");
    expect(partial[PARTIAL_MAX_ROWS - 1]!.date).toBe("2026-12-26");
  });
});

describe("partial, days", () => {
  it("names who is busy on a day of the stretch, up to a fifth", () => {
    // 10 people, 2 may be missing: 1 is busy on the 4th, 2 on the 6th.
    const people = [person(1, allDay("2026-11-04")), person(2, allDay("2026-11-06")), ...free(8)];
    const { stretches, partial } = days(people, "2026-11-02", "2026-11-08", 2);
    expect(stretches.map((s) => [s.first, s.last])).toEqual([["2026-11-02", "2026-11-03"], ["2026-11-07", "2026-11-08"]]);
    expect(partial).toEqual<StretchPartial[]>([
      { first: "2026-11-02", last: "2026-11-05", days: 4, missingPersonIds: [1] },
      { first: "2026-11-05", last: "2026-11-08", days: 4, missingPersonIds: [2] },
      { first: "2026-11-02", last: "2026-11-08", days: 7, missingPersonIds: [1, 2] },
    ]);
  });

  it("only offers stretches a period fits in", () => {
    const people = [person(1, allDay("2026-11-04")), person(2, allDay("2026-11-06")), ...free(8)];
    expect(days(people, "2026-11-02", "2026-11-08", 5).partial.map((p) => p.missingPersonIds)).toEqual([[1, 2]]);
  });
});

/** A small seeded random generator, so a failure can be repeated. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** All groups of up to `size` of the numbers 0..count-1, each ascending. */
function groupsOf(count: number, size: number): number[][] {
  const result: number[][] = [];
  const grow = (from: number, group: number[]) => {
    if (group.length > 0) result.push(group);
    if (group.length === size) return;
    for (let i = from; i < count; i++) grow(i + 1, [...group, i]);
  };
  grow(0, []);
  return result;
}

/** Per group of missing people: the longest runs of units in which only they are busy, and each of them is. */
function plainRuns(busyAt: boolean[][], units: number, maxMissing: number): { group: number[]; first: number; last: number }[] {
  const found: { group: number[]; first: number; last: number }[] = [];
  for (const group of groupsOf(busyAt.length, maxMissing)) {
    const onlyThem = (u: number) => busyAt.every((flags, p) => !flags[u] || group.includes(p));
    for (let u = 0; u < units; u++) {
      if (!onlyThem(u) || (u > 0 && onlyThem(u - 1))) continue;
      let last = u;
      while (last + 1 < units && onlyThem(last + 1)) last++;
      if (group.every((p) => busyAt[p]!.slice(u, last + 1).some(Boolean))) found.push({ group, first: u, last });
    }
  }
  return found;
}

const order = (a: { ids: number[]; first: number; last: number }, b: { ids: number[]; first: number; last: number }) =>
  a.ids.length - b.ids.length || a.first - b.first || a.last - b.last || a.ids.join(",").localeCompare(b.ids.join(","));

describe("partial against a plain search", () => {
  it("hours: finds exactly the same times on random days", () => {
    const windowStart = ms("2026-11-07T08:00:00Z"); // 09:00 German time
    const quarter = 15 * 60 * 1000;
    const quarters = 56; // 09:00–23:00
    for (let round = 0; round < 60; round++) {
      const next = random(round + 1);
      const count = 3 + Math.floor(next() * 10); // 3..12 people: 1 or 2 may be missing
      const duration = 15 * (1 + Math.floor(next() * 8));
      const people = Array.from({ length: count }, (_, p) => {
        const events = Array.from({ length: Math.floor(next() * 4) }, () => {
          const start = Math.floor(next() * 64) - 4; // may start before the window
          const length = 1 + Math.floor(next() * 12);
          return { start: windowStart + start * quarter, end: windowStart + (start + length) * quarter };
        });
        return person(p + 1, ...events);
      });
      const busyAt = people.map((p) =>
        Array.from({ length: quarters }, (_, q) => p.busy.some((e) => e.start < windowStart + (q + 1) * quarter && e.end > windowStart + q * quarter)),
      );
      const expected = plainRuns(busyAt, quarters, partialMaxMissing(count))
        .filter((r) => (r.last - r.first + 1) * 15 >= duration)
        .map((r) => ({ ids: r.group.map((p) => p + 1), first: r.first, last: r.last }));
      // One line per group; its first time decides the order.
      const lines = new Map<string, { ids: number[]; first: number; last: number; slots: { start: string; end: string }[] }>();
      for (const r of expected) {
        const key = r.ids.join(",");
        const s = { start: new Date(windowStart + r.first * quarter).toISOString(), end: new Date(windowStart + (r.last + 1) * quarter).toISOString() };
        const line = lines.get(key);
        if (line === undefined) lines.set(key, { ...r, slots: [s] });
        else line.slots.push(s);
      }
      const want = [...lines.values()].sort(order).slice(0, PARTIAL_MAX_ROWS).map((l) => ({ date: "2026-11-07", missingPersonIds: l.ids, slots: l.slots }));
      expect(hours(people, duration).partial, `round ${round}`).toEqual(want);
    }
  });

  it("days: finds exactly the same stretches on random weeks", () => {
    const first = date("2026-11-02");
    const units = 21;
    for (let round = 0; round < 60; round++) {
      const next = random(1000 + round);
      const count = 3 + Math.floor(next() * 13); // 3..15 people: 1 to 3 may be missing
      const period = 1 + Math.floor(next() * 4);
      const busyAt = Array.from({ length: count }, () => Array.from({ length: units }, () => next() < 0.12));
      const people = busyAt.map((flags, p) => {
        const events = flags.flatMap((isBusy, d) => {
          if (!isBusy) return [];
          const day = new Date(Date.UTC(first.year, first.month - 1, first.day + d));
          const text = day.toISOString().slice(0, 10);
          return [allDay(text)];
        });
        return person(p + 1, ...events);
      });
      const dayText = (u: number) => new Date(Date.UTC(first.year, first.month - 1, first.day + u)).toISOString().slice(0, 10);
      const want = plainRuns(busyAt, units, partialMaxMissing(count))
        .filter((r) => r.last - r.first + 1 >= period)
        .map((r) => ({ ids: r.group.map((p) => p + 1), first: r.first, last: r.last }))
        .sort(order)
        .slice(0, PARTIAL_MAX_ROWS)
        .map((r) => ({ first: dayText(r.first), last: dayText(r.last), days: r.last - r.first + 1, missingPersonIds: r.ids }));
      expect(days(people, "2026-11-02", dayText(units - 1), period).partial, `round ${round}`).toEqual(want);
    }
  });
});
