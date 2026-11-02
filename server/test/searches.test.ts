import type { ApiErrorBody, Calendar, PeopleList, SearchResult } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  APPLE_LINK,
  createCalendarEnv,
  GOOGLE_LINK,
  ics,
  OUTLOOK_LINK,
  type CalendarEnv,
  type FakeEvent,
} from "./calendar-helpers.js";
import { addUserWithSession, allStrings, call } from "./helpers.js";

let env: CalendarEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

// The test clock starts on Sunday 2026-11-01 at 10:00 UTC (11:00 German time). 2026-11-07 is a Saturday.
async function setup(overrides: Parameters<typeof createCalendarEnv>[0] = {}) {
  env = await createCalendarEnv(overrides);
  const me = await addUserWithSession(env, "Vincent R.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  return { ...env, me, anna, ben };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function addCalendar(e: Setup, token: string, link: string, events: FakeEvent[] | string = []) {
  e.feeds.set(link, typeof events === "string" ? events : ics(events));
  const response = await call(e, "POST", "/api/calendars", { token, body: { link } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Calendar>();
}

const busyOn = (start: string, end: string, summary = "Geheimer Termin"): FakeEvent => ({ start, end, summary });
const code = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().code;
const field = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().field;

const hoursBody = (overrides: Record<string, unknown> = {}) => ({
  mode: "hours",
  people: [] as number[],
  from: "2026-11-07",
  to: "2026-11-07",
  weekdays: [6],
  durationMinutes: 60,
  ...overrides,
});
const daysBody = (overrides: Record<string, unknown> = {}) => ({
  mode: "days",
  people: [] as number[],
  from: "2026-11-02",
  to: "2026-11-08",
  days: 3,
  ...overrides,
});

const search = (e: Setup, body: unknown, token = e.me.token) => call(e, "POST", "/api/searches", { token, body });
const slot = (start: string, end: string) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });

describe("login", () => {
  it.each([
    ["GET", "/api/people", undefined],
    ["POST", "/api/searches", hoursBody()],
  ] as const)("%s %s answers 401 without a login", async (method, url, body) => {
    const e = await setup();
    const response = await call(e, method, url, { body });
    expect(response.statusCode).toBe(401);
    expect(code(response)).toBe("unauthorized");
    expect(e.feeds.calls).toEqual([]);
  });
});

describe("GET /api/people", () => {
  it("lists everybody with an account, the caller too, sorted without regard to case", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/people", { token: e.ben.token });
    expect(response.statusCode).toBe(200);
    const { people } = response.json<PeopleList>();
    expect(people.map((p) => p.username)).toEqual(["Anna K.", "ben m.", "Vincent R."]);
    expect(people.map((p) => p.id)).toEqual([e.anna.id, e.ben.id, e.me.id]);
  });

  it("shows nothing but id, name and colour", async () => {
    const e = await setup();
    e.db.prepare("UPDATE users SET seed_color = ?, is_admin = 1 WHERE id = ?").run("#336699", e.anna.id);
    await addCalendar(e, e.anna.token, GOOGLE_LINK);
    const response = await call(e, "GET", "/api/people", { token: e.me.token });
    const { people } = response.json<PeopleList>();
    for (const person of people) expect(Object.keys(person).sort()).toEqual(["id", "seedColor", "username"]);
    expect(people.find((p) => p.id === e.anna.id)!.seedColor).toBe("#336699");
    expect(people.find((p) => p.id === e.me.id)!.seedColor).toBeNull();
    expect(response.body).not.toMatch(/password|hash|admin|calendar|created/i);
  });
});

