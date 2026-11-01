import { randomBytes } from "node:crypto";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { parseCalendar, type CalendarEvent } from "../src/calendars/ics.js";

const WIDE = { start: new Date("2025-01-01T00:00:00Z"), end: new Date("2029-01-01T00:00:00Z") };

/** Wraps VEVENTs (and anything else) into a VCALENDAR with LF line ends. */
function cal(body: string, header = ""): string {
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\n${header}${body}\nEND:VCALENDAR\n`;
}

const crlf = (text: string): string => text.replace(/\n/g, "\r\n");

interface Shown {
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
  title: string;
}

function shown(event: CalendarEvent): Shown {
  return {
    start: new Date(event.start).toISOString(),
    end: new Date(event.end).toISOString(),
    allDay: event.allDay,
    busy: event.busy,
    title: event.title,
  };
}

/** Parses and returns the events with readable times; fails when the text is not an iCalendar. */
function events(text: string, window = WIDE): Shown[] {
  const parsed = parseCalendar(text, window);
  expect(parsed).not.toBeNull();
  return parsed!.events.map(shown);
}

/** Start and end only: most tests care about nothing else. */
function ranges(text: string, window = WIDE): string[] {
  return events(text, window).map((e) => `${e.start} - ${e.end}`);
}

const DAY = 24 * 3600 * 1000;
const SHORT_WINDOW = { start: new Date("2026-02-01T00:00:00Z"), end: new Date("2026-03-01T00:00:00Z") };

describe("not an iCalendar", () => {
  it.each([
    ["empty", ""],
    ["plain text", "hello world"],
    ["HTML page", "<!doctype html><html><body>Not found</body></html>"],
    ["component never closed", "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:x\n"],
    ["no VCALENDAR", "BEGIN:VEVENT\nUID:x\nDTSTART:20260101T100000Z\nEND:VEVENT\n"],
    ["a line without a colon", "BEGIN:VCALENDAR\nthis is broken\nEND:VCALENDAR\n"],
  ])("%s gives null", (_name, text) => {
    expect(parseCalendar(text, WIDE)).toBeNull();
    expect(parseCalendar(crlf(text), WIDE)).toBeNull();
  });

  it("never throws, also not for a megabyte of random characters", () => {
    const noise = randomBytes(1024 * 1024).toString("latin1");
    expect(() => parseCalendar(noise, WIDE)).not.toThrow();
    expect(parseCalendar(noise, WIDE)).toBeNull();
    const noiseInside = `BEGIN:VCALENDAR\n${noise}\nEND:VCALENDAR\n`;
    expect(() => parseCalendar(noiseInside, WIDE)).not.toThrow();
  });

  it("an empty calendar is a calendar without events", () => {
    expect(parseCalendar("BEGIN:VCALENDAR\nEND:VCALENDAR\n", WIDE)).toEqual({ name: null, events: [], truncated: false });
  });

  it("skips a broken VEVENT and keeps the others", () => {
    const text = cal(
      "BEGIN:VEVENT\nUID:bad\nDTSTART:not-a-date\nEND:VEVENT\n" +
        "BEGIN:VEVENT\nUID:nostart\nSUMMARY:No start\nEND:VEVENT\n" +
        "BEGIN:VEVENT\nUID:ok\nDTSTART:20260115T100000Z\nDTEND:20260115T110000Z\nEND:VEVENT",
    );
    expect(ranges(text)).toEqual(["2026-01-15T10:00:00.000Z - 2026-01-15T11:00:00.000Z"]);
  });

  it("ignores a byte order mark in front", () => {
    expect(parseCalendar("﻿" + cal(""), WIDE)).not.toBeNull();
  });
});

describe("calendar name", () => {
  it("is trimmed", () => {
    expect(parseCalendar(cal("", "X-WR-CALNAME:  Familie  \n"), WIDE)?.name).toBe("Familie");
  });
  it("is cut to 100 characters", () => {
    expect(parseCalendar(cal("", `X-WR-CALNAME:${"n".repeat(150)}\n`), WIDE)?.name).toBe("n".repeat(100));
  });
  it("is null when missing or empty", () => {
    expect(parseCalendar(cal(""), WIDE)?.name).toBeNull();
    expect(parseCalendar(cal("", "X-WR-CALNAME:   \n"), WIDE)?.name).toBeNull();
  });
  it("understands escapes and folded lines", () => {
    const text = crlf(cal("", "X-WR-CALNAME:Anna\\, Ben \n  und Cleo\n"));
    expect(parseCalendar(text, WIDE)?.name).toBe("Anna, Ben  und Cleo");
  });
});

describe("time zones", () => {
  const event = (start: string, extra = "") =>
    cal(`BEGIN:VEVENT\nUID:e\nDTSTART${start}\nDTEND${start.replace(/T10/, "T11")}\n${extra}END:VEVENT`);

  it("UTC is taken as it is", () => {
    expect(ranges(event(":20260115T100000Z"))).toEqual(["2026-01-15T10:00:00.000Z - 2026-01-15T11:00:00.000Z"]);
  });

  it("a TZID with a VTIMEZONE of the file uses that definition (Windows name)", () => {
    const vtimezone =
      "BEGIN:VTIMEZONE\nTZID:Eastern Standard Time\n" +
      "BEGIN:STANDARD\nDTSTART:16010101T020000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11\nEND:STANDARD\n" +
      "BEGIN:DAYLIGHT\nDTSTART:16010101T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3\nEND:DAYLIGHT\n" +
      "END:VTIMEZONE\n";
    const text = (start: string) => cal(`${vtimezone}BEGIN:VEVENT\nUID:e\nDTSTART;TZID=Eastern Standard Time:${start}\nDURATION:PT1H\nEND:VEVENT`);
    expect(ranges(text("20260115T100000"))).toEqual(["2026-01-15T15:00:00.000Z - 2026-01-15T16:00:00.000Z"]);
    expect(ranges(text("20260715T100000"))).toEqual(["2026-07-15T14:00:00.000Z - 2026-07-15T15:00:00.000Z"]);
  });

  it("an IANA TZID without VTIMEZONE is converted with Intl", () => {
    expect(ranges(event(";TZID=America/New_York:20260115T100000"))).toEqual(["2026-01-15T15:00:00.000Z - 2026-01-15T16:00:00.000Z"]);
    expect(ranges(event(";TZID=America/New_York:20260715T100000"))).toEqual(["2026-07-15T14:00:00.000Z - 2026-07-15T15:00:00.000Z"]);
    expect(ranges(event(";TZID=Asia/Kolkata:20260115T100000"))).toEqual(["2026-01-15T04:30:00.000Z - 2026-01-15T05:30:00.000Z"]);
  });

  it("a floating time is Berlin wall time", () => {
    expect(ranges(event(":20260115T100000"))).toEqual(["2026-01-15T09:00:00.000Z - 2026-01-15T10:00:00.000Z"]);
    expect(ranges(event(":20260715T100000"))).toEqual(["2026-07-15T08:00:00.000Z - 2026-07-15T09:00:00.000Z"]);
  });

  it("an unknown TZID is Berlin wall time", () => {
    expect(ranges(event(";TZID=Nowhere/Land:20260115T100000"))).toEqual(["2026-01-15T09:00:00.000Z - 2026-01-15T10:00:00.000Z"]);
    expect(ranges(event(";TZID=W. Europe Standard Time:20260715T100000"))).toEqual(["2026-07-15T08:00:00.000Z - 2026-07-15T09:00:00.000Z"]);
  });

  it("10:00 Berlin is right on both sides of every daylight saving change", () => {
    const at = (day: string) => ranges(event(`;TZID=Europe/Berlin:${day}T100000`))[0]!.split(" - ")[0];
    expect(at("20261024")).toBe("2026-10-24T08:00:00.000Z");
    expect(at("20261025")).toBe("2026-10-25T09:00:00.000Z");
    expect(at("20261026")).toBe("2026-10-26T09:00:00.000Z");
    expect(at("20270327")).toBe("2027-03-27T09:00:00.000Z");
    expect(at("20270328")).toBe("2027-03-28T08:00:00.000Z");
    expect(at("20270329")).toBe("2027-03-29T08:00:00.000Z");
  });

  it("a time that does not exist moves forward, an ambiguous one takes the first", () => {
    const start = (value: string) => ranges(cal(`BEGIN:VEVENT\nUID:e\nDTSTART:${value}\nDURATION:PT0S\nEND:VEVENT`))[0]!.split(" - ")[0];
    expect(start("20270328T023000")).toBe("2027-03-28T01:30:00.000Z"); // 03:30 summer time
    expect(start("20261025T023000")).toBe("2026-10-25T00:30:00.000Z"); // the first 02:30, still summer time
    expect(start("20261025T033000")).toBe("2026-10-25T02:30:00.000Z"); // 03:30 winter time, only once
  });

  it("a VTIMEZONE of one feed does not leak into the next one", () => {
    const withZone = cal(
      "BEGIN:VTIMEZONE\nTZID:X\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0300\nTZOFFSETTO:+0300\nEND:STANDARD\nEND:VTIMEZONE\n" +
        "BEGIN:VEVENT\nUID:a\nDTSTART;TZID=X:20260115T100000\nDURATION:PT1H\nEND:VEVENT",
    );
    const without = cal("BEGIN:VEVENT\nUID:b\nDTSTART;TZID=X:20260115T100000\nDURATION:PT1H\nEND:VEVENT");
    const before = ICAL.TimezoneService.count;
    expect(ranges(withZone)).toEqual(["2026-01-15T07:00:00.000Z - 2026-01-15T08:00:00.000Z"]);
    expect(ranges(without)).toEqual(["2026-01-15T09:00:00.000Z - 2026-01-15T10:00:00.000Z"]);
    expect(ICAL.TimezoneService.has("X")).toBe(false);
    expect(ICAL.TimezoneService.count).toBe(before);
  });
});

describe("all-day events", () => {
  const allDay = (start: string, end: string | null) =>
    cal(`BEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:${start}\n${end ? `DTEND;VALUE=DATE:${end}\n` : ""}END:VEVENT`);

  it("run from Berlin midnight to Berlin midnight", () => {
    expect(events(allDay("20260115", "20260116"))).toEqual([
      { start: "2026-01-14T23:00:00.000Z", end: "2026-01-15T23:00:00.000Z", allDay: true, busy: true, title: "" },
    ]);
    expect(ranges(allDay("20260701", "20260702"))).toEqual(["2026-06-30T22:00:00.000Z - 2026-07-01T22:00:00.000Z"]);
  });

  it("multi-day events end at the midnight of the exclusive end date", () => {
    expect(ranges(allDay("20260112", "20260115"))).toEqual(["2026-01-11T23:00:00.000Z - 2026-01-14T23:00:00.000Z"]);
  });

  it("are correct over a daylight saving change (23, 24 and 25 hour days)", () => {
    // 2026-10-25 has 25 hours, 2027-03-28 has 23 hours.
    expect(ranges(allDay("20261024", "20261027"))).toEqual(["2026-10-23T22:00:00.000Z - 2026-10-26T23:00:00.000Z"]);
    expect(ranges(allDay("20261025", "20261026"))).toEqual(["2026-10-24T22:00:00.000Z - 2026-10-25T23:00:00.000Z"]);
    expect(ranges(allDay("20270327", "20270330"))).toEqual(["2027-03-26T23:00:00.000Z - 2027-03-29T22:00:00.000Z"]);
  });

  it("without DTEND last one day", () => {
    expect(ranges(allDay("20260115", null))).toEqual(["2026-01-14T23:00:00.000Z - 2026-01-15T23:00:00.000Z"]);
  });

  it("with DURATION use it", () => {
    const text = (duration: string) => cal(`BEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20260115\nDURATION:${duration}\nEND:VEVENT`);
    expect(ranges(text("P2D"))).toEqual(["2026-01-14T23:00:00.000Z - 2026-01-16T23:00:00.000Z"]);
    expect(ranges(text("P1W"))).toEqual(["2026-01-14T23:00:00.000Z - 2026-01-21T23:00:00.000Z"]);
  });

  it("repeat on the right days across a daylight saving change", () => {
    const text = cal("BEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20261024\nDTEND;VALUE=DATE:20261025\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT");
    expect(ranges(text)).toEqual([
      "2026-10-23T22:00:00.000Z - 2026-10-24T22:00:00.000Z",
      "2026-10-24T22:00:00.000Z - 2026-10-25T23:00:00.000Z",
      "2026-10-25T23:00:00.000Z - 2026-10-26T23:00:00.000Z",
    ]);
  });
});

describe("end of an event", () => {
  const timed = (lines: string) => cal(`BEGIN:VEVENT\nUID:e\nDTSTART:20260115T100000Z\n${lines}END:VEVENT`);
  it("DTEND wins", () => {
    expect(ranges(timed("DTEND:20260115T123000Z\nDURATION:PT1H\n"))).toEqual(["2026-01-15T10:00:00.000Z - 2026-01-15T12:30:00.000Z"]);
  });
  it("DURATION when DTEND is missing", () => {
    expect(ranges(timed("DURATION:PT1H30M\n"))).toEqual(["2026-01-15T10:00:00.000Z - 2026-01-15T11:30:00.000Z"]);
  });
  it("zero length when both are missing", () => {
    expect(ranges(timed(""))).toEqual(["2026-01-15T10:00:00.000Z - 2026-01-15T10:00:00.000Z"]);
  });
  it("never ends before it starts", () => {
    expect(ranges(timed("DTEND:20260115T090000Z\n"))).toEqual(["2026-01-15T10:00:00.000Z - 2026-01-15T10:00:00.000Z"]);
  });
});

describe("status, transparency and title", () => {
  const one = (lines: string) => cal(`BEGIN:VEVENT\nUID:e\nDTSTART:20260115T100000Z\nDTEND:20260115T110000Z\n${lines}END:VEVENT`);

  it("TRANSPARENT is listed as free", () => {
    expect(events(one("TRANSP:TRANSPARENT\n"))).toHaveLength(1);
    expect(events(one("TRANSP:TRANSPARENT\n"))[0]!.busy).toBe(false);
    expect(events(one("TRANSP:OPAQUE\n"))[0]!.busy).toBe(true);
    expect(events(one(""))[0]!.busy).toBe(true);
  });
  it("CANCELLED is left out", () => {
    expect(events(one("STATUS:CANCELLED\n"))).toEqual([]);
  });
  it("TENTATIVE and CONFIRMED are busy", () => {
    expect(events(one("STATUS:TENTATIVE\n"))[0]!.busy).toBe(true);
    expect(events(one("STATUS:CONFIRMED\n"))[0]!.busy).toBe(true);
  });
  it("the title is trimmed, unescaped and may be empty", () => {
    expect(events(one("SUMMARY:  Zahnarzt\\, Dr. Meier  \n"))[0]!.title).toBe("Zahnarzt, Dr. Meier");
    expect(events(one(""))[0]!.title).toBe("");
  });
  it("the title is cut to 200 characters, then trimmed again", () => {
    expect(events(one(`SUMMARY:${"x".repeat(250)}\n`))[0]!.title).toBe("x".repeat(200));
    expect(events(one(`SUMMARY:${"x".repeat(199)} yyy\n`))[0]!.title).toBe("x".repeat(199));
    expect(events(one(`SUMMARY:${"😀".repeat(250)}\n`))[0]!.title).toBe("😀".repeat(200));
  });
});

describe("recurrence", () => {
  const weekly = (rule: string, extra = "") =>
    cal(`BEGIN:VEVENT\nUID:w\nDTSTART;TZID=Europe/Berlin:20260105T100000\nDTEND;TZID=Europe/Berlin:20260105T113000\nRRULE:${rule}\n${extra}END:VEVENT`);
  const mondays = (...days: string[]) => days.map((d) => `2026-01-${d}T09:00:00.000Z - 2026-01-${d}T10:30:00.000Z`);

  it("COUNT", () => {
    expect(ranges(weekly("FREQ=WEEKLY;COUNT=3"))).toEqual(mondays("05", "12", "19"));
  });
  it("UNTIL, also the very last occurrence given in UTC", () => {
    // 10:00 Berlin on the 26th is exactly 09:00 UTC: that day still counts.
    expect(ranges(weekly("FREQ=WEEKLY;UNTIL=20260126T090000Z"))).toEqual(mondays("05", "12", "19", "26"));
    expect(ranges(weekly("FREQ=WEEKLY;UNTIL=20260126T085959Z"))).toEqual(mondays("05", "12", "19"));
    expect(ranges(weekly("FREQ=WEEKLY;UNTIL=20260119"))).toEqual(mondays("05", "12", "19"));
  });
  it("EXDATE", () => {
    expect(ranges(weekly("FREQ=WEEKLY;COUNT=4", "EXDATE;TZID=Europe/Berlin:20260112T100000\n"))).toEqual(mondays("05", "19", "26"));
  });
  it("keeps the wall time across a daylight saving change", () => {
    const text = weekly("FREQ=WEEKLY;COUNT=2").replaceAll("20260105", "20261019");
    expect(ranges(text)).toEqual([
      "2026-10-19T08:00:00.000Z - 2026-10-19T09:30:00.000Z",
      "2026-10-26T09:00:00.000Z - 2026-10-26T10:30:00.000Z",
    ]);
  });
  it("RDATE adds single dates", () => {
    const text = cal(
      "BEGIN:VEVENT\nUID:r\nDTSTART;TZID=Europe/Berlin:20260105T100000\nDTEND;TZID=Europe/Berlin:20260105T110000\n" +
        "RDATE;TZID=Europe/Berlin:20260203T140000,20260310T140000\nEND:VEVENT",
    );
    expect(ranges(text)).toEqual([
      "2026-01-05T09:00:00.000Z - 2026-01-05T10:00:00.000Z",
      "2026-02-03T13:00:00.000Z - 2026-02-03T14:00:00.000Z",
      "2026-03-10T13:00:00.000Z - 2026-03-10T14:00:00.000Z",
    ]);
  });
  it("expands only up to the end of the window (an endless series)", () => {
    const window = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-20T00:00:00Z") };
    expect(ranges(weekly("FREQ=WEEKLY"), window)).toEqual(mondays("05", "12", "19"));
  });
});

describe("overrides (RECURRENCE-ID)", () => {
  const master = "BEGIN:VEVENT\nUID:s\nDTSTART;TZID=Europe/Berlin:20260105T100000\nDTEND;TZID=Europe/Berlin:20260105T110000\nRRULE:FREQ=WEEKLY;COUNT=4\nSUMMARY:Treffen\nEND:VEVENT\n";
  const override = (recurrence: string, lines: string) =>
    `BEGIN:VEVENT\nUID:s\nRECURRENCE-ID;TZID=Europe/Berlin:${recurrence}\n${lines}END:VEVENT\n`;

  it("a moved occurrence and a retitled one", () => {
    const text = cal(
      master +
        override("20260112T100000", "DTSTART;TZID=Europe/Berlin:20260113T140000\nDTEND;TZID=Europe/Berlin:20260113T150000\nSUMMARY:Verschoben\n") +
        override("20260119T100000", "DTSTART;TZID=Europe/Berlin:20260119T100000\nDTEND;TZID=Europe/Berlin:20260119T120000\nSUMMARY:Länger\n"),
    );
    expect(events(text).map((e) => [e.start, e.end, e.title])).toEqual([
      ["2026-01-05T09:00:00.000Z", "2026-01-05T10:00:00.000Z", "Treffen"],
      ["2026-01-13T13:00:00.000Z", "2026-01-13T14:00:00.000Z", "Verschoben"],
      ["2026-01-19T09:00:00.000Z", "2026-01-19T11:00:00.000Z", "Länger"],
      ["2026-01-26T09:00:00.000Z", "2026-01-26T10:00:00.000Z", "Treffen"],
    ]);
  });

  it("a cancelled occurrence disappears, the others stay", () => {
    const text = cal(
      master + override("20260112T100000", "DTSTART;TZID=Europe/Berlin:20260112T100000\nDTEND;TZID=Europe/Berlin:20260112T110000\nSTATUS:CANCELLED\n"),
    );
    expect(ranges(text)).toEqual([
      "2026-01-05T09:00:00.000Z - 2026-01-05T10:00:00.000Z",
      "2026-01-19T09:00:00.000Z - 2026-01-19T10:00:00.000Z",
      "2026-01-26T09:00:00.000Z - 2026-01-26T10:00:00.000Z",
    ]);
  });

  it("an occurrence moved into the window from outside of it appears", () => {
    // The 26th (before the window) is moved to 3 February (inside), the 2nd of February to the 28th of January (outside).
    const text = cal(
      "BEGIN:VEVENT\nUID:s\nDTSTART;TZID=Europe/Berlin:20260105T100000\nDTEND;TZID=Europe/Berlin:20260105T110000\nRRULE:FREQ=WEEKLY;COUNT=7\nEND:VEVENT\n" +
        override("20260126T100000", "DTSTART;TZID=Europe/Berlin:20260203T180000\nDTEND;TZID=Europe/Berlin:20260203T190000\n") +
        override("20260202T100000", "DTSTART;TZID=Europe/Berlin:20260128T100000\nDTEND;TZID=Europe/Berlin:20260128T110000\n"),
    );
    expect(ranges(text, SHORT_WINDOW)).toEqual([
      "2026-02-03T17:00:00.000Z - 2026-02-03T18:00:00.000Z",
      "2026-02-09T09:00:00.000Z - 2026-02-09T10:00:00.000Z",
      "2026-02-16T09:00:00.000Z - 2026-02-16T10:00:00.000Z",
    ]);
  });

  it("an occurrence moved into the window from after its end appears", () => {
    // The 9th of March (after the window) is moved to the 10th of February (inside).
    const text = cal(
      "BEGIN:VEVENT\nUID:s\nDTSTART;TZID=Europe/Berlin:20260105T100000\nDTEND;TZID=Europe/Berlin:20260105T110000\nRRULE:FREQ=WEEKLY;UNTIL=20260331T000000Z\nEND:VEVENT\n" +
        override("20260309T100000", "DTSTART;TZID=Europe/Berlin:20260210T200000\nDTEND;TZID=Europe/Berlin:20260210T210000\n"),
    );
    expect(ranges(text, SHORT_WINDOW)).toContain("2026-02-10T19:00:00.000Z - 2026-02-10T20:00:00.000Z");
  });

  it("an override only changes the series with the same UID", () => {
    const other = "BEGIN:VEVENT\nUID:other\nDTSTART;TZID=Europe/Berlin:20260112T100000\nDTEND;TZID=Europe/Berlin:20260112T110000\nRRULE:FREQ=WEEKLY;COUNT=2\nEND:VEVENT\n";
    const text = cal(
      master + other + override("20260112T100000", "DTSTART;TZID=Europe/Berlin:20260112T100000\nDTEND;TZID=Europe/Berlin:20260112T110000\nSTATUS:CANCELLED\n"),
    );
    // The other series still has its occurrence on the 12th.
    expect(ranges(text).filter((r) => r.startsWith("2026-01-12"))).toEqual(["2026-01-12T09:00:00.000Z - 2026-01-12T10:00:00.000Z"]);
  });

  it("an override without its series is an ordinary event", () => {
    const text = cal(override("20260112T100000", "DTSTART;TZID=Europe/Berlin:20260113T140000\nDTEND;TZID=Europe/Berlin:20260113T150000\nSUMMARY:Nur ich\n"));
    expect(events(text).map((e) => [e.start, e.title])).toEqual([["2026-01-13T13:00:00.000Z", "Nur ich"]]);
  });
});

describe("window", () => {
  const window = { start: new Date("2026-02-01T00:00:00Z"), end: new Date("2026-03-01T00:00:00Z") };

  it("only events that overlap it are listed", () => {
    const text = cal(
      [
        ["20260115T100000Z", "20260115T110000Z"], // before
        ["20260131T230000Z", "20260201T010000Z"], // starts before, ends inside
        ["20260201T000000Z", "20260201T010000Z"], // exactly at the start
        ["20260228T230000Z", "20260301T010000Z"], // starts inside, ends after
        ["20260301T000000Z", "20260301T010000Z"], // starts exactly at the end
        ["20260131T220000Z", "20260201T000000Z"], // ends exactly at the start
        ["20260401T100000Z", "20260401T110000Z"], // after
      ]
        .map(([s, e]) => `BEGIN:VEVENT\nUID:${s}\nDTSTART:${s}\nDTEND:${e}\nEND:VEVENT`)
        .join("\n"),
    );
    expect(ranges(text, window)).toEqual([
      "2026-01-31T23:00:00.000Z - 2026-02-01T01:00:00.000Z",
      "2026-02-01T00:00:00.000Z - 2026-02-01T01:00:00.000Z",
      "2026-02-28T23:00:00.000Z - 2026-03-01T01:00:00.000Z",
    ]);
  });

  it("an all-day event is in the window by its Berlin days", () => {
    const text = cal("BEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20260301\nDTEND;VALUE=DATE:20260302\nEND:VEVENT");
    // Begins at 23:00 UTC on 28 February: inside a window that ends on 1 March 00:00 UTC.
    expect(events(text, window)).toHaveLength(1);
  });

  it("sorts by start, then end", () => {
    const text = cal(
      [
        ["20260210T100000Z", "20260210T120000Z"],
        ["20260209T100000Z", "20260209T110000Z"],
        ["20260210T100000Z", "20260210T110000Z"],
      ]
        .map(([s, e], i) => `BEGIN:VEVENT\nUID:${i}\nDTSTART:${s}\nDTEND:${e}\nEND:VEVENT`)
        .join("\n"),
    );
    expect(ranges(text, window)).toEqual([
      "2026-02-09T10:00:00.000Z - 2026-02-09T11:00:00.000Z",
      "2026-02-10T10:00:00.000Z - 2026-02-10T11:00:00.000Z",
      "2026-02-10T10:00:00.000Z - 2026-02-10T12:00:00.000Z",
    ]);
  });
});

describe("limits", () => {
  it("a rule that would produce millions of occurrences stops, says so, and is fast", () => {
    const text = cal("BEGIN:VEVENT\nUID:m\nDTSTART:20000101T000000Z\nRRULE:FREQ=MINUTELY\nEND:VEVENT");
    const started = Date.now();
    const parsed = parseCalendar(text, { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-02-01T00:00:00Z") });
    expect(parsed?.truncated).toBe(true);
    expect(parsed?.events).toEqual([]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("a series that reaches the window within the step limit is complete", () => {
    const text = cal("BEGIN:VEVENT\nUID:m\nDTSTART:20260101T000000Z\nDURATION:PT1M\nRRULE:FREQ=HOURLY\nEND:VEVENT");
    const parsed = parseCalendar(text, { start: new Date("2026-01-01T00:00:00Z"), end: new Date(Date.parse("2026-01-01T00:00:00Z") + 5 * DAY) });
    expect(parsed?.truncated).toBe(false);
    expect(parsed?.events).toHaveLength(120);
  });

  it("at most 20000 events are returned", () => {
    const body = Array.from({ length: 20_050 }, (_, i) => `BEGIN:VEVENT\nUID:${i}\nDTSTART:20260115T100000Z\nDTEND:20260115T110000Z\nEND:VEVENT`).join("\n");
    const parsed = parseCalendar(cal(body), WIDE);
    expect(parsed?.events).toHaveLength(20_000);
    expect(parsed?.truncated).toBe(true);
  }, 60_000);

  it("exactly 20000 events are not reported as cut off", () => {
    const body = Array.from({ length: 20_000 }, (_, i) => `BEGIN:VEVENT\nUID:${i}\nDTSTART:20260115T100000Z\nDTEND:20260115T110000Z\nEND:VEVENT`).join("\n");
    const parsed = parseCalendar(cal(body), WIDE);
    expect(parsed?.events).toHaveLength(20_000);
    expect(parsed?.truncated).toBe(false);
  }, 60_000);
});

describe("line ends", () => {
  it("CRLF and LF give the same result", () => {
    const text = cal(
      "BEGIN:VEVENT\nUID:a\nDTSTART;TZID=Europe/Berlin:20260105T100000\nDTEND;TZID=Europe/Berlin:20260105T110000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:Ein sehr langer Titel der\n  gefaltet ist\nEND:VEVENT",
    );
    const lf = parseCalendar(text, WIDE);
    expect(lf?.events).toHaveLength(3);
    expect(lf?.events[0]?.title).toBe("Ein sehr langer Titel der gefaltet ist");
    expect(parseCalendar(crlf(text), WIDE)).toEqual(lf);
  });
});

// A feed as Google Calendar writes it ("Secret address in iCal format").
const GOOGLE_FEED = crlf(`BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Familie
X-WR-TIMEZONE:Europe/Berlin
BEGIN:VTIMEZONE
TZID:Europe/Berlin
X-LIC-LOCATION:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=Europe/Berlin:20261026T180000
DTEND;TZID=Europe/Berlin:20261026T193000
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T170000Z
DTSTAMP:20261101T120000Z
UID:chor-1@google.com
CREATED:20260901T080000Z
LAST-MODIFIED:20261001T080000Z
SEQUENCE:1
STATUS:CONFIRMED
SUMMARY:Chorprobe
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Berlin:20261102T180000
DTEND;TZID=Europe/Berlin:20261102T193000
DTSTAMP:20261101T120000Z
UID:chor-1@google.com
RECURRENCE-ID;TZID=Europe/Berlin:20261102T180000
SEQUENCE:2
STATUS:CONFIRMED
SUMMARY:Chorprobe (Aula)
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261224
DTEND;VALUE=DATE:20261228
DTSTAMP:20261101T120000Z
UID:urlaub-1@google.com
STATUS:CONFIRMED
SUMMARY:Weihnachtsurlaub
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTART:20261110T143000Z
DTEND:20261110T153000Z
DTSTAMP:20261101T120000Z
UID:arzt-1@google.com
STATUS:CANCELLED
SUMMARY:Arzt (abgesagt)
TRANSP:OPAQUE
END:VEVENT
BEGIN:VEVENT
DTSTART:20261112T080000Z
DTEND:20261112T090000Z
DTSTAMP:20261101T120000Z
UID:call-1@google.com
STATUS:TENTATIVE
SUMMARY:Call mit einem sehr langen Titel, der über zwei Zeilen gefaltet
  wird
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR
`);

// A feed as Outlook (Microsoft 365) publishes it: Windows time zone names with a VTIMEZONE.
const OUTLOOK_FEED = crlf(`BEGIN:VCALENDAR
METHOD:PUBLISH
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
X-WR-CALNAME:Kalender
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:040000008200E00074C5B7101A82E008000000001
SUMMARY:Teamrunde
DTSTART;TZID=W. Europe Standard Time:20261102T093000
DTEND;TZID=W. Europe Standard Time:20261102T100000
RRULE:FREQ=WEEKLY;UNTIL=20261123T083000Z;INTERVAL=1;BYDAY=MO;WKST=MO
CLASS:PUBLIC
PRIORITY:5
DTSTAMP:20261101T120000Z
TRANSP:OPAQUE
STATUS:CONFIRMED
SEQUENCE:0
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
BEGIN:VEVENT
UID:040000008200E00074C5B7101A82E008000000001
SUMMARY:Teamrunde (später)
RECURRENCE-ID;TZID=W. Europe Standard Time:20261109T093000
DTSTART;TZID=W. Europe Standard Time:20261109T140000
DTEND;TZID=W. Europe Standard Time:20261109T143000
DTSTAMP:20261101T120000Z
TRANSP:OPAQUE
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:040000008200E00074C5B7101A82E008000000002
SUMMARY:Messe
DTSTART;VALUE=DATE:20261029
DTEND;VALUE=DATE:20261102
DTSTAMP:20261101T120000Z
TRANSP:TRANSPARENT
X-MICROSOFT-CDO-ALLDAYEVENT:TRUE
X-MICROSOFT-CDO-BUSYSTATUS:FREE
END:VEVENT
BEGIN:VEVENT
UID:040000008200E00074C5B7101A82E008000000003
SUMMARY:Bericht
DTSTART;TZID=W. Europe Standard Time:20261028T230000
DTEND;TZID=W. Europe Standard Time:20261029T010000
DTSTAMP:20261101T120000Z
TRANSP:OPAQUE
STATUS:TENTATIVE
END:VEVENT
END:VCALENDAR
`);

const FEED_WINDOW = { start: new Date("2026-10-26T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") };

describe("real feeds", () => {
  it("Google", () => {
    const parsed = parseCalendar(GOOGLE_FEED, FEED_WINDOW);
    expect(parsed?.name).toBe("Familie");
    expect(parsed?.truncated).toBe(false);
    expect(parsed?.events.map(shown)).toEqual([
      // Monday 26 October: summer time ended on the 25th, so 18:00 is 17:00 UTC
      { start: "2026-10-26T17:00:00.000Z", end: "2026-10-26T18:30:00.000Z", allDay: false, busy: true, title: "Chorprobe" },
      { start: "2026-11-02T17:00:00.000Z", end: "2026-11-02T18:30:00.000Z", allDay: false, busy: true, title: "Chorprobe (Aula)" },
      { start: "2026-11-09T17:00:00.000Z", end: "2026-11-09T18:30:00.000Z", allDay: false, busy: true, title: "Chorprobe" },
      { start: "2026-11-12T08:00:00.000Z", end: "2026-11-12T09:00:00.000Z", allDay: false, busy: true, title: "Call mit einem sehr langen Titel, der über zwei Zeilen gefaltet wird" },
      // 16 November 18:00 Berlin = 17:00 UTC is exactly UNTIL: still counts
      { start: "2026-11-16T17:00:00.000Z", end: "2026-11-16T18:30:00.000Z", allDay: false, busy: true, title: "Chorprobe" },
      { start: "2026-12-23T23:00:00.000Z", end: "2026-12-27T23:00:00.000Z", allDay: true, busy: false, title: "Weihnachtsurlaub" },
    ]);
  });

  it("Outlook", () => {
    const parsed = parseCalendar(OUTLOOK_FEED, FEED_WINDOW);
    expect(parsed?.name).toBe("Kalender");
    expect(parsed?.events.map(shown)).toEqual([
      // 28 October is winter time already: 23:00 is 22:00 UTC
      { start: "2026-10-28T22:00:00.000Z", end: "2026-10-29T00:00:00.000Z", allDay: false, busy: true, title: "Bericht" },
      { start: "2026-10-28T23:00:00.000Z", end: "2026-11-01T23:00:00.000Z", allDay: true, busy: false, title: "Messe" },
      { start: "2026-11-02T08:30:00.000Z", end: "2026-11-02T09:00:00.000Z", allDay: false, busy: true, title: "Teamrunde" },
      { start: "2026-11-09T13:00:00.000Z", end: "2026-11-09T13:30:00.000Z", allDay: false, busy: true, title: "Teamrunde (später)" },
      { start: "2026-11-16T08:30:00.000Z", end: "2026-11-16T09:00:00.000Z", allDay: false, busy: true, title: "Teamrunde" },
      { start: "2026-11-23T08:30:00.000Z", end: "2026-11-23T09:00:00.000Z", allDay: false, busy: true, title: "Teamrunde" },
    ]);
  });

  it("both also with LF only", () => {
    expect(parseCalendar(GOOGLE_FEED.replace(/\r\n/g, "\n"), FEED_WINDOW)).toEqual(parseCalendar(GOOGLE_FEED, FEED_WINDOW));
    expect(parseCalendar(OUTLOOK_FEED.replace(/\r\n/g, "\n"), FEED_WINDOW)).toEqual(parseCalendar(OUTLOOK_FEED, FEED_WINDOW));
  });
});
