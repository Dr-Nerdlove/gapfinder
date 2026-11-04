import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { escapeText, foldLine, writeCalendar, type FixedEvent } from "../src/calendars/ics-write.js";

const timed: FixedEvent = {
  pollId: 7,
  title: "Spieleabend",
  note: "",
  when: { kind: "timed", start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:30:00.000Z" },
  fixedAt: "2026-11-02T08:15:30.000Z",
  sequence: 3,
};
const days: FixedEvent = {
  pollId: 8,
  title: "Wochenende",
  note: "Bei mir",
  when: { kind: "days", first: "2026-11-27", last: "2026-11-30" },
  fixedAt: "2026-11-02T08:15:30.000Z",
  sequence: 1,
};

/** The unfolded content lines. */
const linesOf = (text: string): string[] => text.replace(/\r\n[ ]/g, "").split("\r\n").slice(0, -1);
const bytes = (line: string) => Buffer.byteLength(line, "utf8");

function parse(text: string) {
  const calendar = new ICAL.Component(ICAL.parse(text));
  return { calendar, events: calendar.getAllSubcomponents("vevent").map((vevent) => new ICAL.Event(vevent)) };
}

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and line breaks", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
  });

  it("drops control characters and keeps umlauts", () => {
    expect(escapeText("Lückenfüller\u0000\u0007 ß")).toBe("Lückenfüller ß");
  });
});

describe("foldLine", () => {
  it("leaves a line of 75 bytes alone and cuts a line of 76 bytes", () => {
    expect(foldLine("x".repeat(75))).toEqual(["x".repeat(75)]);
    expect(foldLine("x".repeat(76))).toEqual(["x".repeat(75), " x"]);
  });

  it("starts every continuation line with a space and keeps each line within 75 bytes", () => {
    const folded = foldLine("y".repeat(200));
    expect(folded.map(bytes)).toEqual([75, 75, 52]);
    expect(folded.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(folded.join("").replace(/ /g, "")).toBe("y".repeat(200));
  });

  it("never splits a multi-byte character at the boundary", () => {
    // 74 ASCII bytes + "ü" (2 bytes) would end at byte 76: the "ü" moves to the next line.
    const line = "a".repeat(74) + "ü" + "b";
    const folded = foldLine(line);
    expect(folded).toEqual(["a".repeat(74), " üb"]);
    // A 4-byte character (outside the BMP) too, on a continuation line.
    const emoji = "a".repeat(75) + "b".repeat(72) + "😀" + "c";
    const lines = foldLine(emoji);
    expect(lines.every((l) => bytes(l) <= 75)).toBe(true);
    expect(lines.map((l) => l.replace(/^ /, "")).join("")).toBe(emoji);
    expect(lines.some((l) => l.includes("�"))).toBe(false);
  });
});

describe("writeCalendar", () => {
  it("writes CRLF lines of at most 75 bytes, even for long titles with umlauts", () => {
    const text = writeCalendar([{ ...timed, title: "Ü".repeat(120), note: "ä, ö; ü\nß ".repeat(30) }], { feed: true });
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of text.split("\r\n")) expect(bytes(line)).toBeLessThanOrEqual(75);
    const { events } = parse(text);
    expect(events[0]!.summary).toBe("Ü".repeat(120));
    expect(events[0]!.description).toBe("ä, ö; ü\nß ".repeat(30));
  });

  it("writes a single timed event in UTC with the documented fields", () => {
    const text = writeCalendar([timed], { feed: false });
    expect(linesOf(text)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lueckenfueller//DE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:poll-7@lueckenfueller",
      "DTSTAMP:20261102T081530Z",
      "SEQUENCE:3",
      "SUMMARY:Spieleabend",
      "DTSTART:20261107T170000Z",
      "DTEND:20261107T193000Z",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
  });

  it("adds the name, time zone and refresh hints only for the feed", () => {
    const feed = linesOf(writeCalendar([], { feed: true }));
    expect(feed).toContain("X-WR-CALNAME:Lückenfüller");
    expect(feed).toContain("X-WR-TIMEZONE:Europe/Berlin");
    expect(feed).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(feed).toContain("X-PUBLISHED-TTL:PT1H");
    const single = writeCalendar([timed], { feed: false });
    expect(single).not.toMatch(/X-WR-CALNAME|X-WR-TIMEZONE|REFRESH-INTERVAL|X-PUBLISHED-TTL/);
  });

  it("writes an empty feed as a valid calendar without events", () => {
    const text = writeCalendar([], { feed: true });
    const { calendar, events } = parse(text);
    expect(events).toEqual([]);
    expect(calendar.getFirstPropertyValue("version")).toBe("2.0");
    expect(text).not.toContain("VEVENT");
  });

  it("writes days as whole-day dates and ends them the day after the last day", () => {
    const lines = linesOf(writeCalendar([days], { feed: false }));
    expect(lines).toContain("DTSTART;VALUE=DATE:20261127");
    expect(lines).toContain("DTEND;VALUE=DATE:20261201");
    expect(lines).toContain("DESCRIPTION:Bei mir");
  });

  it("ends a one-day event on the next day and crosses month and year ends", () => {
    const single: FixedEvent = { ...days, when: { kind: "days", first: "2026-12-31", last: "2026-12-31" } };
    const lines = linesOf(writeCalendar([single], { feed: false }));
    expect(lines).toContain("DTSTART;VALUE=DATE:20261231");
    expect(lines).toContain("DTEND;VALUE=DATE:20270101");
  });

  it("writes no DESCRIPTION without a note", () => {
    expect(writeCalendar([timed], { feed: false })).not.toContain("DESCRIPTION");
  });

  it("cannot be tricked into extra lines by a title with line breaks", () => {
    const text = writeCalendar([{ ...timed, title: "x\r\nBEGIN:VEVENT\r\nSUMMARY:evil" }], { feed: false });
    expect(parse(text).events).toHaveLength(1);
    expect(linesOf(text).filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("round-trips through a real parser: times, all-day dates, uid, sequence and stamp", () => {
    const { events } = parse(writeCalendar([timed, days], { feed: true }));
    expect(events).toHaveLength(2);
    const [a, b] = events as [ICAL.Event, ICAL.Event];
    expect(a.uid).toBe("poll-7@lueckenfueller");
    expect(a.sequence).toBe(3);
    expect(a.summary).toBe("Spieleabend");
    expect(a.startDate.toJSDate().toISOString()).toBe("2026-11-07T17:00:00.000Z");
    expect(a.endDate.toJSDate().toISOString()).toBe("2026-11-07T19:30:00.000Z");
    expect(a.startDate.isDate).toBe(false);
    expect(a.component.getFirstPropertyValue("dtstamp")?.toString()).toBe("2026-11-02T08:15:30Z");
    expect(a.component.getFirstPropertyValue("transp")).toBe("OPAQUE");

    expect(b.uid).toBe("poll-8@lueckenfueller");
    expect(b.startDate.isDate).toBe(true);
    expect(b.startDate.toString()).toBe("2026-11-27");
    expect(b.endDate.toString()).toBe("2026-12-01");
    expect(b.description).toBe("Bei mir");
  });
});