describe("POST /api/searches: validation", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["a date that does not exist", { from: "2026-11-31" }, "from"],
    ["a date in another format", { from: "07.11.2026" }, "from"],
    ["a `from` in the past", { from: "2026-10-31" }, "from"],
    ["a `to` that is not a date", { to: "later" }, "to"],
    ["a `to` before `from`", { from: "2026-11-08", to: "2026-11-07" }, "to"],
    ["a range of 367 days", { from: "2026-11-02", to: "2027-11-03" }, "to"],
    ["a `to` more than 365 days ahead", { from: "2027-11-02", to: "2027-11-02" }, "to"],
    ["a mode that does not exist", { mode: "weeks" }, "mode"],
    ["no `from`", { from: undefined }, "from"],
    ["people that is not a list", { people: "all" }, "people"],
    ["a person id that is not a whole number", { people: [1.5] }, "people"],
    ["a person that does not exist", { people: [9999] }, "people"],
    ["more than 50 people", { people: Array.from({ length: 60 }, (_, i) => i + 1) }, "people"],
    ["no weekdays", { weekdays: [] }, "weekdays"],
    ["no `weekdays` field", { weekdays: undefined }, "weekdays"],
    ["weekday 8", { weekdays: [8] }, "weekdays"],
    ["weekday 0", { weekdays: [6, 0] }, "weekdays"],
    ["more than seven weekdays", { weekdays: [1, 2, 3, 4, 5, 6, 7, 1] }, "weekdays"],
    ["a duration that is not a multiple of 30", { durationMinutes: 45 }, "durationMinutes"],
    ["a duration of 0", { durationMinutes: 0 }, "durationMinutes"],
    ["a duration over 24 hours", { durationMinutes: 1470 }, "durationMinutes"],
    ["a duration of 24 hours (no window is that long)", { durationMinutes: 1440, window: { start: "09:15", end: "09:00" } }, "durationMinutes"],
    ["no duration", { durationMinutes: undefined }, "durationMinutes"],
    ["a duration longer than the window", { window: { start: "18:00", end: "20:00" }, durationMinutes: 150 }, "durationMinutes"],
    ["a duration longer than the default window", { durationMinutes: 900 }, "durationMinutes"],
    ["a window time without a leading zero", { window: { start: "9:00", end: "12:00" } }, "window"],
    ["a window time that is not on a quarter", { window: { start: "09:10", end: "12:00" } }, "window"],
    ["a window time of 24:00", { window: { start: "09:00", end: "24:00" } }, "window"],
    ["a window that starts when it ends", { window: { start: "12:00", end: "12:00" } }, "window"],
    ["a window without an end", { window: { start: "12:00" } }, "window"],
    ["a buffer that is not a multiple of 15", { bufferMinutes: 20 }, "bufferMinutes"],
    ["a buffer over 2 hours", { bufferMinutes: 135 }, "bufferMinutes"],
    ["a negative buffer", { bufferMinutes: -15 }, "bufferMinutes"],
  ];
  it.each(cases)("refuses %s", async (_name, change, expectedField) => {
    const e = await setup();
    const response = await search(e, { ...hoursBody(), ...change });
    expect(response.statusCode).toBe(400);
    expect(code(response)).toBe("validation");
    expect(field(response)).toBe(expectedField);
  });

  const dayCases: [string, Record<string, unknown>, string][] = [
    ["0 days", { days: 0 }, "days"],
    ["32 days", { days: 32 }, "days"],
    ["no `days`", { days: undefined }, "days"],
    ["a start weekday of 8", { startWeekday: 8 }, "startWeekday"],
    ["a `from` in the past", { from: "2026-10-31" }, "from"],
  ];
  it.each(dayCases)("refuses a days search with %s", async (_name, change, expectedField) => {
    const e = await setup();
    const response = await search(e, { ...daysBody(), ...change });
    expect(response.statusCode).toBe(400);
    expect(field(response)).toBe(expectedField);
  });

  it("accepts the limits", async () => {
    const e = await setup();
    const hoursOk = [
      { from: "2026-11-01", to: "2027-11-01" }, // today, 366 days, 365 days ahead
      { durationMinutes: 1410, window: { start: "09:15", end: "09:00" } }, // the longest window there is
      { durationMinutes: 120, window: { start: "22:00", end: "00:00" } },
      { durationMinutes: 30, bufferMinutes: 120 },
      { weekdays: [7, 6, 5, 4, 3, 2, 1] }, // all seven, in any order
    ];
    for (const change of hoursOk) {
      const response = await search(e, hoursBody(change));
      expect(response.statusCode, JSON.stringify(change) + response.body).toBe(200);
    }
    for (const change of [{ days: 1 }, { days: 31, startWeekday: 1 }]) {
      const response = await search(e, daysBody(change));
      expect(response.statusCode, JSON.stringify(change) + response.body).toBe(200);
    }
  });

  it("answers 400 before anything is read or counted", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK);
    const before = e.feeds.calls.length;
    for (let i = 0; i < 35; i++) expect((await search(e, hoursBody({ durationMinutes: 45 }))).statusCode).toBe(400);
    expect((await search(e, hoursBody())).statusCode).toBe(200);
    expect(e.feeds.calls.length).toBe(before);
  });
});

