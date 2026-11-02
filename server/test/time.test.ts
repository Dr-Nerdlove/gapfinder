import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  berlinDateOf,
  berlinMidnight,
  berlinWallToUtc,
  dayNumber,
  formatDateParts,
  isoWeekday,
  parseDateParts,
} from "../src/time.js";

const iso = (date: Date) => date.toISOString();

describe("berlinMidnight", () => {
  it.each([
    // [now (UTC), plusDays, 00:00 German time as UTC]
    ["2026-11-01T10:00:00Z", 0, "2026-10-31T23:00:00.000Z"], // winter time, UTC+1
    ["2026-07-01T10:00:00Z", 0, "2026-06-30T22:00:00.000Z"], // summer time, UTC+2
    ["2026-06-30T22:30:00Z", 0, "2026-06-30T22:00:00.000Z"], // already July 1st in Germany
    ["2026-06-30T21:30:00Z", 0, "2026-06-29T22:00:00.000Z"], // still June 30th in Germany
    ["2026-11-01T23:30:00Z", 0, "2026-11-01T23:00:00.000Z"], // already November 2nd in Germany
    ["2027-03-20T10:00:00Z", 28, "2027-04-16T22:00:00.000Z"], // across the change to summer time
    ["2027-03-28T10:00:00Z", 0, "2027-03-27T23:00:00.000Z"], // the day of the change (23 hours long)
    ["2027-03-28T10:00:00Z", 1, "2027-03-28T22:00:00.000Z"],
    ["2026-10-25T10:00:00Z", 0, "2026-10-24T22:00:00.000Z"], // change back to winter time (25 hours long)
    ["2026-10-25T10:00:00Z", 1, "2026-10-25T23:00:00.000Z"],
    ["2026-12-20T10:00:00Z", 28, "2027-01-16T23:00:00.000Z"], // over the new year
  ])("%s + %i days → %s", (now, plusDays, expected) => {
    expect(iso(berlinMidnight(new Date(now), plusDays))).toBe(expected);
  });
});

describe("berlinWallToUtc", () => {
  const wall = (year: number, month: number, day: number, hour: number, minute = 0) =>
    iso(berlinWallToUtc(year, month, day, hour * 60 + minute));

  it.each([
    ["winter, UTC+1", 2026, 11, 7, 9, 0, "2026-11-07T08:00:00.000Z"],
    ["summer, UTC+2", 2026, 7, 7, 9, 0, "2026-07-07T07:00:00.000Z"],
    ["midnight", 2026, 11, 7, 0, 0, "2026-11-06T23:00:00.000Z"],
    // Spring: clocks jump from 02:00 to 03:00 on 2026-03-29 (01:00 UTC).
    ["spring, just before the change", 2026, 3, 29, 1, 59, "2026-03-29T00:59:00.000Z"],
    ["spring, a time that does not exist: 02:00", 2026, 3, 29, 2, 0, "2026-03-29T01:00:00.000Z"],
    ["spring, a time that does not exist: 02:30", 2026, 3, 29, 2, 30, "2026-03-29T01:30:00.000Z"],
    ["spring, 02:59", 2026, 3, 29, 2, 59, "2026-03-29T01:59:00.000Z"],
    ["spring, first time after the gap", 2026, 3, 29, 3, 0, "2026-03-29T01:00:00.000Z"],
    ["spring, morning after the change", 2026, 3, 29, 9, 0, "2026-03-29T07:00:00.000Z"],
    ["spring, midnight of the day of the change", 2026, 3, 29, 0, 0, "2026-03-28T23:00:00.000Z"],
    ["spring, midnight after the day of the change", 2026, 3, 30, 0, 0, "2026-03-29T22:00:00.000Z"],
    // Autumn: clocks go back from 03:00 to 02:00 on 2026-10-25 (01:00 UTC), so 02:xx exists twice.
    ["autumn, just before the change", 2026, 10, 25, 1, 59, "2026-10-24T23:59:00.000Z"],
    ["autumn, a time that exists twice: 02:00 is the earlier one", 2026, 10, 25, 2, 0, "2026-10-25T00:00:00.000Z"],
    ["autumn, a time that exists twice: 02:30 is the earlier one", 2026, 10, 25, 2, 30, "2026-10-25T00:30:00.000Z"],
    ["autumn, 03:00 is already winter time", 2026, 10, 25, 3, 0, "2026-10-25T02:00:00.000Z"],
    ["autumn, morning after the change", 2026, 10, 25, 9, 0, "2026-10-25T08:00:00.000Z"],
    ["autumn, midnight of the day of the change", 2026, 10, 25, 0, 0, "2026-10-24T22:00:00.000Z"],
    ["autumn, midnight after the day of the change", 2026, 10, 26, 0, 0, "2026-10-25T23:00:00.000Z"],
  ])("%s", (_name, year, month, day, hour, minute, expected) => {
    expect(wall(year, month, day, hour, minute)).toBe(expected);
  });

  it("lets the minutes overflow into the next day", () => {
    expect(iso(berlinWallToUtc(2026, 11, 7, 1440))).toBe("2026-11-07T23:00:00.000Z"); // 00:00 on Nov 8
    expect(iso(berlinWallToUtc(2026, 12, 31, 1440 + 120))).toBe("2027-01-01T01:00:00.000Z"); // 02:00 on Jan 1
    expect(iso(berlinWallToUtc(2026, 3, 28, 1440))).toBe("2026-03-28T23:00:00.000Z"); // up to the change day
    expect(iso(berlinWallToUtc(2026, 3, 28, 1440 + 150))).toBe("2026-03-29T01:30:00.000Z"); // 02:30 does not exist
    expect(iso(berlinWallToUtc(2026, 10, 24, 1440 + 150))).toBe("2026-10-25T00:30:00.000Z");
  });

  it("agrees with berlinMidnight", () => {
    for (const [year, month, day] of [[2026, 3, 29], [2026, 10, 25], [2026, 11, 7], [2027, 7, 1]] as const) {
      const midnight = berlinMidnight(new Date(Date.UTC(year, month - 1, day, 12)));
      expect(iso(berlinWallToUtc(year, month, day, 0))).toBe(iso(midnight));
    }
  });
});

