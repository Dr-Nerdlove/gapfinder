import type { PreviewEvent } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { dayHeading, groupPreviewByDay, NO_TITLE, previewDays, problemNotices } from "./preview";

let nextId = 1;
function event(start: string, end: string, extra: Partial<PreviewEvent> = {}): PreviewEvent {
  return { calendarId: 1, title: `Termin ${nextId++}`, start, end, allDay: false, countsAsBusy: true, ...extra };
}

/** Compact view: "key | timeLabel title" per entry. */
function lines(events: PreviewEvent[], range = {}): string[] {
  return groupPreviewByDay(events, range).flatMap((day) => day.entries.map((e) => `${day.key} | ${e.timeLabel} ${e.title}`));
}

describe("dayHeading", () => {
  it("writes weekday, day and month without leading zeros", () => {
    expect(dayHeading(2026, 11, 2)).toBe("Mo, 2.11.");
    expect(dayHeading(2026, 12, 31)).toBe("Do, 31.12.");
    expect(dayHeading(2026, 11, 1)).toBe("So, 1.11.");
    expect(dayHeading(2027, 3, 28)).toBe("So, 28.3.");
  });
});

describe("groupPreviewByDay", () => {
  it("gives nothing for no events", () => {
    expect(groupPreviewByDay([])).toEqual([]);
  });

  it("shows a timed event with start and end in German time", () => {
    // 08:00-09:30 UTC in November is 09:00-10:30 in Berlin.
    const days = groupPreviewByDay([event("2026-11-02T08:00:00Z", "2026-11-02T09:30:00Z", { title: "Zahnarzt" })]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ key: "2026-11-02", heading: "Mo, 2.11." });
    expect(days[0]!.entries).toEqual([
      expect.objectContaining({ title: "Zahnarzt", kind: "within", timeLabel: "09:00–10:30", calendarId: 1, countsAsBusy: true }),
    ]);
  });

  it("uses summer time in summer", () => {
    expect(lines([event("2026-07-01T07:00:00Z", "2026-07-01T08:00:00Z", { title: "A" })])).toEqual(["2026-07-01 | 09:00–10:00 A"]);
  });

  it("puts a late evening event on the German day, not the UTC day", () => {
    // 23:30 UTC in winter is 00:30 the next day in Berlin.
    expect(lines([event("2026-11-02T23:30:00Z", "2026-11-03T00:15:00Z", { title: "Spät" })])).toEqual(["2026-11-03 | 00:30–01:15 Spät"]);
  });

  it("sorts days and, within a day, all-day entries first and then by time", () => {
    const events = [
      event("2026-11-03T10:00:00Z", "2026-11-03T11:00:00Z", { title: "Später" }),
      event("2026-11-03T08:00:00Z", "2026-11-03T09:00:00Z", { title: "Früher" }),
      event("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", { title: "Tag davor" }),
      event("2026-11-02T23:00:00Z", "2026-11-03T23:00:00Z", { title: "Ganz", allDay: true }),
    ];
    expect(lines(events)).toEqual([
      "2026-11-02 | 09:00–10:00 Tag davor",
      "2026-11-03 | ganztägig Ganz",
      "2026-11-03 | 09:00–10:00 Früher",
      "2026-11-03 | 11:00–12:00 Später",
    ]);
  });

  it("keeps the calendar of each entry", () => {
    const days = groupPreviewByDay([
      event("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", { calendarId: 7, title: "X" }),
      event("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", { calendarId: 3, title: "Y" }),
    ]);
    expect(days[0]!.entries.map((e) => [e.calendarId, e.title])).toEqual([
      [3, "Y"],
      [7, "X"],
    ]);
  });

  it("shows a single all-day event as ganztägig on its day only", () => {
    // All-day on 4 Nov: 00:00 Berlin (23:00 UTC the day before) to 00:00 Berlin the day after.
    expect(lines([event("2026-11-03T23:00:00Z", "2026-11-04T23:00:00Z", { allDay: true, title: "Geburtstag" })])).toEqual([
      "2026-11-04 | ganztägig Geburtstag",
    ]);
  });

  it("shows a multi-day all-day event on every day it covers", () => {
    expect(lines([event("2026-11-03T23:00:00Z", "2026-11-06T23:00:00Z", { allDay: true, title: "Urlaub" })])).toEqual([
      "2026-11-04 | ganztägig Urlaub",
      "2026-11-05 | ganztägig Urlaub",
      "2026-11-06 | ganztägig Urlaub",
    ]);
  });

  it("cuts a timed event over several days: ab, ganztägig, bis", () => {
    const result = groupPreviewByDay([event("2026-11-02T17:00:00Z", "2026-11-05T09:00:00Z", { title: "Reise" })]);
    expect(result.map((d) => [d.key, d.entries[0]!.kind, d.entries[0]!.timeLabel])).toEqual([
      ["2026-11-02", "from", "ab 18:00"],
      ["2026-11-03", "whole", "ganztägig"],
      ["2026-11-04", "whole", "ganztägig"],
      ["2026-11-05", "until", "bis 10:00"],
    ]);
  });

  it("shows an overnight event on both days", () => {
    expect(lines([event("2026-11-02T21:00:00Z", "2026-11-03T06:00:00Z", { title: "Nachtschicht" })])).toEqual([
      "2026-11-02 | ab 22:00 Nachtschicht",
      "2026-11-03 | bis 07:00 Nachtschicht",
    ]);
  });

  it("does not touch the next day when an event ends exactly at midnight", () => {
    // 22:00-00:00 Berlin.
    expect(lines([event("2026-11-02T21:00:00Z", "2026-11-02T23:00:00Z", { title: "Bis Mitternacht" })])).toEqual([
      "2026-11-02 | 22:00–00:00 Bis Mitternacht",
    ]);
  });

  it("calls a timed event that fills a whole day ganztägig", () => {
    const [day] = groupPreviewByDay([event("2026-11-01T23:00:00Z", "2026-11-02T23:00:00Z", { title: "Ganztags" })]);
    expect(day!.entries[0]).toMatchObject({ kind: "whole", timeLabel: "ganztägig" });
  });

  it("shows an event without length with its start time only", () => {
    expect(lines([event("2026-11-02T08:00:00Z", "2026-11-02T08:00:00Z", { title: "Erinnerung" })])).toEqual([
      "2026-11-02 | 09:00 Erinnerung",
    ]);
  });

  it("ignores events with unreadable dates", () => {
    expect(groupPreviewByDay([event("kaputt", "2026-11-02T08:00:00Z")])).toEqual([]);
  });

  it("names an empty title (even only spaces)", () => {
    const days = groupPreviewByDay([
      event("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", { title: "" }),
      event("2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z", { title: "   " }),
    ]);
    expect(days[0]!.entries.map((e) => e.title)).toEqual([NO_TITLE, NO_TITLE]);
    expect(NO_TITLE).toBe("(ohne Titel)");
  });

  it("passes on whether an event counts as busy", () => {
    const [day] = groupPreviewByDay([
      event("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", { title: "Frei", countsAsBusy: false }),
      event("2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z", { title: "Belegt", countsAsBusy: true }),
    ]);
    expect(day!.entries.map((e) => [e.title, e.countsAsBusy])).toEqual([
      ["Frei", false],
      ["Belegt", true],
    ]);
  });

  describe("clock changes", () => {
    it("handles the autumn day with 25 hours (2026-10-25)", () => {
      // 00:00 Berlin on the 25th (22:00 UTC the day before) until 00:00 on the 26th (23:00 UTC) is 25 hours.
      const longDay = event("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z", { title: "Ganztags", allDay: true });
      expect(lines([longDay])).toEqual(["2026-10-25 | ganztägig Ganztags"]);
      // The same as a timed event: still exactly one day.
      const timed = event("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z", { title: "Zeit" });
      expect(lines([timed])).toEqual(["2026-10-25 | ganztägig Zeit"]);
    });

    it("keeps times right across the autumn change", () => {
      // 02:30 CEST (00:30 UTC) until 03:00 CET (02:00 UTC), 1.5 hours later in real time.
      expect(lines([event("2026-10-25T00:30:00Z", "2026-10-25T02:00:00Z", { title: "Nacht" })])).toEqual(["2026-10-25 | 02:30–03:00 Nacht"]);
      // 22:00 UTC on the 25th is 23:00 CET.
      expect(lines([event("2026-10-25T22:00:00Z", "2026-10-26T00:30:00Z", { title: "Abend" })])).toEqual([
        "2026-10-25 | ab 23:00 Abend",
        "2026-10-26 | bis 01:30 Abend",
      ]);
    });

    it("lets an all-day event run over the autumn change", () => {
      const days = groupPreviewByDay([event("2026-10-23T22:00:00Z", "2026-10-26T23:00:00Z", { title: "Wochenende", allDay: true })]);
      expect(days.map((d) => d.key)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    });

    it("handles the spring day with 23 hours (2027-03-28)", () => {
      // 00:00 CET on the 28th (23:00 UTC on the 27th) until 00:00 CEST on the 29th (22:00 UTC on the 28th).
      const shortDay = event("2027-03-27T23:00:00Z", "2027-03-28T22:00:00Z", { title: "Kurz", allDay: true });
      expect(lines([shortDay])).toEqual(["2027-03-28 | ganztägig Kurz"]);
      const timed = event("2027-03-27T23:00:00Z", "2027-03-28T22:00:00Z", { title: "Zeit" });
      expect(lines([timed])).toEqual(["2027-03-28 | ganztägig Zeit"]);
    });

    it("keeps times right across the spring change", () => {
      // 01:30 CET (00:30 UTC) until 03:30 CEST (01:30 UTC): one hour of real time, two on the clock.
      expect(lines([event("2027-03-28T00:30:00Z", "2027-03-28T01:30:00Z", { title: "Sprung" })])).toEqual(["2027-03-28 | 01:30–03:30 Sprung"]);
      expect(lines([event("2027-03-28T22:00:00Z", "2027-03-29T07:00:00Z", { title: "Montag" })])).toEqual([
        "2027-03-29 | 00:00–09:00 Montag",
      ]);
    });

    it("lets a multi-day event run over the spring change", () => {
      const days = groupPreviewByDay([event("2027-03-27T17:00:00Z", "2027-03-29T08:00:00Z", { title: "Reise" })]);
      expect(days.map((d) => [d.key, d.entries[0]!.timeLabel])).toEqual([
        ["2027-03-27", "ab 18:00"],
        ["2027-03-28", "ganztägig"],
        ["2027-03-29", "bis 10:00"],
      ]);
    });

    it("lets an all-day event run over the spring change", () => {
      const days = groupPreviewByDay([event("2027-03-26T23:00:00Z", "2027-03-29T22:00:00Z", { title: "Urlaub", allDay: true })]);
      expect(days.map((d) => d.key)).toEqual(["2027-03-27", "2027-03-28", "2027-03-29"]);
    });
  });

  describe("range", () => {
    const range = { from: "2026-11-02T10:00:00Z", to: "2026-11-04T23:00:00Z" };

    it("leaves out days before the start and after the end of the range", () => {
      // 1 Nov to 7 Nov, all-day.
      const long = event("2026-10-31T23:00:00Z", "2026-11-07T23:00:00Z", { allDay: true, title: "Lang" });
      expect(groupPreviewByDay([long], range).map((d) => d.key)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    });

    it("cuts an event that started before the range to the days in it", () => {
      const running = event("2026-10-30T09:00:00Z", "2026-11-03T09:00:00Z", { title: "Läuft" });
      expect(lines([running], range)).toEqual(["2026-11-02 | ganztägig Läuft", "2026-11-03 | bis 10:00 Läuft"]);
    });

    it("keeps today even when the range starts in the middle of it", () => {
      expect(lines([event("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z", { title: "Heute" })], range)).toEqual(["2026-11-02 | 09:00–10:00 Heute"]);
    });
  });
});

describe("previewDays", () => {
  it("uses the range of the answer", () => {
    const days = previewDays({
      from: "2026-11-02T10:00:00Z",
      to: "2026-11-03T23:00:00Z",
      events: [event("2026-10-30T23:00:00Z", "2026-11-10T23:00:00Z", { allDay: true })],
    });
    expect(days.map((d) => d.key)).toEqual(["2026-11-02", "2026-11-03"]);
  });
});

describe("problemNotices", () => {
  const calendars = [
    { id: 1, name: "Arbeit" },
    { id: 2, name: "Privat" },
  ];

  it("says which calendar could not be read", () => {
    const [notice] = problemNotices([{ calendarId: 1, problem: "unreachable" }], calendars);
    expect(notice).toMatchObject({ calendarId: 1, name: "Arbeit", problem: "unreachable", text: "„Arbeit“ konnte gerade nicht gelesen werden." });
  });

  it("says when a link no longer works", () => {
    const [notice] = problemNotices([{ calendarId: 2, problem: "broken" }], calendars);
    expect(notice).toMatchObject({ problem: "broken", text: "Der Link von „Privat“ funktioniert nicht mehr." });
  });

  it("copes with a calendar that is not in the list", () => {
    const [notice] = problemNotices([{ calendarId: 99, problem: "unreachable" }], calendars);
    expect(notice!.text).toBe("„Ein Kalender“ konnte gerade nicht gelesen werden.");
  });

  it("gives nothing for no problems", () => {
    expect(problemNotices([], calendars)).toEqual([]);
  });
});