describe("POST /api/searches: who is searched", () => {
  it("always includes the caller, once", async () => {
    const e = await setup();
    const own = await search(e, hoursBody({ people: [] }));
    const listed = await search(e, hoursBody({ people: [e.me.id, e.me.id] }));
    for (const response of [own, listed]) {
      expect(response.statusCode).toBe(200);
      expect(response.json<SearchResult>().skipped).toEqual([{ personId: e.me.id, reason: "no_calendar" }]);
    }
  });

  it("searches the caller first, then the others in the order of the request, each once", async () => {
    const e = await setup();
    const result = (await search(e, hoursBody({ people: [e.ben.id, e.anna.id, e.ben.id] }))).json<SearchResult>();
    expect(result.skipped.map((s) => s.personId)).toEqual([e.me.id, e.ben.id, e.anna.id]);
  });

  it("leaves out somebody without a calendar and says why", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK);
    await addCalendar(e, e.ben.token, APPLE_LINK);
    const result = (await search(e, hoursBody({ people: [e.anna.id, e.ben.id] }))).json<SearchResult>();
    expect(result.skipped).toEqual([{ personId: e.anna.id, reason: "no_calendar" }]);
    if (result.mode !== "hours") throw new Error("hours expected");
    // The person without a calendar does not shrink the free times.
    expect(result.days).toHaveLength(1);
  });

  it("leaves out somebody whose calendar cannot be read, and does not count them as free", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK);
    await addCalendar(e, e.anna.token, APPLE_LINK, [busyOn("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")]);
    e.clock.advanceMinutes(16); // the calendars have to be fetched again
    e.feeds.fail(APPLE_LINK, "unreachable");
    const result = (await search(e, hoursBody({ people: [e.anna.id] }))).json<SearchResult>();
    expect(result.skipped).toEqual([{ personId: e.anna.id, reason: "unreadable" }]);
    if (result.mode !== "hours") throw new Error("hours expected");
    expect(result.days).toHaveLength(1);
  });

  it("leaves out somebody whose calendar is gone", async () => {
    const e = await setup();
    await addCalendar(e, e.anna.token, APPLE_LINK);
    e.clock.advanceMinutes(16);
    e.feeds.fail(APPLE_LINK, "gone");
    const result = (await search(e, hoursBody({ people: [e.anna.id] }))).json<SearchResult>();
    expect(result.skipped).toEqual([
      { personId: e.me.id, reason: "no_calendar" },
      { personId: e.anna.id, reason: "unreadable" },
    ]);
  });

  it("leaves out somebody when only one of several calendars cannot be read", async () => {
    const e = await setup();
    await addCalendar(e, e.anna.token, APPLE_LINK);
    await addCalendar(e, e.anna.token, OUTLOOK_LINK);
    e.clock.advanceMinutes(16);
    e.feeds.fail(OUTLOOK_LINK, "unreachable");
    const result = (await search(e, hoursBody({ people: [e.anna.id] }))).json<SearchResult>();
    expect(result.skipped).toContainEqual({ personId: e.anna.id, reason: "unreadable" });
  });

  it("leaves out somebody whose calendar was too big to be read completely", async () => {
    const e = await setup();
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:many@test", "DTSTAMP:20260101T000000Z",
      "DTSTART:20261102T080000Z", "DTEND:20261102T080100Z", "RRULE:FREQ=MINUTELY;COUNT=30000", "SUMMARY:Often",
      "END:VEVENT", "END:VCALENDAR", "",
    ];
    await addCalendar(e, e.anna.token, APPLE_LINK, lines.join("\r\n"));
    const result = (await search(e, hoursBody({ people: [e.anna.id] }))).json<SearchResult>();
    expect(result.skipped).toContainEqual({ personId: e.anna.id, reason: "unreadable" });
  });

  it("does not count a person with only a calendar that is not busy time as unreadable", async () => {
    const e = await setup();
    const calendar = await addCalendar(e, e.me.token, GOOGLE_LINK, [busyOn("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")]);
    expect((await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { countsAsBusy: false } })).statusCode).toBe(200);
    const result = (await search(e, hoursBody())).json<SearchResult>();
    expect(result.skipped).toEqual([]);
    if (result.mode !== "hours") throw new Error("hours expected");
    expect(result.days).toEqual([{ date: "2026-11-07", slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T22:00:00Z")] }]);
  });

  it("lets only events that are busy block, and only in calendars that count as busy", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK, [
      { start: "2026-11-07T10:00:00Z", end: "2026-11-07T11:00:00Z", summary: "Frei", free: true },
      busyOn("2026-11-07T12:00:00Z", "2026-11-07T13:00:00Z"),
    ]);
    const birthdays = await addCalendar(e, e.me.token, APPLE_LINK, [busyOn("2026-11-07T16:00:00Z", "2026-11-07T17:00:00Z", "Geburtstag")]);
    await call(e, "PATCH", `/api/calendars/${birthdays.id}`, { token: e.me.token, body: { countsAsBusy: false } });
    const result = (await search(e, hoursBody())).json<SearchResult>();
    if (result.mode !== "hours") throw new Error("hours expected");
    expect(result.days).toEqual([
      {
        date: "2026-11-07",
        slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T12:00:00Z"), slot("2026-11-07T13:00:00Z", "2026-11-07T22:00:00Z")],
      },
    ]);
  });

  it("does not read more than 8 calendars at the same time", async () => {
    const e = await setup();
    const links: string[] = [];
    for (const user of [e.me, e.anna]) {
      for (let i = 0; i < 10; i++) {
        const link = `https://kalender.example.org/${user.id}-${i}.ics`;
        links.push(link);
        await addCalendar(e, user.token, link);
      }
    }
    e.clock.advanceMinutes(16);
    let running = 0;
    let most = 0;
    for (const link of links) {
      e.feeds.set(link, async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return { ok: true, text: ics([]) };
      });
    }
    const response = await search(e, hoursBody({ people: [e.anna.id] }));
    expect(response.statusCode).toBe(200);
    expect(response.json<SearchResult>().skipped).toEqual([]);
    expect(most).toBe(8);
  });
});

