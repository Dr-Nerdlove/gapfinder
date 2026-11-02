import type { Weekday } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import {
  searchDays,
  searchHours,
  type HoursSearchInput,
  type Interval,
  type SearchPersonInput,
} from "../src/gaps/search.js";
import { berlinWallToUtc, parseDateParts } from "../src/time.js";

const date = (text: string) => parseDateParts(text)!;
const ms = (text: string) => Date.parse(text);
const iso = (text: string) => new Date(text).toISOString();
const busy = (start: string, end: string): Interval => ({ start: ms(start), end: ms(end) });
const slot = (start: string, end: string) => ({ start: iso(start), end: iso(end) });
const person = (id: number, ...intervals: Interval[]): SearchPersonInput => ({ id, busy: intervals });
const ALL_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The whole German days `first`..`last` as one busy time (what an all-day event looks like). */
function allDay(first: string, last = first): Interval {
  const a = parseDateParts(first)!;
  const b = parseDateParts(last)!;
  return {
    start: berlinWallToUtc(a.year, a.month, a.day, 0).getTime(),
    end: berlinWallToUtc(b.year, b.month, b.day, 1440).getTime(),
  };
}

// 2026-11-07 is a Saturday, German winter time (UTC+1): 09:00 is 08:00 UTC, 23:00 is 22:00 UTC.
function hours(people: SearchPersonInput[], overrides: Partial<HoursSearchInput> = {}) {
  return searchHours({
    people,
    from: date("2026-11-07"),
    to: date("2026-11-07"),
    weekdays: ALL_WEEKDAYS,
    durationMinutes: 60,
    window: { start: "09:00", end: "23:00" },
    bufferMinutes: 0,
    now: ms("2026-11-01T10:00:00Z"),
    ...overrides,
  });
}

