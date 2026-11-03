import {
  SEARCHES_PER_USER,
  type ApiErrorBody,
  type FixCheck,
  type GuestVoteCreated,
  type PollList,
  type PollView,
  type VoteAnswer,
} from "@lueckenfueller/shared";
import ICAL from "ical.js";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_FAILURES_PER_IP } from "../src/auth/rate-limit.js";
import {
  APPLE_LINK,
  createCalendarEnv,
  GOOGLE_LINK,
  ics,
  OUTLOOK_LINK,
  OTHER_LINK,
  type CalendarEnv,
  type FakeEvent,
} from "./calendar-helpers.js";
import { addUserWithSession, allStrings, call } from "./helpers.js";

let env: CalendarEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

// The test clock starts on Sunday 2026-11-01 at 10:00 UTC (11:00 German time, CET).
async function setup(overrides: Parameters<typeof createCalendarEnv>[0] = {}) {
  env = await createCalendarEnv(overrides);
  const me = await addUserWithSession(env, "Vincent R.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  return { ...env, me, anna, ben, admin };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const code = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().code;
const field = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().field;

const SLOT_A = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };
const SLOT_B = { start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" };

function timedBody(overrides: Record<string, unknown> = {}) {
  return { title: "Spieleabend", kind: "timed", proposals: [SLOT_A, SLOT_B], participants: [] as number[], ...overrides };
}
function daysBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Wochenende",
    kind: "days",
    proposals: [
      { first: "2026-11-10", last: "2026-11-10" },
      { first: "2026-11-20", last: "2026-11-22" },
    ],
    participants: [] as number[],
    ...overrides,
  };
}

async function createPoll(e: Setup, body: unknown = timedBody(), token = e.me.token): Promise<PollView> {
  const response = await call(e, "POST", "/api/polls", { token, body });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PollView>();
}

const link = (poll: { shareToken: string }) => `/api/poll-links/${poll.shareToken}`;
const fixedUrl = (poll: { id: number }) => `/api/polls/${poll.id}/fixed`;
const checkUrl = (poll: { id: number }) => `/api/polls/${poll.id}/fix-check`;

function answersFor(poll: PollView, answer: VoteAnswer | VoteAnswer[] = "yes") {
  return poll.proposals.map((p, i) => ({ proposalId: p.id, answer: Array.isArray(answer) ? answer[i]! : answer }));
}

const accountVote = (e: Setup, poll: PollView, token: string, answer: VoteAnswer | VoteAnswer[] = "yes") =>
  call(e, "PUT", `${link(poll)}/my-vote`, { token, body: { answers: answersFor(poll, answer) } });

const guestVote = (e: Setup, poll: PollView, name: string) =>
  call(e, "POST", `${link(poll)}/votes`, { body: { name, answers: answersFor(poll) } });

async function fix(e: Setup, poll: PollView, proposalIndex: number, token = e.me.token) {
  return call(e, "PUT", fixedUrl(poll), { token, body: { proposalId: poll.proposals[proposalIndex]!.id } });
}

const pollRow = (e: Setup, id: number) =>
  e.db.prepare("SELECT fixed_proposal_id, fixed_at, fixed_sequence, updated_at FROM polls WHERE id = ?").get(id) as {
    fixed_proposal_id: number | null;
    fixed_at: string | null;
    fixed_sequence: number;
    updated_at: string;
  };