describe("POST /api/searches: results", () => {
  it("finds the free times of three people in hours mode, with a near miss, and shows no calendar detail", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK, [busyOn("2026-11-07T10:00:00Z", "2026-11-07T12:00:00Z", "Zahnarzt")]);
    await addCalendar(e, e.anna.token, APPLE_LINK, [busyOn("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z", "Frühschicht")]);
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, [busyOn("2026-11-07T20:00:00Z", "2026-11-07T22:00:00Z", "Kino")]);
    const response = await search(e, hoursBody({ people: [e.anna.id, e.ben.id], bufferMinutes: 30 }));
    expect(response.statusCode).toBe(200);
    const result = response.json<SearchResult>();
    expect(result).toEqual({
      mode: "hours",
      skipped: [],
      days: [{ date: "2026-11-07", slots: [slot("2026-11-07T12:30:00Z", "2026-11-07T19:30:00Z")] }],
      nearMisses: [
        { date: "2026-11-07", missingPersonId: e.me.id, slots: [slot("2026-11-07T09:30:00Z", "2026-11-07T19:30:00Z")] },
        { date: "2026-11-07", missingPersonId: e.anna.id, slots: [slot("2026-11-07T08:00:00Z", "2026-11-07T09:30:00Z")] },
        { date: "2026-11-07", missingPersonId: e.ben.id, slots: [slot("2026-11-07T12:30:00Z", "2026-11-07T22:00:00Z")] },
      ],
    });
    for (const text of allStrings(result)) {
      expect(text).not.toMatch(/Zahnarzt|Frühschicht|Kino|secret|example/i);
    }
  });

  it("uses the default window and today only from now on", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK);
    // Sunday the 1st, 11:00 German time: the clock is on 10:00 UTC, the window runs to 22:00 UTC.
    const result = (await search(e, hoursBody({ from: "2026-11-01", to: "2026-11-02", weekdays: [7, 1] }))).json<SearchResult>();
    if (result.mode !== "hours") throw new Error("hours expected");
    expect(result.days).toEqual([
      { date: "2026-11-01", slots: [slot("2026-11-01T10:00:00Z", "2026-11-01T22:00:00Z")] },
      { date: "2026-11-02", slots: [slot("2026-11-02T08:00:00Z", "2026-11-02T22:00:00Z")] },
    ]);
  });

  it("finds free stretches of days for three people, with a near miss", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK);
    // 12:00 UTC is 13:00 German time on the 4th: a busy day for Anna.
    await addCalendar(e, e.anna.token, APPLE_LINK, [busyOn("2026-11-04T12:00:00Z", "2026-11-04T13:00:00Z", "Termin")]);
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, [{ start: "2026-11-08", end: "2026-11-09", summary: "Urlaubstag" }]);
    const response = await search(e, daysBody({ people: [e.anna.id, e.ben.id], to: "2026-11-10", days: 2 }));
    expect(response.statusCode).toBe(200);
    expect(response.json<SearchResult>()).toEqual({
      mode: "days",
      skipped: [],
      stretches: [
        { first: "2026-11-02", last: "2026-11-03", days: 2 },
        { first: "2026-11-05", last: "2026-11-07", days: 3 },
        { first: "2026-11-09", last: "2026-11-10", days: 2 },
      ],
      // Without Anna (busy on the 4th) the 2nd to 7th are free, without Ben (away on the 8th) the 5th to 10th.
      nearMisses: [
        { first: "2026-11-02", last: "2026-11-07", days: 6, missingPersonId: e.anna.id },
        { first: "2026-11-05", last: "2026-11-10", days: 6, missingPersonId: e.ben.id },
      ],
    });
  });

  it("gives the start days when a start weekday is asked for", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK);
    const result = (await search(e, daysBody({ to: "2026-11-16", days: 3, startWeekday: 6 }))).json<SearchResult>();
    expect(result).toMatchObject({
      mode: "days",
      stretches: [{ first: "2026-11-02", last: "2026-11-16", days: 15, starts: ["2026-11-07", "2026-11-14"] }],
    });
  });

  it("returns empty lists and the skipped people when nobody can be read", async () => {
    const e = await setup();
    const hours = await search(e, hoursBody({ people: [e.anna.id] }));
    expect(hours.json<SearchResult>()).toEqual({
      mode: "hours",
      skipped: [
        { personId: e.me.id, reason: "no_calendar" },
        { personId: e.anna.id, reason: "no_calendar" },
      ],
      days: [],
      nearMisses: [],
    });
    const days = await search(e, daysBody({ people: [e.anna.id] }));
    expect(days.json<SearchResult>()).toMatchObject({ mode: "days", stretches: [], nearMisses: [] });
  });
});

