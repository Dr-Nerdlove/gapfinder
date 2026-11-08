import type { PollCalendarCheck } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { ownCalendarHint, pollSkippedNotices } from "./poll-calendar";

const anna = { id: 2, username: "Anna", seedColor: null };
const me = { id: 1, username: "Vincent", seedColor: null };

const check = (mine: PollCalendarCheck["mine"], skipped: PollCalendarCheck["skipped"] = []): PollCalendarCheck => ({ skipped, mine });

describe("pollSkippedNotices", () => {
  const skipped: PollCalendarCheck["skipped"] = [
    { person: anna, reason: "no_calendar" },
    { person: me, reason: "unreadable" },
  ];

  it("uses the texts of the search, with Du for the viewer", () => {
    expect(pollSkippedNotices(check(null, skipped), 1)).toEqual([
      "Anna: kein Kalender verknüpft – nicht berücksichtigt",
      "Du: Kalender nicht lesbar – nicht berücksichtigt",
    ]);
  });

  it("names everybody for a guest and gives nothing when nobody is left out", () => {
    expect(pollSkippedNotices(check(null, skipped), null)[1]).toBe("Vincent: Kalender nicht lesbar – nicht berücksichtigt");
    expect(pollSkippedNotices(check(null), null)).toEqual([]);
  });
});

describe("ownCalendarHint", () => {
  const mine = check({ readable: true, busyProposalIds: [7] });

  it("says free or busy", () => {
    expect(ownCalendarHint(mine, 8)).toEqual({ tone: "free", text: "Laut deinem Kalender frei" });
    expect(ownCalendarHint(mine, 7, "maybe")).toEqual({ tone: "busy", text: "Laut deinem Kalender belegt" });
    expect(ownCalendarHint(mine, 7)).toEqual({ tone: "busy", text: "Laut deinem Kalender belegt" });
  });

  it("is a conflict when busy and the answer is Ja", () => {
    expect(ownCalendarHint(mine, 7, "yes")).toEqual({ tone: "conflict", text: "Laut deinem Kalender belegt – du hast „Ja“ gewählt" });
    expect(ownCalendarHint(mine, 8, "yes")?.tone).toBe("free");
  });

  it("says nothing for guests, unreadable calendars or no check", () => {
    expect(ownCalendarHint(check(null), 7)).toBeNull();
    expect(ownCalendarHint(check({ readable: false, reason: "no_calendar" }), 7)).toBeNull();
    expect(ownCalendarHint(null, 7)).toBeNull();
  });
});