describe("fixing the date", () => {
  it("shows the times of the fixed proposal in the list, follows a change and goes back to null", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const listed = async () => (await call(e, "GET", "/api/polls", { token: e.me.token })).json<PollList>().polls[0]!;
    expect((await listed()).fixedProposal).toBeNull();

    expect((await fix(e, poll, 0)).statusCode).toBe(200);
    expect((await listed()).fixedProposal).toEqual(poll.proposals[0]);
    expect((await fix(e, poll, 1)).statusCode).toBe(200);
    expect((await listed()).fixedProposal).toEqual(poll.proposals[1]);
    expect((await call(e, "DELETE", `/api/polls/${poll.id}/fixed`, { token: e.me.token })).statusCode).toBe(200);
    expect((await listed()).fixedProposal).toBeNull();
  });

  it("shows a fixed poll of whole days in the list as first and last day", async () => {
    const e = await setup();
    const poll = await createPoll(e, daysBody());
    expect((await fix(e, poll, 1)).statusCode).toBe(200);
    const [summary] = (await call(e, "GET", "/api/polls", { token: e.me.token })).json<PollList>().polls;
    expect(summary!.fixedProposal).toEqual({ id: poll.proposals[1]!.id, first: "2026-11-20", last: "2026-11-22" });
  });

  it("fixes a proposal: the view, the summary and the share link show it, and the poll does not take votes", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    expect(poll).toMatchObject({ fixedProposalId: null, fixedAt: null, open: true });

    e.clock.advanceMinutes(5);
    const response = await fix(e, poll, 1);
    expect(response.statusCode, response.body).toBe(200);
    const fixed = response.json<PollView>();
    expect(fixed).toMatchObject({
      fixedProposalId: poll.proposals[1]!.id,
      fixedAt: "2026-11-01T10:05:00.000Z",
      open: false,
      closed: false,
      canManage: true,
    });

    const list = (await call(e, "GET", "/api/polls", { token: e.me.token })).json<PollList>();
    expect(list.polls[0]).toMatchObject({ fixedProposalId: poll.proposals[1]!.id, open: false });
    expect(list.polls[0]!.fixedProposal).toEqual(poll.proposals[1]);
    const viewed = (await call(e, "GET", link(poll))).json<PollView>();
    expect(viewed).toMatchObject({ fixedProposalId: poll.proposals[1]!.id, fixedAt: "2026-11-01T10:05:00.000Z", open: false });
    expect(pollRow(e, poll.id)).toMatchObject({ fixed_sequence: 1, updated_at: "2026-11-01T10:05:00.000Z" });
  });

  it("changes the fixed date to another proposal and counts the change", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await fix(e, poll, 0);
    e.clock.advanceMinutes(10);
    const changed = (await fix(e, poll, 1)).json<PollView>();
    expect(changed).toMatchObject({ fixedProposalId: poll.proposals[1]!.id, fixedAt: "2026-11-01T10:10:00.000Z" });
    expect(pollRow(e, poll.id).fixed_sequence).toBe(2);
  });

  it("changes nothing but updatedAt when the same proposal is fixed again", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await fix(e, poll, 0);
    e.clock.advanceMinutes(10);
    const again = await fix(e, poll, 0);
    expect(again.statusCode).toBe(200);
    expect(again.json<PollView>().fixedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(pollRow(e, poll.id)).toMatchObject({ fixed_sequence: 1, updated_at: "2026-11-01T10:10:00.000Z" });
  });

  it("takes the fixed date back: the poll takes votes again, and a poll that was never fixed is fine", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const notFixed = await call(e, "DELETE", fixedUrl(poll), { token: e.me.token });
    expect(notFixed.statusCode).toBe(200);
    expect(notFixed.json<PollView>()).toMatchObject({ fixedProposalId: null, open: true });
    expect(pollRow(e, poll.id).fixed_sequence).toBe(0);

    await fix(e, poll, 0);
    const removed = await call(e, "DELETE", fixedUrl(poll), { token: e.me.token });
    expect(removed.json<PollView>()).toMatchObject({ fixedProposalId: null, fixedAt: null, open: true });
    expect(pollRow(e, poll.id)).toMatchObject({ fixed_proposal_id: null, fixed_at: null, fixed_sequence: 2 });
    // Fixing the same proposal after taking it back is a new change.
    await fix(e, poll, 0);
    expect(pollRow(e, poll.id).fixed_sequence).toBe(3);
  });

  it("keeps closed by hand and the deadline separate from the fixed date", async () => {
    const e = await setup();
    const byHand = await createPoll(e);
    await call(e, "PATCH", `/api/polls/${byHand.id}`, { token: e.me.token, body: { closed: true } });
    await fix(e, byHand, 0);
    const reopened = (await call(e, "DELETE", fixedUrl(byHand), { token: e.me.token })).json<PollView>();
    expect(reopened).toMatchObject({ closed: true, open: false, fixedProposalId: null });

    const withDeadline = await createPoll(e, timedBody({ deadline: "2026-11-03T12:00:00Z" }));
    await fix(e, withDeadline, 0);
    e.clock.advanceDays(3);
    const afterDeadline = (await call(e, "DELETE", fixedUrl(withDeadline), { token: e.me.token })).json<PollView>();
    expect(afterDeadline).toMatchObject({ closed: false, open: false, fixedProposalId: null });
  });

  it("refuses every vote write on a fixed poll with poll_closed and accepts them again after taking it back", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const mia = (await guestVote(e, poll, "Mia")).json<GuestVoteCreated>();
    expect((await accountVote(e, poll, e.anna.token)).statusCode).toBe(200);
    await fix(e, poll, 0);

    const guestUrl = `${link(poll)}/votes/${mia.voteId}`;
    const keyHeader = { "x-vote-key": mia.voteKey };
    const writes = [
      await accountVote(e, poll, e.ben.token),
      await call(e, "DELETE", `${link(poll)}/my-vote`, { token: e.anna.token }),
      await guestVote(e, poll, "Tom"),
      await call(e, "PUT", guestUrl, { headers: keyHeader, body: { name: "Mia", answers: answersFor(poll, "no") } }),
      await call(e, "DELETE", guestUrl, { headers: keyHeader }),
    ];
    for (const response of writes) {
      expect(response.statusCode, response.body).toBe(409);
      expect(code(response)).toBe("poll_closed");
    }
    // The votes are still there, and the creator can still remove one.
    expect((await call(e, "GET", link(poll))).json<PollView>().votes.map((v) => v.name)).toEqual(["Anna K.", "Mia"]);

    await call(e, "DELETE", fixedUrl(poll), { token: e.me.token });
    expect((await accountVote(e, poll, e.ben.token)).statusCode).toBe(200);
    expect((await guestVote(e, poll, "Tom")).statusCode).toBe(201);
    expect((await call(e, "DELETE", guestUrl, { headers: keyHeader })).statusCode).toBe(200);
  });

  it("is allowed for the creator and an admin only", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ participants: [e.anna.id] }));
    const body = { proposalId: poll.proposals[0]!.id };
    const routes: [("PUT" | "DELETE" | "POST"), string, unknown][] = [
      ["PUT", fixedUrl(poll), body],
      ["DELETE", fixedUrl(poll), undefined],
      ["POST", checkUrl(poll), body],
    ];
    for (const [method, url, payload] of routes) {
      for (const other of [e.anna, e.ben]) {
        const response = await call(e, method, url, { token: other.token, body: payload });
        expect(response.statusCode, `${method} ${url}`).toBe(403);
        expect(code(response)).toBe("forbidden");
      }
      expect((await call(e, method, url, { body: payload })).statusCode).toBe(401);
      const missing = await call(e, method, url.replace(`/${poll.id}/`, "/99999/"), { token: e.me.token, body: payload });
      expect(missing.statusCode).toBe(404);
      expect(code(missing)).toBe("not_found");
    }
    expect(pollRow(e, poll.id).fixed_proposal_id).toBeNull();

    const byAdmin = await fix(e, poll, 1, e.admin.token);
    expect(byAdmin.statusCode).toBe(200);
    expect(byAdmin.json<PollView>().fixedProposalId).toBe(poll.proposals[1]!.id);
    expect((await call(e, "DELETE", fixedUrl(poll), { token: e.admin.token })).statusCode).toBe(200);
  });

  it("answers 404 for an expired poll", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await fix(e, poll, 0);
    e.clock.advanceDays(60);
    expect((await fix(e, poll, 0)).statusCode).toBe(404);
    expect((await call(e, "DELETE", fixedUrl(poll), { token: e.me.token })).statusCode).toBe(404);
  });

  it.each([
    ["no proposalId", {}],
    ["a proposalId that is not a number", { proposalId: "1" }],
    ["a proposalId that is not a whole number", { proposalId: 1.5 }],
    ["a proposalId that does not exist", { proposalId: 99999 }],
  ])("refuses %s with validation for proposalId", async (_name, body) => {
    const e = await setup();
    const poll = await createPoll(e);
    for (const url of [fixedUrl(poll), checkUrl(poll)]) {
      const response = await call(e, url.endsWith("fixed") ? "PUT" : "POST", url, { token: e.me.token, body });
      expect(response.statusCode, url).toBe(400);
      expect(code(response)).toBe("validation");
      expect(field(response)).toBe("proposalId");
    }
    expect(pollRow(e, poll.id).fixed_proposal_id).toBeNull();
  });

  it("refuses a proposal of another poll", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const other = await createPoll(e, timedBody({ title: "Anderes" }));
    const response = await call(e, "PUT", fixedUrl(poll), { token: e.me.token, body: { proposalId: other.proposals[0]!.id } });
    expect(response.statusCode).toBe(400);
    expect(field(response)).toBe("proposalId");
  });
});

