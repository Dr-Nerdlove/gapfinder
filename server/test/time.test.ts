import { describe, expect, it } from "vitest";
import { berlinMidnight } from "../src/time.js";

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