describe("POST /api/searches: limits", () => {
  it("allows 30 searches per person in 15 minutes and blocks the 31st, whatever their result", async () => {
    const e = await setup();
    for (let i = 0; i < 30; i++) {
      const response = await search(e, i % 2 === 0 ? hoursBody() : daysBody());
      expect(response.statusCode, `search ${i + 1}`).toBe(200);
    }
    const blocked = await search(e, hoursBody());
    expect(blocked.statusCode).toBe(429);
    expect(code(blocked)).toBe("rate_limited");
    expect(blocked.json<ApiErrorBody>().retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // Others are not affected.
    expect((await search(e, hoursBody(), e.anna.token)).statusCode).toBe(200);
  });

  it("lets the person search again when the window has passed", async () => {
    const e = await setup();
    for (let i = 0; i < 30; i++) await search(e, hoursBody());
    expect((await search(e, hoursBody())).statusCode).toBe(429);
    e.clock.advanceMinutes(16);
    expect((await search(e, hoursBody())).statusCode).toBe(200);
  });

  it("answers 503 calendars_unavailable when the server cannot use calendars", async () => {
    const e = await setup({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const response = await search(e, hoursBody());
    expect(response.statusCode).toBe(503);
    expect(code(response)).toBe("calendars_unavailable");
    expect(e.feeds.calls).toEqual([]);
  });
});