describe("the check before fixing", () => {
  const busy = (start: string, end: string, extra: Partial<FakeEvent> = {}): FakeEvent => ({
    start,
    end,
    summary: "Geheimer Termin",
    ...extra,
  });

  async function addCalendar(e: Setup, token: string, link: string, events: FakeEvent[] | string = []) {
    e.feeds.set(link, typeof events === "string" ? events : ics(events));
    const response = await call(e, "POST", "/api/calendars", { token, body: { link } });
    expect(response.statusCode, response.body).toBe(201);
  }

  /** me: free. anna: busy 18:00-18:30 on Saturday 2026-11-07. ben: unreadable. admin: no calendar. */
  async function checkSetup() {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK, []);
    await addCalendar(e, e.anna.token, APPLE_LINK, [busy("2026-11-07T18:00:00Z", "2026-11-07T18:30:00Z")]);
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, []);
    e.feeds.fail(OUTLOOK_LINK, "unreachable");
    // The fetched contents are cached for 15 minutes: let them go so that the broken link is read again.
    e.clock.advanceMinutes(20);
    const poll = await createPoll(e, timedBody({ participants: [e.anna.id, e.ben.id, e.admin.id] }));
    return { e, poll };
  }

  const check = (e: Setup, poll: PollView, index: number, token = e.me.token) =>
    call(e, "POST", checkUrl(poll), { token, body: { proposalId: poll.proposals[index]!.id } });
  const names = (people: FixCheck["busy"]) => people.map((p) => p.username);

  it("tells who is busy, whose calendar cannot be read and who has none", async () => {
    const { e, poll } = await checkSetup();
    const response = await check(e, poll, 0);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<FixCheck>();
    expect(result.proposalId).toBe(poll.proposals[0]!.id);
    expect(names(result.busy)).toEqual(["Anna K."]);
    expect(names(result.unreadable)).toEqual(["ben m."]);
    expect(names(result.noCalendar)).toEqual(["Admin A."]);
    expect(Object.keys(result.busy[0]!).sort()).toEqual(["id", "seedColor", "username"]);
  });

  it("finds nobody busy for a proposal at another time, and never shows titles or times", async () => {
    const { e, poll } = await checkSetup();
    const response = await check(e, poll, 1);
    expect(response.json<FixCheck>().busy).toEqual([]);
    const busyResponse = await check(e, poll, 0);
    for (const text of [response.body, busyResponse.body]) {
      expect(text).not.toContain("Geheimer Termin");
      expect(text).not.toContain("18:00");
      expect(allStrings(JSON.parse(text)).join(" ")).not.toMatch(/secret|calendar\.google|icloud/i);
    }
  });

  it("reads the calendars of the participants, not those of other people", async () => {
    const e = await setup();
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, [busy("2026-11-07T17:30:00Z", "2026-11-07T18:00:00Z")]);
    const poll = await createPoll(e, timedBody());
    const result = (await check(e, poll, 0)).json<FixCheck>();
    expect(result.busy).toEqual([]);
    expect(names(result.noCalendar)).toEqual(["Vincent R."]);
    expect(e.feeds.callsFor(OUTLOOK_LINK)).toBe(1); // only the one from adding it
  });

  it("counts busy times that overlap the proposal, not those that only touch it or are free", async () => {
    const e = await setup();
    await addCalendar(e, e.me.token, GOOGLE_LINK, [
      busy("2026-11-07T16:00:00Z", "2026-11-07T17:00:00Z"), // ends when the proposal starts
      busy("2026-11-07T19:00:00Z", "2026-11-07T20:00:00Z"), // starts when it ends
      busy("2026-11-07T17:30:00Z", "2026-11-07T18:30:00Z", { free: true }),
    ]);
    await addCalendar(e, e.anna.token, APPLE_LINK, [busy("2026-11-07T16:00:00Z", "2026-11-07T17:01:00Z")]);
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, [busy("2026-11-07T18:59:00Z", "2026-11-07T20:00:00Z")]);
    await addCalendar(e, e.admin.token, OTHER_LINK, [busy("2026-11-07T10:00:00Z", "2026-11-08T10:00:00Z")]);
    const poll = await createPoll(e, timedBody({ participants: [e.anna.id, e.ben.id, e.admin.id] }));
    const result = (await check(e, poll, 0)).json<FixCheck>();
    expect(names(result.busy)).toEqual(["Admin A.", "Anna K.", "ben m."]);
    expect(result.unreadable).toEqual([]);
  });

  it("checks whole days from German midnight to German midnight, across the UTC date change", async () => {
    const e = await setup();
    // The proposal is Tuesday 2026-11-10: 2026-11-09T23:00Z (00:00 CET) until 2026-11-10T23:00Z.
    await addCalendar(e, e.me.token, GOOGLE_LINK, [busy("2026-11-09T22:00:00Z", "2026-11-09T23:00:00Z")]); // before, touching
    await addCalendar(e, e.anna.token, APPLE_LINK, [busy("2026-11-09T22:30:00Z", "2026-11-09T23:15:00Z")]); // starts the evening before, overlaps 15 minutes
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, [busy("2026-11-10T22:45:00Z", "2026-11-11T08:00:00Z")]); // overlaps the last 15 minutes
    await addCalendar(e, e.admin.token, OTHER_LINK, [busy("2026-11-10T23:00:00Z", "2026-11-11T08:00:00Z")]); // after, touching
    const poll = await createPoll(e, daysBody({ participants: [e.anna.id, e.ben.id, e.admin.id] }));
    const result = (await check(e, poll, 0)).json<FixCheck>();
    expect(names(result.busy)).toEqual(["Anna K.", "ben m."]);
    expect(result.noCalendar).toEqual([]);
  });

  it("counts an all-day event on one of the days as busy and checks several days", async () => {
    const e = await setup();
    await addCalendar(e, e.anna.token, APPLE_LINK, [busy("2026-11-22", "2026-11-23")]);
    await addCalendar(e, e.ben.token, OUTLOOK_LINK, [busy("2026-11-23", "2026-11-24")]);
    const poll = await createPoll(e, daysBody({ participants: [e.anna.id, e.ben.id] }));
    const result = (await check(e, poll, 1)).json<FixCheck>();
    expect(names(result.busy)).toEqual(["Anna K."]);
    expect(names((await check(e, poll, 0)).json<FixCheck>().busy)).toEqual([]);
  });

  it("uses the hour switch for a timed date and the day switch for a whole-day date", async () => {
    const e = await setup();
    const patch = (id: number, body: object) => call(e, "PATCH", `/api/calendars/${id}`, { token: e.anna.token, body });
    const list = async () => (await call(e, "GET", "/api/calendars", { token: e.anna.token })).json<{ calendars: { id: number }[] }>();
    // Busy on Saturday 2026-11-07 18:00 (timed proposal) and on 2026-11-10 (whole-day proposal).
    await addCalendar(e, e.anna.token, APPLE_LINK, [
      busy("2026-11-07T18:00:00Z", "2026-11-07T18:30:00Z"),
      busy("2026-11-10", "2026-11-11"),
    ]);
    const id = (await list()).calendars[0]!.id;
    const timed = await createPoll(e, timedBody({ participants: [e.anna.id] }));
    const days = await createPoll(e, daysBody({ participants: [e.anna.id] }));

    // Hours on, days off.
    await patch(id, { countsAsBusyDays: false });
    expect(names((await check(e, timed, 0)).json<FixCheck>().busy)).toEqual(["Anna K."]);
    expect(names((await check(e, days, 0)).json<FixCheck>().busy)).toEqual([]);

    // The reverse.
    await patch(id, { countsAsBusy: false, countsAsBusyDays: true });
    expect(names((await check(e, timed, 0)).json<FixCheck>().busy)).toEqual([]);
    expect(names((await check(e, days, 0)).json<FixCheck>().busy)).toEqual(["Anna K."]);
  });

  it("is only a warning: the date can be fixed afterwards", async () => {
    const { e, poll } = await checkSetup();
    expect((await check(e, poll, 0)).json<FixCheck>().busy).toHaveLength(1);
    expect((await fix(e, poll, 0)).statusCode).toBe(200);
  });

  it("needs the calendar key", async () => {
    const e = await setup({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const poll = await createPoll(e);
    const response = await check(e, poll, 0);
    expect(response.statusCode).toBe(503);
    expect(code(response)).toBe("calendars_unavailable");
  });

  it("is limited like a search: every call counts, in the same bucket", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    expect(SEARCHES_PER_USER).toBe(30);
    for (let i = 0; i < SEARCHES_PER_USER - 1; i++) {
      expect((await check(e, poll, i % 2)).statusCode, `check ${i + 1}`).toBe(200);
    }
    // A search uses the last place of the same bucket.
    const search = await call(e, "POST", "/api/searches", {
      token: e.me.token,
      body: { mode: "days", people: [], from: "2026-11-02", to: "2026-11-08", days: 3 },
    });
    expect(search.statusCode).toBe(200);
    const blocked = await check(e, poll, 0);
    expect(blocked.statusCode).toBe(429);
    expect(code(blocked)).toBe("rate_limited");
    expect(blocked.json<ApiErrorBody>().retryAfterSeconds).toBeGreaterThan(0);
    // Others are not affected, and later the person can check again.
    expect((await call(e, "POST", checkUrl(poll), { token: e.admin.token, body: { proposalId: poll.proposals[0]!.id } })).statusCode).toBe(200);
    e.clock.advanceMinutes(16);
    expect((await check(e, poll, 0)).statusCode).toBe(200);
  });
});

