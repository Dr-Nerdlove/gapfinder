import {
  POLL_CALENDAR_CHECKS_PER_CALLER,
  type ApiErrorBody,
  type PollCalendarCheck,
  type PollView,
} from "@lueckenfueller/shared";
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

// The test clock starts on Sunday 2026-11-01 at 10:00 UTC.
async function setup(overrides: Parameters<typeof createCalendarEnv>[0] = {}) {
  env = await createCalendarEnv(overrides);
  const me = await addUserWithSession(env, "Vincent R.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  const outsider = await addUserWithSession(env, "Olga O.");
  return { ...env, me, anna, ben, outsider };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const SLOT_A = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };
const SLOT_B = { start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" };
const busyA: FakeEvent = { start: "2026-11-07T18:00:00Z", end: "2026-11-07T18:30:00Z", summary: "Geheimer Termin" };

async function addCalendar(e: Setup, token: string, link: string, events: FakeEvent[] = []) {
  e.feeds.set(link, ics(events));
  const response = await call(e, "POST", "/api/calendars", { token, body: { link } });
  expect(response.statusCode, response.body).toBe(201);
}

async function createPoll(e: Setup, participants: number[]): Promise<PollView> {
  const response = await call(e, "POST", "/api/polls", {
    token: e.me.token,
    body: { title: "Spieleabend", kind: "timed", proposals: [SLOT_A, SLOT_B], participants },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PollView>();
}

const checkUrl = (poll: { shareToken: string }) => `/api/poll-links/${poll.shareToken}/calendar-check`;
const names = (check: PollCalendarCheck) => check.skipped.map((s) => `${s.person.username}:${s.reason}`);

/** me: free. anna: busy during the first proposal. ben: no calendar. */
async function checkSetup() {
  const e = await setup();
  await addCalendar(e, e.me.token, GOOGLE_LINK);
  await addCalendar(e, e.anna.token, APPLE_LINK, [busyA]);
  const poll = await createPoll(e, [e.anna.id, e.ben.id]);
  return { e, poll };
}

describe("the calendar check of a poll", () => {
  it("gives a guest the list of people left out and no own result", async () => {
    const { e, poll } = await checkSetup();
    const response = await call(e, "GET", checkUrl(poll));
    expect(response.statusCode, response.body).toBe(200);
    const check = response.json<PollCalendarCheck>();
    expect(names(check)).toEqual(["ben m.:no_calendar"]);
    expect(check.mine).toBeNull();
    expect(response.body).not.toContain("Geheimer Termin");
    expect(allStrings(JSON.parse(response.body)).join(" ")).not.toMatch(/secret|calendar\.google|icloud/i);
  });

  it("tells a logged-in participant which proposals are busy in their own calendar", async () => {
    const { e, poll } = await checkSetup();
    const check = (await call(e, "GET", checkUrl(poll), { token: e.anna.token })).json<PollCalendarCheck>();
    expect(check.mine).toEqual({ readable: true, busyProposalIds: [poll.proposals[0]!.id] });
    const free = (await call(e, "GET", checkUrl(poll), { token: e.me.token })).json<PollCalendarCheck>();
    expect(free.mine).toEqual({ readable: true, busyProposalIds: [] });
  });

  it("lists an unreadable calendar and answers for a caller without a calendar", async () => {
    const { e, poll } = await checkSetup();
    await addCalendar(e, e.ben.token, OUTLOOK_LINK);
    e.feeds.fail(OUTLOOK_LINK, "unreachable");
    e.clock.advanceMinutes(20);
    const check = (await call(e, "GET", checkUrl(poll), { token: e.outsider.token })).json<PollCalendarCheck>();
    expect(names(check)).toEqual(["ben m.:unreadable"]);
    expect(check.mine).toEqual({ readable: false, reason: "no_calendar" });
    const ben = (await call(e, "GET", checkUrl(poll), { token: e.ben.token })).json<PollCalendarCheck>();
    expect(ben.mine).toEqual({ readable: false, reason: "unreadable" });
  });

  it("works for a caller who is not a participant, and while the poll is closed", async () => {
    const { e, poll } = await checkSetup();
    await addCalendar(e, e.outsider.token, OUTLOOK_LINK, [busyA]);
    await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: { closed: true } });
    const response = await call(e, "GET", checkUrl(poll), { token: e.outsider.token });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<PollCalendarCheck>().mine).toEqual({ readable: true, busyProposalIds: [poll.proposals[0]!.id] });
    expect(names(response.json<PollCalendarCheck>())).toEqual(["ben m.:no_calendar"]);
  });

  it("answers an unknown link with 404 poll_invalid", async () => {
    const { e } = await checkSetup();
    const response = await call(e, "GET", "/api/poll-links/nope/calendar-check");
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>().code).toBe("poll_invalid");
  });

  it("needs the calendar key", async () => {
    const e = await setup({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const poll = await createPoll(e, [e.anna.id]);
    const response = await call(e, "GET", checkUrl(poll));
    expect(response.statusCode).toBe(503);
    expect(response.json<ApiErrorBody>().code).toBe("calendars_unavailable");
  });

  it("is limited per caller in its own bucket: every call counts", async () => {
    const { e, poll } = await checkSetup();
    for (let i = 0; i < POLL_CALENDAR_CHECKS_PER_CALLER; i++) {
      expect((await call(e, "GET", checkUrl(poll), { token: e.me.token })).statusCode).toBe(200);
    }
    const blocked = await call(e, "GET", checkUrl(poll), { token: e.me.token });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>().code).toBe("rate_limited");
    // Another caller and the search bucket are untouched.
    expect((await call(e, "GET", checkUrl(poll), { token: e.anna.token })).statusCode).toBe(200);
  });
});