describe("dates without a time zone", () => {
  it("parses real dates only", () => {
    expect(parseDateParts("2026-11-07")).toEqual({ year: 2026, month: 11, day: 7 });
    expect(parseDateParts("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
    for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-4-1", "26-04-01", "2026-04-01T00", ""]) {
      expect(parseDateParts(bad), bad).toBeNull();
    }
  });

  it("formats with leading zeros", () => {
    expect(formatDateParts({ year: 2026, month: 3, day: 9 })).toBe("2026-03-09");
  });

  it("adds days on the wall date, across months, years and the daylight saving days", () => {
    const add = (text: string, days: number) => formatDateParts(addDaysToDate(parseDateParts(text)!, days));
    expect(add("2026-11-30", 1)).toBe("2026-12-01");
    expect(add("2026-12-31", 1)).toBe("2027-01-01");
    expect(add("2026-03-01", -1)).toBe("2026-02-28");
    expect(add("2026-03-28", 1)).toBe("2026-03-29");
    expect(add("2026-03-29", 1)).toBe("2026-03-30");
    expect(add("2026-10-25", 1)).toBe("2026-10-26");
    expect(add("2026-10-24", 366)).toBe("2027-10-25");
  });

  it("numbers consecutive days consecutively", () => {
    const n = (text: string) => dayNumber(parseDateParts(text)!);
    expect(n("2026-03-30") - n("2026-03-29")).toBe(1);
    expect(n("2026-10-26") - n("2026-10-25")).toBe(1);
    expect(n("2027-01-01") - n("2026-01-01")).toBe(365);
  });

  it("tells the ISO weekday (1 = Monday … 7 = Sunday)", () => {
    const weekday = (text: string) => isoWeekday(parseDateParts(text)!);
    expect(weekday("2026-11-02")).toBe(1);
    expect(weekday("2026-11-07")).toBe(6);
    expect(weekday("2026-11-08")).toBe(7);
    expect(weekday("2026-03-29")).toBe(7);
  });

  it("tells the German calendar day of an instant", () => {
    const day = (text: string) => formatDateParts(berlinDateOf(new Date(text)));
    expect(day("2026-06-30T22:30:00Z")).toBe("2026-07-01");
    expect(day("2026-06-30T21:30:00Z")).toBe("2026-06-30");
    expect(day("2026-11-01T23:30:00Z")).toBe("2026-11-02");
    expect(day("2026-10-25T00:30:00Z")).toBe("2026-10-25");
  });
});