describe("the calendar file of the fixed date", () => {
  const download = (e: Setup, poll: { shareToken: string }, options: { token?: string; ip?: string } = {}) =>
    call(e, "GET", `${link(poll)}/event.ics`, options);

  function parse(text: string) {
    const calendar = new ICAL.Component(ICAL.parse(text));
    return calendar.getAllSubcomponents("vevent").map((vevent) => new ICAL.Event(vevent));
  }

  it("sends the fixed date as a download to everybody with the link, guests too", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ note: "Bei mir, Küche; Tür 2" }));
    e.clock.advanceMinutes(5);
    await fix(e, poll, 1);

    for (const options of [{}, { token: e.anna.token }, { token: "not a valid login" }]) {
      const response = await download(e, poll, options);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["content-type"]).toBe("text/calendar; charset=utf-8");
      expect(response.headers["content-disposition"]).toBe('attachment; filename="termin.ics"');
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
      const [event] = parse(response.body);
      expect(event!.uid).toBe(`poll-${poll.id}@lueckenfueller`);
      expect(event!.summary).toBe("Spieleabend");
      expect(event!.description).toBe("Bei mir, Küche; Tür 2");
      expect(event!.startDate.toJSDate().toISOString()).toBe(SLOT_B.start);
      expect(event!.endDate.toJSDate().toISOString()).toBe(SLOT_B.end);
      expect(event!.sequence).toBe(1);
      expect(event!.component.getFirstPropertyValue("dtstamp")?.toString()).toBe("2026-11-01T10:05:00Z");
    }
  });

  it("sends a poll of days as a whole-day event that ends the day after the last day", async () => {
    const e = await setup();
    const poll = await createPoll(e, daysBody());
    await fix(e, poll, 1);
    const response = await download(e, poll);
    expect(response.body).toContain("DTSTART;VALUE=DATE:20261120\r\n");
    expect(response.body).toContain("DTEND;VALUE=DATE:20261123\r\n");
    expect(response.body).not.toContain("DESCRIPTION");
    const [event] = parse(response.body);
    expect(event!.startDate.isDate).toBe(true);
  });

  it("follows a change of the fixed date with a higher sequence", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await fix(e, poll, 0);
    await fix(e, poll, 1);
    const [event] = parse((await download(e, poll)).body);
    expect(event!.startDate.toJSDate().toISOString()).toBe(SLOT_B.start);
    expect(event!.sequence).toBe(2);
  });

  it("answers 409 poll_not_fixed while there is no fixed date, and again after taking it back", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    for (const step of ["before", "after"]) {
      const response = await download(e, poll);
      expect(response.statusCode, step).toBe(409);
      expect(code(response)).toBe("poll_not_fixed");
      await fix(e, poll, 0);
      expect((await download(e, poll)).statusCode).toBe(200);
      await call(e, "DELETE", fixedUrl(poll), { token: e.me.token });
    }
  });

  it("treats a wrong, replaced or expired link like the share link: poll_invalid, counted against the address", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await fix(e, poll, 0);
    const renewed = (await call(e, "POST", `/api/polls/${poll.id}/share-link`, { token: e.me.token })).json<{ shareToken: string }>();
    const old = await download(e, poll);
    expect(old.statusCode).toBe(404);
    expect(code(old)).toBe("poll_invalid");
    expect((await download(e, renewed)).statusCode).toBe(200);

    for (let i = 0; i < TOKEN_FAILURES_PER_IP - 1; i++) {
      expect((await call(e, "GET", `/api/poll-links/wrong-${i}/event.ics`)).statusCode).toBe(404);
    }
    // 30 misses in all (the replaced link counted): the address is blocked, for downloads and for the share link.
    expect((await download(e, renewed)).statusCode).toBe(429);
    expect((await call(e, "GET", link(renewed))).statusCode).toBe(429);
    expect((await download(e, renewed, { ip: "10.0.0.9" })).statusCode).toBe(200);

    e.clock.advanceDays(60);
    const expired = await download(e, renewed, { ip: "10.0.0.9" });
    expect(expired.statusCode).toBe(404);
    expect(code(expired)).toBe("poll_invalid");
  });
});