describe("searchHours", () => {
  it("offers the whole window to a person with nothing to do", () => {
    expect(hours([person(1)])).toEqual({
      days: [{ date: "2026-11-07", slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] }],
      nearMisses: [],
    });
  });

  it("finds nothing without people", () => {
    expect(hours([])).toEqual({ days: [], nearMisses: [] });
  });

  it("cuts a busy time out of the day and reports every slot that is left", () => {
    const result = hours([person(1, busy("2026-11-07T11:00:00Z", "2026-11-07T12:00:00Z"))]);
    expect(result.days).toEqual([
      {
        date: "2026-11-07",
        slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T11:00:00Z"), slot("2026-11-07T12:00:00Z", "2026-11-07T22:00:00Z")],
      },
    ]);
  });

  it("offers nothing on a day that is busy from morning to night", () => {
    expect(hours([person(1, busy("2026-11-07T07:00:00Z", "2026-11-07T23:00:00Z"))]).days).toEqual([]);
  });

  it("ignores busy times outside the window", () => {
    const result = hours([person(1, busy("2026-11-07T05:00:00Z", "2026-11-07T08:00:00Z"), busy("2026-11-07T22:00:00Z", "2026-11-08T02:00:00Z"))]);
    expect(result.days[0]!.slots).toEqual([slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")]);
  });

  it("offers only what is free for two people (the intersection)", () => {
    const result = hours([
      person(1, busy("2026-11-07T08:00:00Z", "2026-11-07T12:00:00Z")),
      person(2, busy("2026-11-07T10:00:00Z", "2026-11-07T14:00:00Z")),
    ]);
    expect(result.days[0]!.slots).toEqual([slot("2026-11-07T14:00:00Z", "2026-11-07T22:00:00Z")]);
  });

  it("keeps a slot that is exactly as long as asked and drops one a minute shorter", () => {
    const exact = hours([person(1, busy("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z"), busy("2026-11-07T10:00:00Z", "2026-11-07T22:00:00Z"))]);
    expect(exact.days[0]!.slots).toEqual([slot("2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z")]);
    const shorter = hours([person(1, busy("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z"), busy("2026-11-07T09:59:00Z", "2026-11-07T22:00:00Z"))]);
    expect(shorter.days).toEqual([]);
  });

  it("drops short slots and keeps the long ones on the same day", () => {
    const result = hours(
      [person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T09:30:00Z"), busy("2026-11-07T11:00:00Z", "2026-11-07T11:30:00Z"))],
      { durationMinutes: 90 },
    );
    expect(result.days[0]!.slots).toEqual([
      slot("2026-11-07T09:30:00Z", "2026-11-07T11:00:00Z"),
      slot("2026-11-07T11:30:00Z", "2026-11-07T22:00:00Z"),
    ]);
  });

  it("joins overlapping, touching and unsorted busy times", () => {
    const result = hours([
      person(
        1,
        busy("2026-11-07T12:00:00Z", "2026-11-07T14:00:00Z"),
        busy("2026-11-07T10:00:00Z", "2026-11-07T13:00:00Z"),
        busy("2026-11-07T14:00:00Z", "2026-11-07T15:00:00Z"),
        busy("2026-11-07T10:30:00Z", "2026-11-07T11:00:00Z"),
      ),
    ]);
    expect(result.days[0]!.slots).toEqual([
      slot("2026-11-07T08:00:00Z", "2026-11-07T10:00:00Z"),
      slot("2026-11-07T15:00:00Z", "2026-11-07T22:00:00Z"),
    ]);
  });

  it("lets an all-day event take the whole day and nothing of the next", () => {
    const result = hours([person(1, allDay("2026-11-07"))], { to: date("2026-11-08") });
    expect(result.days.map((d) => d.date)).toEqual(["2026-11-08"]);
  });

  describe("window", () => {
    it("can end at 00:00, which is the end of the day", () => {
      const result = hours([person(1)], { window: { start: "18:00", end: "00:00" } });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T17:00:00Z", "2026-11-07T23:00:00Z")]);
    });

    it("can cross midnight and then belongs to the day it starts", () => {
      const result = hours(
        [person(1, busy("2026-11-08T00:00:00Z", "2026-11-08T00:30:00Z"))],
        { window: { start: "20:00", end: "02:00" }, durationMinutes: 30, to: date("2026-11-08") },
      );
      expect(result.days).toEqual([
        {
          date: "2026-11-07",
          slots: [slot("2026-11-07T19:00:00Z", "2026-11-08T00:00:00Z"), slot("2026-11-08T00:30:00Z", "2026-11-08T01:00:00Z")],
        },
        { date: "2026-11-08", slots: [slot("2026-11-08T19:00:00Z", "2026-11-09T01:00:00Z")] },
      ]);
    });

    it("lets a busy time at the end of a crossing window cost the slot", () => {
      const result = hours([person(1, busy("2026-11-08T00:00:00Z", "2026-11-08T02:00:00Z"))], {
        window: { start: "20:00", end: "02:00" },
      });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T19:00:00Z", "2026-11-08T00:00:00Z")]);
    });

    it("can cross midnight by almost a whole day (23:45 to 23:30)", () => {
      const result = hours([person(1)], { window: { start: "23:45", end: "23:30" }, durationMinutes: 60 });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T22:45:00Z", "2026-11-08T22:30:00Z")]);
    });

    it("is 09:00 to 23:00 German time, 14 hours", () => {
      const slots = hours([person(1)]).days[0]!.slots;
      expect(slots).toEqual([slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")]);
    });
  });

  describe("buffer", () => {
    it("widens every busy time on both sides", () => {
      // Busy 12:00-13:30 German time; with 30 minutes of buffer the next slot starts at 14:00 German time.
      const result = hours([person(1, busy("2026-11-07T11:00:00Z", "2026-11-07T12:30:00Z"))], { bufferMinutes: 30 });
      expect(result.days[0]!.slots).toEqual([
        slot("2026-11-07T08:00:00Z", "2026-11-07T10:30:00Z"),
        slot("2026-11-07T13:00:00Z", "2026-11-07T22:00:00Z"),
      ]);
    });

    it("without a buffer the slot starts right after the event", () => {
      const result = hours([person(1, busy("2026-11-07T11:00:00Z", "2026-11-07T12:30:00Z"))]);
      expect(result.days[0]!.slots[1]).toEqual(slot("2026-11-07T12:30:00Z", "2026-11-07T22:00:00Z"));
    });

    it("lets an event just outside the window cost time inside it", () => {
      const result = hours([person(1, busy("2026-11-07T07:00:00Z", "2026-11-07T07:45:00Z"))], { bufferMinutes: 60 });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T08:45:00Z", "2026-11-07T22:00:00Z")]);
    });

    it("can make two events swallow the gap between them", () => {
      const result = hours(
        [person(1, busy("2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z"), busy("2026-11-07T11:50:00Z", "2026-11-07T13:00:00Z"))],
        { bufferMinutes: 30, durationMinutes: 30 },
      );
      expect(result.days[0]!.slots).toEqual([
        slot("2026-11-07T08:00:00Z", "2026-11-07T09:30:00Z"),
        slot("2026-11-07T13:30:00Z", "2026-11-07T22:00:00Z"),
      ]);
    });
  });

  describe("weekdays", () => {
    it("only looks at the chosen weekdays", () => {
      const result = hours([person(1)], { from: date("2026-11-06"), to: date("2026-11-09"), weekdays: [6] });
      expect(result.days.map((d) => d.date)).toEqual(["2026-11-07"]);
    });

    it("takes several weekdays, in the order of the days", () => {
      const result = hours([person(1)], { from: date("2026-11-06"), to: date("2026-11-09"), weekdays: [7, 5] });
      expect(result.days.map((d) => d.date)).toEqual(["2026-11-06", "2026-11-08"]);
    });
  });

  describe("now", () => {
    it("offers today only from now on, rounded up to the next quarter of an hour", () => {
      const result = hours([person(1)], { now: ms("2026-11-07T10:07:00Z") });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T10:15:00Z", "2026-11-07T22:00:00Z")]);
    });

    it("keeps a time that is exactly on a quarter of an hour", () => {
      const result = hours([person(1)], { now: ms("2026-11-07T10:15:00Z") });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T10:15:00Z", "2026-11-07T22:00:00Z")]);
    });

    it("rounds a second past the quarter up", () => {
      const result = hours([person(1)], { now: ms("2026-11-07T10:15:01Z") });
      expect(result.days[0]!.slots[0]!.start).toBe(iso("2026-11-07T10:30:00Z"));
    });

    it("does not change a window that is still ahead", () => {
      const result = hours([person(1)], { now: ms("2026-11-07T03:10:00Z") });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")]);
    });

    it("skips a window that is over, and one that is too short for the duration", () => {
      expect(hours([person(1)], { now: ms("2026-11-07T22:00:00Z") }).days).toEqual([]);
      expect(hours([person(1)], { now: ms("2026-11-07T23:30:00Z") }).days).toEqual([]);
      expect(hours([person(1)], { now: ms("2026-11-07T21:15:00Z") }).days).toEqual([]);
      expect(hours([person(1)], { now: ms("2026-11-07T21:00:00Z") }).days).toHaveLength(1);
    });

    it("keeps the end of a window that crossed midnight when the evening is over", () => {
      const result = hours([person(1)], {
        window: { start: "20:00", end: "02:00" },
        now: ms("2026-11-08T00:10:00Z"),
        durationMinutes: 30,
      });
      expect(result.days[0]!.slots).toEqual([slot("2026-11-08T00:15:00Z", "2026-11-08T01:00:00Z")]);
    });
  });

  describe("daylight saving time", () => {
    // 2026-03-29: clocks go from 02:00 to 03:00 (01:00 UTC). Before it Germany is UTC+1, after it UTC+2.
    const spring = { from: date("2026-03-29"), to: date("2026-03-29"), now: ms("2026-03-20T10:00:00Z") };
    // 2026-10-25: clocks go from 03:00 to 02:00 (01:00 UTC). Before it UTC+2, after it UTC+1.
    const autumn = { from: date("2026-10-25"), to: date("2026-10-25"), now: ms("2026-10-20T10:00:00Z") };

    it("spring: 09:00 to 23:00 is still 14 hours", () => {
      const slots = hours([person(1)], spring).days[0]!.slots;
      expect(slots).toEqual([slot("2026-03-29T07:00:00Z", "2026-03-29T21:00:00Z")]);
    });

    it("spring: a window across the change is an hour shorter than the clock says", () => {
      const result = hours([person(1)], { ...spring, window: { start: "01:00", end: "04:00" }, durationMinutes: 60 });
      expect(result.days[0]!.slots).toEqual([slot("2026-03-29T00:00:00Z", "2026-03-29T02:00:00Z")]);
      expect(hours([person(1)], { ...spring, window: { start: "01:00", end: "04:00" }, durationMinutes: 150 }).days).toEqual([]);
    });

    it("spring: a window that ends in the missing hour ends at 03:xx", () => {
      const result = hours([person(1)], { ...spring, window: { start: "01:00", end: "02:30" }, durationMinutes: 30 });
      expect(result.days[0]!.slots).toEqual([slot("2026-03-29T00:00:00Z", "2026-03-29T01:30:00Z")]);
    });

    it("spring: a night window across the change is 7 hours, not 8", () => {
      const result = hours([person(1)], {
        from: date("2026-03-28"),
        to: date("2026-03-28"),
        now: spring.now,
        window: { start: "22:00", end: "06:00" },
        durationMinutes: 60,
      });
      expect(result.days).toEqual([{ date: "2026-03-28", slots: [slot("2026-03-28T21:00:00Z", "2026-03-29T04:00:00Z")] }]);
    });

    it("autumn: 09:00 to 23:00 is 14 hours", () => {
      const slots = hours([person(1)], autumn).days[0]!.slots;
      expect(slots).toEqual([slot("2026-10-25T08:00:00Z", "2026-10-25T22:00:00Z")]);
    });

    it("autumn: a window across the change is an hour longer than the clock says", () => {
      const result = hours([person(1)], { ...autumn, window: { start: "01:00", end: "04:00" }, durationMinutes: 60 });
      expect(result.days[0]!.slots).toEqual([slot("2026-10-24T23:00:00Z", "2026-10-25T03:00:00Z")]);
    });

    it("autumn: a busy time in the repeated hour blocks only its own real time", () => {
      const result = hours([person(1, busy("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"))], {
        ...autumn,
        window: { start: "01:00", end: "04:00" },
        durationMinutes: 30,
      });
      expect(result.days[0]!.slots).toEqual([
        slot("2026-10-24T23:00:00Z", "2026-10-25T00:30:00Z"),
        slot("2026-10-25T01:30:00Z", "2026-10-25T03:00:00Z"),
      ]);
    });

    it("walks over the change days without losing or doubling a day", () => {
      const result = hours([person(1)], { from: date("2026-10-23"), to: date("2026-10-27"), now: autumn.now });
      expect(result.days.map((d) => d.date)).toEqual(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
      const march = hours([person(1)], { from: date("2026-03-27"), to: date("2026-03-31"), now: spring.now });
      expect(march.days.map((d) => d.date)).toEqual(["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    });
  });

  describe("near misses", () => {
    it("names the one person who is missing", () => {
      const result = hours([
        person(1, busy("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z")),
        person(2),
        person(3),
      ]);
      expect(result.days[0]!.slots).toEqual([slot("2026-11-07T09:00:00Z", "2026-11-07T22:00:00Z")]);
      expect(result.nearMisses).toEqual([
        { date: "2026-11-07", missingPersonId: 1, slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] },
      ]);
    });

    it("reports a day with no slot for everybody", () => {
      const result = hours([person(1, busy("2026-11-07T07:00:00Z", "2026-11-07T23:00:00Z")), person(2), person(3)]);
      expect(result.days).toEqual([]);
      expect(result.nearMisses).toEqual([
        { date: "2026-11-07", missingPersonId: 1, slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] },
      ]);
    });

    it("leaves out somebody who is free anyway: the interval is inside the slot for everybody", () => {
      // Person 3 has nothing to do, so "everybody but 3" is exactly the slot for everybody.
      const result = hours([person(1, busy("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z")), person(2), person(3)]);
      expect(result.nearMisses.map((n) => n.missingPersonId)).toEqual([1]);
    });

    it("reports nothing when everybody is free the whole time", () => {
      expect(hours([person(1), person(2), person(3)]).nearMisses).toEqual([]);
    });

    it("keeps a near miss that only partly overlaps a slot for everybody", () => {
      const result = hours([
        person(1, busy("2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z")),
        person(2),
        person(3),
      ]);
      expect(result.days[0]!.slots).toHaveLength(2);
      expect(result.nearMisses).toEqual([
        { date: "2026-11-07", missingPersonId: 1, slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] },
      ]);
    });

    it("needs the interval to be long enough too", () => {
      // Without person 1 the others are free from 09:00 to 10:00 German time, one hour.
      const people = [
        person(1, busy("2026-11-07T07:00:00Z", "2026-11-07T23:00:00Z")),
        person(2, busy("2026-11-07T09:00:00Z", "2026-11-07T22:00:00Z")),
        person(3),
      ];
      expect(hours(people, { durationMinutes: 60 }).nearMisses).toEqual([
        { date: "2026-11-07", missingPersonId: 1, slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z")] },
      ]);
      expect(hours(people, { durationMinutes: 90 }).nearMisses).toEqual([]);
    });

    it("is not looked for with fewer than three people", () => {
      const result = hours([person(1, busy("2026-11-07T07:00:00Z", "2026-11-07T23:00:00Z")), person(2)]);
      expect(result.days).toEqual([]);
      expect(result.nearMisses).toEqual([]);
      expect(hours([person(1, busy("2026-11-07T07:00:00Z", "2026-11-07T23:00:00Z"))]).nearMisses).toEqual([]);
    });

    it("lists by date, then in the order the people were given", () => {
      // People are given as 2, 1, 3. On the 6th person 1 and person 2 each leave a gap for the others.
      const result = hours(
        [
          person(2, busy("2026-11-06T20:00:00Z", "2026-11-06T22:00:00Z")),
          person(1, busy("2026-11-06T08:00:00Z", "2026-11-06T10:00:00Z"), busy("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")),
          person(3),
        ],
        { from: date("2026-11-06"), to: date("2026-11-07") },
      );
      expect(result.nearMisses.map((n) => [n.date, n.missingPersonId])).toEqual([
        ["2026-11-06", 2],
        ["2026-11-06", 1],
        ["2026-11-07", 1],
      ]);
    });

    it("also applies the buffer", () => {
      const result = hours(
        [person(1, busy("2026-11-07T09:00:00Z", "2026-11-07T09:30:00Z")), person(2), person(3)],
        { bufferMinutes: 60, window: { start: "09:00", end: "11:00" } },
      );
      // Busy 10:00-10:30 German time plus an hour on each side: 09:00-11:30, nothing is left for person 1.
      expect(result.days).toEqual([]);
      expect(result.nearMisses.map((n) => n.missingPersonId)).toEqual([1]);
    });
  });
});

/** Days mode, German winter time. 2026-11-01 is a Sunday; `now` is that day, so the first candidate is Nov 2. */
function days(
  people: SearchPersonInput[],
  from: string,
  to: string,
  periodDays: number,
  options: { startWeekday?: Weekday; now?: string } = {},
) {
  return searchDays({
    people,
    from: date(from),
    to: date(to),
    days: periodDays,
    startWeekday: options.startWeekday,
    now: ms(options.now ?? "2026-11-01T10:00:00Z"),
  });
}

describe("searchDays", () => {
  it("finds a run of exactly the asked length", () => {
    const result = days([person(1, allDay("2026-11-05"))], "2026-11-02", "2026-11-04", 3);
    expect(result.stretches).toEqual([{ first: "2026-11-02", last: "2026-11-04", days: 3 }]);
  });

  it("drops a run that is a day too short", () => {
    expect(days([person(1, allDay("2026-11-05"))], "2026-11-02", "2026-11-08", 4).stretches).toEqual([]);
  });

  it("reports several runs, merged and in order", () => {
    const result = days([person(1, allDay("2026-11-05"))], "2026-11-02", "2026-11-08", 3);
    expect(result.stretches).toEqual([
      { first: "2026-11-02", last: "2026-11-04", days: 3 },
      { first: "2026-11-06", last: "2026-11-08", days: 3 },
    ]);
  });

  it("merges a long free time into one stretch", () => {
    const result = days([person(1), person(2)], "2026-11-02", "2026-11-15", 7);
    expect(result.stretches).toEqual([{ first: "2026-11-02", last: "2026-11-15", days: 14 }]);
  });

  it("uses the days that are free for everybody", () => {
    const result = days([person(1, allDay("2026-11-03")), person(2, allDay("2026-11-06"))], "2026-11-02", "2026-11-09", 2);
    expect(result.stretches).toEqual([
      { first: "2026-11-04", last: "2026-11-05", days: 2 },
      { first: "2026-11-07", last: "2026-11-09", days: 3 },
    ]);
  });

  it("never offers today", () => {
    const result = days([person(1)], "2026-11-01", "2026-11-03", 1);
    expect(result.stretches).toEqual([{ first: "2026-11-02", last: "2026-11-03", days: 2 }]);
  });

  it("counts today in German time: just after midnight there it is the next day that is excluded", () => {
    // 2026-11-01T23:30Z is 00:30 on Nov 2 in Germany, so the first candidate is Nov 3.
    const result = days([person(1)], "2026-11-01", "2026-11-05", 1, { now: "2026-11-01T23:30:00Z" });
    expect(result.stretches).toEqual([{ first: "2026-11-03", last: "2026-11-05", days: 3 }]);
  });

  it("finds nothing when the range ends before tomorrow", () => {
    expect(days([person(1)], "2026-11-01", "2026-11-01", 1).stretches).toEqual([]);
  });

  it("never goes past the last day of the range", () => {
    expect(days([person(1)], "2026-11-02", "2026-11-04", 5).stretches).toEqual([]);
    expect(days([person(1)], "2026-11-02", "2026-11-05", 4).stretches).toEqual([
      { first: "2026-11-02", last: "2026-11-05", days: 4 },
    ]);
  });

  it("lets an event on a day block it, however short", () => {
    const result = days([person(1, busy("2026-11-04T10:00:00Z", "2026-11-04T10:15:00Z"))], "2026-11-02", "2026-11-06", 1);
    expect(result.stretches).toEqual([
      { first: "2026-11-02", last: "2026-11-03", days: 2 },
      { first: "2026-11-05", last: "2026-11-06", days: 2 },
    ]);
  });

  it("does not let an event that ends exactly at midnight block the next day", () => {
    // Busy until 00:00 German time on Nov 6 (= 23:00 UTC on Nov 5).
    const result = days([person(1, busy("2026-11-05T10:00:00Z", "2026-11-05T23:00:00Z"))], "2026-11-04", "2026-11-08", 1);
    expect(result.stretches).toEqual([
      { first: "2026-11-04", last: "2026-11-04", days: 1 },
      { first: "2026-11-06", last: "2026-11-08", days: 3 },
    ]);
  });

  it("does not let an event that starts exactly at midnight block the day before", () => {
    const result = days([person(1, busy("2026-11-05T23:00:00Z", "2026-11-06T10:00:00Z"))], "2026-11-04", "2026-11-08", 1);
    expect(result.stretches).toEqual([
      { first: "2026-11-04", last: "2026-11-05", days: 2 },
      { first: "2026-11-07", last: "2026-11-08", days: 2 },
    ]);
  });

  it("lets an event after 23:00 UTC count for the German next day", () => {
    // 23:30 UTC on Nov 5 is 00:30 on Nov 6 in Germany.
    const result = days([person(1, busy("2026-11-05T23:30:00Z", "2026-11-05T23:45:00Z"))], "2026-11-04", "2026-11-08", 1);
    expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-11-04", "2026-11-05"], ["2026-11-07", "2026-11-08"]]);
  });

  it("ignores an event without length", () => {
    const result = days([person(1, busy("2026-11-04T10:00:00Z", "2026-11-04T10:00:00Z"))], "2026-11-02", "2026-11-06", 5);
    expect(result.stretches).toEqual([{ first: "2026-11-02", last: "2026-11-06", days: 5 }]);
  });

  it("lets all-day events block every day they cover", () => {
    const result = days([person(1, allDay("2026-11-04", "2026-11-06"))], "2026-11-02", "2026-11-09", 2);
    expect(result.stretches).toEqual([
      { first: "2026-11-02", last: "2026-11-03", days: 2 },
      { first: "2026-11-07", last: "2026-11-09", days: 3 },
    ]);
  });

  it("lets an event over several days block them all", () => {
    const result = days([person(1, busy("2026-11-03T12:00:00Z", "2026-11-06T12:00:00Z"))], "2026-11-02", "2026-11-08", 1);
    expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-11-02", "2026-11-02"], ["2026-11-07", "2026-11-08"]]);
  });

  it("has no buffer", () => {
    const result = days([person(1, busy("2026-11-03T22:00:00Z", "2026-11-03T22:30:00Z"))], "2026-11-02", "2026-11-05", 1);
    // 23:00-23:30 German time on Nov 3 blocks Nov 3 only.
    expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-11-02", "2026-11-02"], ["2026-11-04", "2026-11-05"]]);
  });

  describe("start weekday", () => {
    it("lists the days on which a whole period can start", () => {
      // Nov 2 is a Monday, so Saturdays are Nov 7 and Nov 14.
      const result = days([person(1)], "2026-11-02", "2026-11-16", 3, { startWeekday: 6 });
      expect(result.stretches).toEqual([
        { first: "2026-11-02", last: "2026-11-16", days: 15, starts: ["2026-11-07", "2026-11-14"] },
      ]);
    });

    it("leaves out a start from which the period would go past the end of the run", () => {
      const result = days([person(1)], "2026-11-02", "2026-11-15", 3, { startWeekday: 6 });
      expect(result.stretches).toEqual([{ first: "2026-11-02", last: "2026-11-15", days: 14, starts: ["2026-11-07"] }]);
    });

    it("leaves out a run in which no day with that weekday leaves room for the period", () => {
      expect(days([person(1)], "2026-11-02", "2026-11-06", 2, { startWeekday: 7 }).stretches).toEqual([]);
      expect(days([person(1)], "2026-11-02", "2026-11-08", 2, { startWeekday: 7 }).stretches).toEqual([]);
      expect(days([person(1)], "2026-11-02", "2026-11-09", 2, { startWeekday: 7 }).stretches).toEqual([
        { first: "2026-11-02", last: "2026-11-09", days: 8, starts: ["2026-11-08"] },
      ]);
    });

    it("is judged per run, not for the whole range", () => {
      // Runs Nov 2-5 (no Saturday) and Nov 7-16 (Saturdays Nov 7 and 14).
      const result = days([person(1, allDay("2026-11-06"))], "2026-11-02", "2026-11-16", 3, { startWeekday: 6 });
      expect(result.stretches).toEqual([
        { first: "2026-11-07", last: "2026-11-16", days: 10, starts: ["2026-11-07", "2026-11-14"] },
      ]);
    });

    it("needs room for the period, not only the right weekday", () => {
      // The run Nov 7-8 starts on a Saturday but is two days long.
      const result = days([person(1, allDay("2026-11-09"))], "2026-11-07", "2026-11-12", 3, { startWeekday: 6 });
      expect(result.stretches).toEqual([]);
    });

    it("does not put starts on a search without a weekday", () => {
      const result = days([person(1)], "2026-11-02", "2026-11-08", 3);
      expect(result.stretches[0]).not.toHaveProperty("starts");
    });
  });

  describe("daylight saving time", () => {
    it("autumn: the 25 hour day is one day and blocks only itself", () => {
      // All-day event on Oct 25: from 00:00 CEST (22:00 UTC) to 00:00 CET the next day (23:00 UTC).
      const result = days([person(1, { start: ms("2026-10-24T22:00:00Z"), end: ms("2026-10-25T23:00:00Z") })], "2026-10-23", "2026-10-28", 1, {
        now: "2026-10-20T10:00:00Z",
      });
      expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-10-23", "2026-10-24"], ["2026-10-26", "2026-10-28"]]);
    });

    it("autumn: an event in the repeated hour blocks that day only", () => {
      const result = days([person(1, busy("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"))], "2026-10-24", "2026-10-26", 1, {
        now: "2026-10-20T10:00:00Z",
      });
      expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-10-24", "2026-10-24"], ["2026-10-26", "2026-10-26"]]);
    });

    it("autumn: an event from 23:00 UTC on the 25th belongs to the 26th", () => {
      const result = days([person(1, busy("2026-10-25T23:00:00Z", "2026-10-25T23:30:00Z"))], "2026-10-24", "2026-10-27", 1, {
        now: "2026-10-20T10:00:00Z",
      });
      expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-10-24", "2026-10-25"], ["2026-10-27", "2026-10-27"]]);
    });

    it("spring: the 23 hour day is one day and blocks only itself", () => {
      // All-day event on Mar 29: 00:00 CET (23:00 UTC on the 28th) to 00:00 CEST (22:00 UTC on the 29th).
      const result = days([person(1, { start: ms("2026-03-28T23:00:00Z"), end: ms("2026-03-29T22:00:00Z") })], "2026-03-27", "2026-04-01", 1, {
        now: "2026-03-25T10:00:00Z",
      });
      expect(result.stretches.map((s) => [s.first, s.last])).toEqual([["2026-03-27", "2026-03-28"], ["2026-03-30", "2026-04-01"]]);
    });

    it("spring: counts every calendar day once over the change", () => {
      const result = days([person(1)], "2026-03-26", "2026-04-02", 8, { now: "2026-03-25T10:00:00Z" });
      expect(result.stretches).toEqual([{ first: "2026-03-26", last: "2026-04-02", days: 8 }]);
    });
  });

  describe("near misses", () => {
    it("names the person whose busy days are the only thing in the way", () => {
      const result = days([person(1), person(2, allDay("2026-11-04")), person(3)], "2026-11-02", "2026-11-08", 3);
      expect(result.stretches).toEqual([{ first: "2026-11-05", last: "2026-11-08", days: 4 }]);
      expect(result.nearMisses).toEqual([{ first: "2026-11-02", last: "2026-11-08", days: 7, missingPersonId: 2 }]);
    });

    it("leaves out a run that lies inside a stretch for everybody", () => {
      // Persons 1 and 3 are free all the time; "everybody but 1" is the stretch for everybody.
      const result = days([person(1), person(2), person(3)], "2026-11-02", "2026-11-08", 3);
      expect(result.stretches).toHaveLength(1);
      expect(result.nearMisses).toEqual([]);
    });

    it("keeps a run that is longer than the stretch for everybody", () => {
      const result = days([person(1, allDay("2026-11-02")), person(2), person(3)], "2026-11-02", "2026-11-08", 3);
      expect(result.stretches).toEqual([{ first: "2026-11-03", last: "2026-11-08", days: 6 }]);
      expect(result.nearMisses).toEqual([{ first: "2026-11-02", last: "2026-11-08", days: 7, missingPersonId: 1 }]);
    });

    it("also reports when nobody is free together", () => {
      const result = days([person(1, allDay("2026-11-02", "2026-11-08")), person(2), person(3)], "2026-11-02", "2026-11-08", 3);
      expect(result.stretches).toEqual([]);
      expect(result.nearMisses).toEqual([{ first: "2026-11-02", last: "2026-11-08", days: 7, missingPersonId: 1 }]);
    });

    it("needs two people to be in the way on no day", () => {
      // Person 2 is busy on the 4th, person 3 on the 6th: nobody can be left out to save the stretch.
      const result = days([person(1), person(2, allDay("2026-11-04")), person(3, allDay("2026-11-06"))], "2026-11-02", "2026-11-08", 2);
      expect(result.nearMisses.map((n) => [n.missingPersonId, n.first, n.last])).toEqual([
        [2, "2026-11-02", "2026-11-05"],
        [3, "2026-11-05", "2026-11-08"],
      ]);
    });

    it("is not looked for with fewer than three people", () => {
      const result = days([person(1, allDay("2026-11-02", "2026-11-08")), person(2)], "2026-11-02", "2026-11-08", 3);
      expect(result.nearMisses).toEqual([]);
    });

    it("lists by first day, whatever the order of the people", () => {
      // Given as 1, 3, 2. Without 3 (busy on the 4th) the run starts on the 2nd, without 1 (busy on the 7th)
      // on the 5th; the days around them are free for everybody and are no near misses.
      const result = days(
        [person(1, allDay("2026-11-07")), person(3, allDay("2026-11-04")), person(2)],
        "2026-11-02",
        "2026-11-09",
        2,
      );
      expect(result.nearMisses.map((n) => [n.missingPersonId, n.first, n.last])).toEqual([
        [3, "2026-11-02", "2026-11-06"],
        [1, "2026-11-05", "2026-11-09"],
      ]);
    });

    it("works out the starts of a near miss like those of a stretch", () => {
      // Person 1 is busy on Monday the 9th. Without them Saturdays the 7th and 14th are possible starts.
      const result = days([person(1, allDay("2026-11-09")), person(2), person(3)], "2026-11-02", "2026-11-16", 3, {
        startWeekday: 6,
      });
      expect(result.stretches).toEqual([{ first: "2026-11-10", last: "2026-11-16", days: 7, starts: ["2026-11-14"] }]);
      expect(result.nearMisses).toEqual([
        { first: "2026-11-02", last: "2026-11-16", days: 15, starts: ["2026-11-07", "2026-11-14"], missingPersonId: 1 },
      ]);
    });
  });
});
