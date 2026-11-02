import { describe, expect, it } from "vitest";
import { buildReminderIcs, isServerNight, nextWakeTime } from "./reminder";

const at = (h: number, m = 0): Date => new Date(2026, 10, 3, h, m);

describe("reminder", () => {
  it("knows the night of the sleeping server", () => {
    expect(isServerNight(at(0, 59))).toBe(false);
    expect(isServerNight(at(1))).toBe(true);
    expect(isServerNight(at(6, 59))).toBe(true);
    expect(isServerNight(at(7))).toBe(false);
  });

  it("picks 07:00 of today before 07:00 and of tomorrow after it", () => {
    expect(nextWakeTime(at(2))).toEqual(new Date(2026, 10, 3, 7));
    expect(nextWakeTime(at(7))).toEqual(new Date(2026, 10, 4, 7));
    expect(nextWakeTime(new Date(2026, 11, 31, 23))).toEqual(new Date(2027, 0, 1, 7));
  });

  it("builds a calendar entry at 07:00 with the link and an alarm", () => {
    const ics = buildReminderIcs("https://x.example/#/abstimmung/tok", "Grillen, oder?", at(3));
    expect(ics).toContain("DTSTART:20261103T070000\r\n");
    expect(ics).toContain("DTEND:20261103T071500\r\n");
    expect(ics).toContain("URL:https://x.example/#/abstimmung/tok\r\n");
    expect(ics).toContain("SUMMARY:Abstimmen: Grillen\\, oder?\r\n");
    expect(ics).toContain("TRIGGER:PT0S");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds long lines at 75 characters", () => {
    const ics = buildReminderIcs(`https://x.example/#/abstimmung/${"a".repeat(120)}`, "T", at(3));
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });
});
