import {
  GUEST_VOTE_WRITES_PER_IP,
  POLL_MAX_GUEST_VOTES,
  POLLS_PER_USER,
  usernameKey,
  type ApiErrorBody,
  type GuestVoteCreated,
  type NewShareLink,
  type PollList,
  type PollView,
  type VoteAnswer,
} from "@lueckenfueller/shared";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { purgeExpired } from "../src/accounts/cleanup.js";
import { updateUsername } from "../src/accounts/users.js";
import { TOKEN_FAILURES_PER_IP } from "../src/auth/rate-limit.js";
import { hashToken } from "../src/auth/tokens.js";
import { insertGuestVote } from "../src/polls/store.js";
import { addUser, addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

// The test clock starts on Sunday 2026-11-01 at 10:00 UTC (11:00 German time, CET).
async function setup(overrides: Parameters<typeof createTestEnv>[0] = {}, options: Parameters<typeof createTestEnv>[1] = {}) {
  env = await createTestEnv(overrides, options);
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
      { first: "2026-11-02", last: "2026-11-03" },
      { first: "2026-11-10", last: "2026-11-10" },
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

function answersFor(poll: PollView, answer: VoteAnswer | VoteAnswer[] = "yes") {
  return poll.proposals.map((p, i) => ({ proposalId: p.id, answer: Array.isArray(answer) ? answer[i]! : answer }));
}

async function accountVote(e: Setup, poll: PollView, token: string, answer: VoteAnswer | VoteAnswer[] = "yes") {
  return call(e, "PUT", `${link(poll)}/my-vote`, { token, body: { answers: answersFor(poll, answer) } });
}

async function guestVote(e: Setup, poll: PollView, name: string, answer: VoteAnswer | VoteAnswer[] = "yes", ip?: string) {
  return call(e, "POST", `${link(poll)}/votes`, { body: { name, answers: answersFor(poll, answer) }, ...(ip ? { ip } : {}) });
}

async function castGuest(e: Setup, poll: PollView, name: string, answer: VoteAnswer = "yes"): Promise<GuestVoteCreated> {
  const response = await guestVote(e, poll, name, answer);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<GuestVoteCreated>();
}

const keyHeader = (key: string) => ({ "x-vote-key": key });

describe("creating polls", () => {
  it("creates a timed poll with the documented view and makes the creator a participant", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ note: "  Bei mir\r\nzuhause  ", deadline: "2026-11-05T12:00:00Z" }));
    expect(poll).toMatchObject({
      title: "Spieleabend",
      note: "Bei mir\nzuhause",
      kind: "timed",
      deadline: "2026-11-05T12:00:00.000Z",
      closed: false,
      open: true,
      createdAt: "2026-11-01T10:00:00.000Z",
      expiresAt: "2026-12-08T19:00:00.000Z",
      myVoteId: null,
      canManage: true,
      votes: [],
      creator: { id: e.me.id, username: "Vincent R.", seedColor: null },
      participants: [{ id: e.me.id, username: "Vincent R.", seedColor: null }],
    });
    expect(poll.shareToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(poll.proposals).toEqual([
      { id: expect.any(Number), ...SLOT_A },
      { id: expect.any(Number), ...SLOT_B },
    ]);
  });

  it("stores the share token as it is, and the link works", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    expect(e.db.prepare("SELECT share_token FROM polls").get()).toEqual({ share_token: poll.shareToken });
    const viewed = await call(e, "GET", link(poll));
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json<PollView>()).toEqual({ ...poll, canManage: false });
  });

  it("creates a poll of days and expires it 30 days after German midnight following the last day", async () => {
    const e = await setup();
    const poll = await createPoll(e, daysBody());
    expect(poll.kind).toBe("days");
    expect(poll.proposals).toEqual([
      { id: expect.any(Number), first: "2026-11-02", last: "2026-11-03" },
      { id: expect.any(Number), first: "2026-11-10", last: "2026-11-10" },
    ]);
    // 2026-11-11 00:00 German time = 2026-11-10 23:00 UTC, plus 30 days.
    expect(poll.expiresAt).toBe("2026-12-10T23:00:00.000Z");
  });

  it("accepts instants without seconds and keeps the proposals' order", async () => {
    const e = await setup();
    const poll = await createPoll(
      e,
      timedBody({ proposals: [{ start: "2026-11-08T17:15Z", end: "2026-11-08T18:00:00Z" }, SLOT_A] }),
    );
    expect(poll.proposals).toMatchObject([{ start: "2026-11-08T17:15:00.000Z", end: "2026-11-08T18:00:00.000Z" }, SLOT_A]);
  });

  it("ignores unknown and duplicate participants, lists the others sorted without regard to case", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ participants: [e.ben.id, e.anna.id, e.anna.id, 99999, e.me.id] }));
    expect(poll.participants.map((p) => p.username)).toEqual(["Anna K.", "ben m.", "Vincent R."]);
  });

  it("refuses more than 50 other participants", async () => {
    const e = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 51; i++) ids.push((await addUser(e, `Person ${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`)).id);
    const response = await call(e, "POST", "/api/polls", { token: e.me.token, body: timedBody({ participants: ids }) });
    expect(response.statusCode).toBe(400);
    expect(field(response)).toBe("participants");
    const fifty = await call(e, "POST", "/api/polls", { token: e.me.token, body: timedBody({ participants: ids.slice(0, 50) }) });
    expect(fifty.statusCode).toBe(201);
  });

  it("needs a login", async () => {
    const e = await setup();
    expect((await call(e, "POST", "/api/polls", { body: timedBody() })).statusCode).toBe(401);
    expect((await call(e, "GET", "/api/polls")).statusCode).toBe(401);
  });

  const tooMany = Array.from({ length: 21 }, (_, i) => ({
    start: `2026-11-${String(10 + (i % 10)).padStart(2, "0")}T${String(8 + Math.floor(i / 10)).padStart(2, "0")}:00:00.000Z`,
    end: `2026-11-${String(10 + (i % 10)).padStart(2, "0")}T${String(9 + Math.floor(i / 10)).padStart(2, "0")}:00:00.000Z`,
  }));
  const cases: [string, Record<string, unknown>, string][] = [
    ["empty title", { title: "   " }, "title"],
    ["title of 81 characters", { title: "x".repeat(81) }, "title"],
    ["title with a control character", { title: "Spiele\u0007abend" }, "title"],
    ["note of 501 characters", { note: "n".repeat(501) }, "note"],
    ["note with a control character", { note: "a\u0007b" }, "note"],
    ["note with a tab", { note: "a\tb" }, "note"],
    ["no proposals", { proposals: [] }, "proposals"],
    ["21 proposals", { proposals: tooMany }, "proposals"],
    ["a start in the past", { proposals: [{ start: "2026-11-01T09:00:00.000Z", end: "2026-11-07T19:00:00.000Z" }] }, "proposals"],
    ["a start that is not on 15 minutes", { proposals: [{ start: "2026-11-07T17:10:00.000Z", end: "2026-11-07T19:00:00.000Z" }] }, "proposals"],
    ["an end that is not on 15 minutes", { proposals: [{ start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:20:00.000Z" }] }, "proposals"],
    ["seconds in a start", { proposals: [{ start: "2026-11-07T17:00:30.000Z", end: "2026-11-07T19:00:00.000Z" }] }, "proposals"],
    ["an end before the start", { proposals: [{ start: "2026-11-07T19:00:00.000Z", end: "2026-11-07T17:00:00.000Z" }] }, "proposals"],
    ["an end equal to the start", { proposals: [{ start: "2026-11-07T19:00:00.000Z", end: "2026-11-07T19:00:00.000Z" }] }, "proposals"],
    ["more than 24 hours", { proposals: [{ start: "2026-11-07T17:00:00.000Z", end: "2026-11-08T17:15:00.000Z" }] }, "proposals"],
    ["a start more than a year ahead", { proposals: [{ start: "2027-11-02T17:00:00.000Z", end: "2027-11-02T19:00:00.000Z" }] }, "proposals"],
    ["a local time instead of UTC", { proposals: [{ start: "2026-11-07T18:00:00+01:00", end: "2026-11-07T19:00:00Z" }] }, "proposals"],
    ["a date that does not exist", { proposals: [{ start: "2026-02-30T17:00:00Z", end: "2026-11-07T19:00:00Z" }] }, "proposals"],
    ["hour 24", { proposals: [{ start: "2026-11-07T24:00:00Z", end: "2026-11-08T01:00:00Z" }] }, "proposals"],
    ["the same proposal twice", { proposals: [SLOT_A, { start: "2026-11-07T17:00Z", end: "2026-11-07T19:00Z" }] }, "proposals"],
    ["days in a timed poll", { proposals: [{ first: "2026-11-02", last: "2026-11-03" }] }, "proposals"],
    ["a deadline in the past", { deadline: "2026-11-01T09:00:00.000Z" }, "deadline"],
    ["a deadline right now", { deadline: "2026-11-01T10:00:00.000Z" }, "deadline"],
    ["a deadline more than a year ahead", { deadline: "2027-11-02T10:00:00.000Z" }, "deadline"],
    ["a deadline that is not an instant", { deadline: "morgen" }, "deadline"],
    ["participants that are not numbers", { participants: ["a"] }, "participants"],
    ["no participants list", { participants: undefined }, "participants"],
    ["an unknown kind", { kind: "weeks" }, "kind"],
  ];
  it.each(cases)("refuses %s", async (_name, overrides, expectedField) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/polls", { token: e.me.token, body: timedBody(overrides) });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: expectedField });
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM polls").get()).toEqual({ n: 0 });
  });

  const dayCases: [string, unknown, string][] = [
    ["a first day of today", [{ first: "2026-11-01", last: "2026-11-02" }], "proposals"],
    ["a first day in the past", [{ first: "2026-10-30", last: "2026-11-02" }], "proposals"],
    ["a last day before the first", [{ first: "2026-11-05", last: "2026-11-04" }], "proposals"],
    ["a run of 32 days", [{ first: "2026-11-02", last: "2026-12-03" }], "proposals"],
    ["a day more than a year ahead", [{ first: "2027-11-02", last: "2027-11-02" }], "proposals"],
    ["a day that does not exist", [{ first: "2026-02-30", last: "2026-11-02" }], "proposals"],
    ["the same days twice", [{ first: "2026-11-02", last: "2026-11-03" }, { first: "2026-11-02", last: "2026-11-03" }], "proposals"],
    ["times in a poll of days", [{ start: SLOT_A.start, end: SLOT_A.end }], "proposals"],
    ["both shapes in one proposal", [{ first: "2026-11-02", last: "2026-11-03", start: SLOT_A.start }], "proposals"],
  ];
  it.each(dayCases)("refuses %s in a poll of days", async (_name, proposals, expectedField) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/polls", { token: e.me.token, body: daysBody({ proposals }) });
    expect(response.statusCode).toBe(400);
    expect(field(response)).toBe(expectedField);
  });

  it("accepts tomorrow, 31 days, and the last day a year ahead", async () => {
    const e = await setup();
    await createPoll(e, daysBody({ proposals: [{ first: "2026-11-02", last: "2026-12-02" }] }));
    await createPoll(e, daysBody({ proposals: [{ first: "2027-11-01", last: "2027-11-01" }] }));
  });

  it("accepts any minute in the deadline and a proposal of exactly 24 hours", async () => {
    const e = await setup();
    const poll = await createPoll(
      e,
      timedBody({
        deadline: "2026-11-05T12:07Z",
        proposals: [{ start: "2026-11-07T17:00Z", end: "2026-11-08T17:00Z" }],
      }),
    );
    expect(poll.deadline).toBe("2026-11-05T12:07:00.000Z");
  });

  it("refuses the 21st poll of a person (409 poll_limit) and frees a place when one is deleted or has expired", async () => {
    const e = await setup();
    const first = await createPoll(e);
    for (let i = 1; i < POLLS_PER_USER; i++) await createPoll(e);
    const refused = await call(e, "POST", "/api/polls", { token: e.me.token, body: timedBody() });
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe("poll_limit");
    // Others are not affected.
    await createPoll(e, timedBody(), e.anna.token);

    expect((await call(e, "DELETE", `/api/polls/${first.id}`, { token: e.me.token })).statusCode).toBe(204);
    await createPoll(e);
    expect(code(await call(e, "POST", "/api/polls", { token: e.me.token, body: timedBody() }))).toBe("poll_limit");

    // All of them end on 2026-11-08; 31 days later they are gone, even though the rows are still there.
    e.clock.advanceDays(38);
    await createPoll(e, timedBody({ proposals: [{ start: "2026-12-20T17:00Z", end: "2026-12-20T19:00Z" }] }));
  });
});

describe("listing polls", () => {
  it("lists polls the caller created, takes part in, or voted in, newest first, and no others", async () => {
    const e = await setup();
    const carl = await addUserWithSession(e, "Carl C.");
    const mine = await createPoll(e, timedBody({ title: "Meins" }));
    e.clock.advanceMinutes(5);
    const withAnna = await createPoll(e, timedBody({ title: "Mit Anna", participants: [e.anna.id] }));
    e.clock.advanceMinutes(5);
    const other = await createPoll(e, timedBody({ title: "Anderer" }), e.ben.token);
    await castGuest(e, withAnna, "Gast");
    expect((await accountVote(e, other, carl.token)).statusCode).toBe(200);

    const mineList = (await call(e, "GET", "/api/polls", { token: e.me.token })).json<PollList>();
    expect(mineList.polls.map((p) => p.title)).toEqual(["Mit Anna", "Meins"]);
    expect(mineList.polls[0]).toEqual({
      id: withAnna.id,
      shareToken: withAnna.shareToken,
      title: "Mit Anna",
      kind: "timed",
      creator: { id: e.me.id, username: "Vincent R.", seedColor: null },
      proposalCount: 2,
      voteCount: 1,
      deadline: null,
      open: true,
      fixedProposalId: null,
      fixedProposal: null,
      createdAt: "2026-11-01T10:05:00.000Z",
      expiresAt: "2026-12-08T19:00:00.000Z",
      voted: false,
    });

    const annaList = (await call(e, "GET", "/api/polls", { token: e.anna.token })).json<PollList>();
    expect(annaList.polls.map((p) => p.id)).toEqual([withAnna.id]);

    const carlList = (await call(e, "GET", "/api/polls", { token: carl.token })).json<PollList>();
    expect(carlList.polls.map((p) => [p.title, p.voted])).toEqual([["Anderer", true]]);

    const noPolls = (await call(e, "GET", "/api/polls", { token: e.admin.token })).json<PollList>();
    expect(noPolls.polls).toEqual([]);
    expect(mine.id).not.toBe(other.id);
  });

  it("puts the poll created last first when they were created at the same moment", async () => {
    const e = await setup();
    const a = await createPoll(e);
    const b = await createPoll(e);
    const list = (await call(e, "GET", "/api/polls", { token: e.me.token })).json<PollList>();
    expect(list.polls.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("does not list a closed or past-deadline poll as open", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ deadline: "2026-11-02T10:00:00Z" }));
    e.clock.advanceDays(2);
    const list = (await call(e, "GET", "/api/polls", { token: e.me.token })).json<PollList>();
    expect(list.polls.map((p) => [p.id, p.open])).toEqual([[poll.id, false]]);
  });
});

describe("viewing a poll by its link", () => {
  it("fills in myVoteId and canManage for the logged-in caller only", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await accountVote(e, poll, e.anna.token);

    const asGuest = (await call(e, "GET", link(poll))).json<PollView>();
    expect(asGuest).toMatchObject({ myVoteId: null, canManage: false });
    const asCreator = (await call(e, "GET", link(poll), { token: e.me.token })).json<PollView>();
    expect(asCreator).toMatchObject({ myVoteId: null, canManage: true });
    const asAdmin = (await call(e, "GET", link(poll), { token: e.admin.token })).json<PollView>();
    expect(asAdmin).toMatchObject({ myVoteId: null, canManage: true });
    const asAnna = (await call(e, "GET", link(poll), { token: e.anna.token })).json<PollView>();
    expect(asAnna.canManage).toBe(false);
    expect(asAnna.myVoteId).toBe(asAnna.votes[0]!.id);
    const asBen = (await call(e, "GET", link(poll), { token: e.ben.token })).json<PollView>();
    expect(asBen).toMatchObject({ myVoteId: null, canManage: false });
  });

  it("treats a wrong or expired login as no login and never answers 401", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const wrong = await call(e, "GET", link(poll), { token: "not-a-session" });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json<PollView>().canManage).toBe(false);
    e.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const expiredLogin = await call(e, "GET", link(poll), { token: e.me.token });
    expect(expiredLogin.statusCode).toBe(200);
    expect(expiredLogin.json<PollView>().canManage).toBe(false);
    const guest = await call(e, "POST", `${link(poll)}/votes`, {
      token: "not-a-session",
      body: { name: "Mia", answers: answersFor(poll) },
    });
    expect(guest.statusCode).toBe(201);
  });

  it("answers an unknown link with 404 poll_invalid", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/poll-links/does-not-exist");
    expect(response.statusCode).toBe(404);
    expect(code(response)).toBe("poll_invalid");
  });

  it("counts wrong links against the address, in the same bucket as wrong invite links", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    for (let i = 0; i < TOKEN_FAILURES_PER_IP; i++) {
      const response = await call(e, "GET", `/api/poll-links/wrong-${i}`);
      expect(response.statusCode).toBe(404);
      expect(code(response)).toBe("poll_invalid");
    }
    for (const response of [
      await call(e, "GET", link(poll)),
      await guestVote(e, poll, "Mia"),
      await call(e, "GET", "/api/invites/some-invite-token"),
    ]) {
      expect(response.statusCode).toBe(429);
      expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    }
    // Another address, and later the same one again, can use the link.
    expect((await call(e, "GET", link(poll), { ip: "10.0.0.9" })).statusCode).toBe(200);
    e.clock.advanceMinutes(16);
    expect((await call(e, "GET", link(poll))).statusCode).toBe(200);
  });

  it("shows the account's current username, accounts first (by name), then guests in the order cast", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await castGuest(e, poll, "Zoe");
    await accountVote(e, poll, e.ben.token, "no");
    await castGuest(e, poll, "Alex");
    await accountVote(e, poll, e.anna.token, ["yes", "maybe"]);

    const view = (await call(e, "GET", link(poll))).json<PollView>();
    expect(view.votes.map((v) => [v.name, v.personId])).toEqual([
      ["Anna K.", e.anna.id],
      ["ben m.", e.ben.id],
      ["Zoe", null],
      ["Alex", null],
    ]);
    expect(view.votes[0]!.answers).toEqual([
      { proposalId: poll.proposals[0]!.id, answer: "yes" },
      { proposalId: poll.proposals[1]!.id, answer: "maybe" },
    ]);

    updateUsername(e.db, e.anna.id, "Anna Neu", usernameKey("Anna Neu"));
    const after = (await call(e, "GET", link(poll))).json<PollView>();
    expect(after.votes.map((v) => v.name)).toEqual(["Anna Neu", "ben m.", "Zoe", "Alex"]);
  });
});

describe("votes of accounts", () => {
  it("casts, replaces and withdraws the vote, also from a second session of the same account", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const second = await call(e, "POST", "/api/auth/login", {
      body: { username: "Anna K.", password: e.anna.password },
    });
    const secondToken = second.json<{ token: string }>().token;

    const cast = await accountVote(e, poll, e.anna.token, ["yes", "no"]);
    expect(cast.statusCode).toBe(200);
    const voteId = cast.json<PollView>().myVoteId!;
    expect(cast.json<PollView>().votes).toMatchObject([{ id: voteId, name: "Anna K.", personId: e.anna.id }]);

    const changed = await accountVote(e, poll, secondToken, ["maybe", "maybe"]);
    expect(changed.json<PollView>().myVoteId).toBe(voteId);
    expect(changed.json<PollView>().votes).toHaveLength(1);
    expect(changed.json<PollView>().votes[0]!.answers.map((a) => a.answer)).toEqual(["maybe", "maybe"]);

    const withdrawn = await call(e, "DELETE", `${link(poll)}/my-vote`, { token: secondToken });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json<PollView>()).toMatchObject({ myVoteId: null, votes: [] });
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM poll_vote_answers").get()).toEqual({ n: 0 });
    // Withdrawing again changes nothing.
    expect((await call(e, "DELETE", `${link(poll)}/my-vote`, { token: e.anna.token })).statusCode).toBe(200);
  });

  it("needs a valid login", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const body = { answers: answersFor(poll) };
    expect((await call(e, "PUT", `${link(poll)}/my-vote`, { body })).statusCode).toBe(401);
    expect((await call(e, "PUT", `${link(poll)}/my-vote`, { body, token: "wrong" })).statusCode).toBe(401);
    expect((await call(e, "DELETE", `${link(poll)}/my-vote`)).statusCode).toBe(401);
  });

  it("does not refuse account votes for the guest limit", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    for (let i = 0; i < POLL_MAX_GUEST_VOTES; i++) {
      insertGuestVote(e.db, {
        pollId: poll.id,
        name: `Gast ${i}`,
        nameKey: `gast ${i}`,
        keyHash: "h",
        answers: answersFor(poll).map((a) => ({ ...a })),
        now: e.clock.now(),
      });
    }
    expect((await accountVote(e, poll, e.anna.token)).statusCode).toBe(200);
  });

  const badAnswers = (poll: PollView): [string, unknown][] => {
    const [a, b] = poll.proposals;
    return [
      ["a missing answer", [{ proposalId: a!.id, answer: "yes" }]],
      ["no answers", []],
      ["an answer twice", [{ proposalId: a!.id, answer: "yes" }, { proposalId: a!.id, answer: "no" }]],
      ["an unknown proposal", [{ proposalId: a!.id, answer: "yes" }, { proposalId: 99999, answer: "yes" }]],
      ["a proposal of another poll", [{ proposalId: a!.id, answer: "yes" }, { proposalId: b!.id + 1000, answer: "yes" }]],
      ["a third answer", [{ proposalId: a!.id, answer: "yes" }, { proposalId: b!.id, answer: "yes" }, { proposalId: 5, answer: "no" }]],
      ["an answer that is not yes, maybe or no", [{ proposalId: a!.id, answer: "yes" }, { proposalId: b!.id, answer: "perhaps" }]],
    ];
  };
  it.each([0, 1, 2, 3, 4, 5, 6])("refuses broken answers (case %i) with field answers", async (index) => {
    const e = await setup();
    const poll = await createPoll(e);
    const [, answers] = badAnswers(poll)[index]!;
    const asAccount = await call(e, "PUT", `${link(poll)}/my-vote`, { token: e.anna.token, body: { answers } });
    expect(asAccount.statusCode).toBe(400);
    expect(field(asAccount)).toBe("answers");
    const asGuest = await call(e, "POST", `${link(poll)}/votes`, { body: { name: "Mia", answers } });
    expect(asGuest.statusCode).toBe(400);
    expect(field(asGuest)).toBe("answers");
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM poll_votes").get()).toEqual({ n: 0 });
  });
});

describe("votes of guests", () => {
  it("casts a vote with a key that is stored only as a hash", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const created = await castGuest(e, poll, "  Mia   B. ", "maybe");
    expect(created.voteKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.poll.votes).toMatchObject([{ id: created.voteId, name: "Mia B.", personId: null }]);
    expect(created.poll.myVoteId).toBeNull();
    const dump = JSON.stringify(e.db.prepare("SELECT * FROM poll_votes").all());
    expect(dump).not.toContain(created.voteKey);
    expect(dump).toContain(hashToken(created.voteKey));
  });

  it("changes name and answers and withdraws the vote with the key", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const created = await castGuest(e, poll, "Mia");
    const url = `${link(poll)}/votes/${created.voteId}`;

    e.clock.advanceMinutes(10);
    const changed = await call(e, "PUT", url, {
      headers: keyHeader(created.voteKey),
      body: { name: "Mia B.", answers: answersFor(poll, ["no", "maybe"]) },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<PollView>().votes).toEqual([
      {
        id: created.voteId,
        name: "Mia B.",
        personId: null,
        answers: [
          { proposalId: poll.proposals[0]!.id, answer: "no" },
          { proposalId: poll.proposals[1]!.id, answer: "maybe" },
        ],
        updatedAt: "2026-11-01T10:10:00.000Z",
      },
    ]);

    const withdrawn = await call(e, "DELETE", url, { headers: keyHeader(created.voteKey) });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json<PollView>().votes).toEqual([]);
    const again = await call(e, "PUT", url, {
      headers: keyHeader(created.voteKey),
      body: { name: "Mia", answers: answersFor(poll) },
    });
    expect(again.statusCode).toBe(404);
  });

  it("refuses a wrong, missing or foreign key with 404 not_found", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const other = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    const tom = await castGuest(e, poll, "Tom");
    const otherGuest = await castGuest(e, other, "Mia");
    const body = { name: "Mia", answers: answersFor(poll) };
    const url = `${link(poll)}/votes/${mia.voteId}`;

    for (const attempt of [
      call(e, "PUT", url, { body }),
      call(e, "PUT", url, { body, headers: keyHeader("wrong") }),
      call(e, "PUT", url, { body, headers: keyHeader(tom.voteKey) }),
      call(e, "DELETE", url, { headers: keyHeader(tom.voteKey) }),
      call(e, "DELETE", `${link(poll)}/votes/99999`, { headers: keyHeader(mia.voteKey) }),
      call(e, "DELETE", `${link(poll)}/votes/abc`, { headers: keyHeader(mia.voteKey) }),
      // A vote of another poll, even with its right key.
      call(e, "DELETE", `${link(poll)}/votes/${otherGuest.voteId}`, { headers: keyHeader(otherGuest.voteKey) }),
    ]) {
      const response = await attempt;
      expect(response.statusCode).toBe(404);
      expect(code(response)).toBe("not_found");
    }
    expect((await call(e, "GET", link(poll))).json<PollView>().votes).toHaveLength(2);
  });

  it("does not let an account vote be changed or removed as a guest vote", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const view = (await accountVote(e, poll, e.anna.token)).json<PollView>();
    const response = await call(e, "DELETE", `${link(poll)}/votes/${view.myVoteId}`, { headers: keyHeader("x") });
    expect(response.statusCode).toBe(404);
    expect((await call(e, "GET", link(poll))).json<PollView>().votes).toHaveLength(1);
  });

  it("counts wrong keys like wrong links: after 30 the address gets 429, even for the right link", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    for (let i = 0; i < TOKEN_FAILURES_PER_IP; i++) {
      const response = await call(e, "DELETE", `${link(poll)}/votes/${mia.voteId}`, { headers: keyHeader(`wrong${i}`) });
      expect(response.statusCode).toBe(404);
    }
    const blocked = await call(e, "GET", link(poll));
    expect(blocked.statusCode).toBe(429);
    expect(code(blocked)).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // Another address is not affected.
    expect((await call(e, "GET", link(poll), { ip: "10.0.0.9" })).statusCode).toBe(200);
  });

  it("refuses broken names with field name", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    for (const name of ["", "   ", "x".repeat(41), "Mi\u0007a", "Mi\u0085a"]) {
      const response = await guestVote(e, poll, name);
      expect(response.statusCode).toBe(400);
      expect(field(response)).toBe("name");
    }
    expect((await guestVote(e, poll, "x".repeat(40))).statusCode).toBe(201);
  });

  describe("names", () => {
    it("refuses an account's username in any case", async () => {
      const e = await setup();
      const poll = await createPoll(e);
      for (const name of ["Vincent R.", "VINCENT r.", "  vincent   r. "]) {
        const response = await guestVote(e, poll, name);
        expect(response.statusCode).toBe(409);
        expect(code(response)).toBe("vote_name_taken");
      }
      // Also an account that is not a participant of this poll.
      expect(code(await guestVote(e, poll, "BEN M."))).toBe("vote_name_taken");
      expect(e.db.prepare("SELECT COUNT(*) AS n FROM poll_votes").get()).toEqual({ n: 0 });
    });

    it("refuses another guest's name in this poll, but not in another poll", async () => {
      const e = await setup();
      const poll = await createPoll(e);
      const other = await createPoll(e);
      await castGuest(e, poll, "Mia");
      expect(code(await guestVote(e, poll, "mIA"))).toBe("vote_name_taken");
      expect((await guestVote(e, other, "Mia")).statusCode).toBe(201);
    });

    it("lets a guest keep their own name (in another case) but not take another's or an account's when changing", async () => {
      const e = await setup();
      const poll = await createPoll(e);
      const mia = await castGuest(e, poll, "Mia");
      await castGuest(e, poll, "Tom");
      const url = `${link(poll)}/votes/${mia.voteId}`;
      const change = (name: string) =>
        call(e, "PUT", url, { headers: keyHeader(mia.voteKey), body: { name, answers: answersFor(poll) } });
      expect((await change("MIA")).statusCode).toBe(200);
      expect(code(await change("tom"))).toBe("vote_name_taken");
      expect(code(await change("anna k."))).toBe("vote_name_taken");
      expect((await change("Mia Neu")).statusCode).toBe(200);
    });

    it("backs the name check with a unique index, so a request that slips in between cannot add a duplicate", async () => {
      const e = await setup();
      const poll = await createPoll(e);
      await castGuest(e, poll, "Mia");
      expect(() =>
        insertGuestVote(e.db, {
          pollId: poll.id,
          name: "MIA",
          nameKey: "mia",
          keyHash: "h",
          answers: answersFor(poll),
          now: e.clock.now(),
        }),
      ).toThrow(/UNIQUE/);
    });
  });

  it("refuses the 101st guest vote with 409 poll_full, and frees a place when one is withdrawn", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const ids: number[] = [];
    for (let i = 0; i < POLL_MAX_GUEST_VOTES; i++) {
      ids.push(
        insertGuestVote(e.db, {
          pollId: poll.id,
          name: `Gast ${i}`,
          nameKey: `gast ${i}`,
          keyHash: hashToken(`key${i}`),
          answers: answersFor(poll),
          now: e.clock.now(),
        }),
      );
    }
    const full = await guestVote(e, poll, "Zu spät");
    expect(full.statusCode).toBe(409);
    expect(code(full)).toBe("poll_full");
    expect((await call(e, "DELETE", `${link(poll)}/votes/${ids[0]}`, { headers: keyHeader("key0") })).statusCode).toBe(200);
    expect((await guestVote(e, poll, "Gerade noch")).statusCode).toBe(201);
    // Changing an existing vote is not affected by the limit.
    expect(
      (
        await call(e, "PUT", `${link(poll)}/votes/${ids[1]}`, {
          headers: keyHeader("key1"),
          body: { name: "Gast 1 neu", answers: answersFor(poll, "no") },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("limits guest writes per address to 30 per window, counting casts, changes and withdrawals", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    const url = `${link(poll)}/votes/${mia.voteId}`;
    const change = () =>
      call(e, "PUT", url, { headers: keyHeader(mia.voteKey), body: { name: "Mia", answers: answersFor(poll) } });
    // The cast above was write 1.
    for (let i = 1; i < GUEST_VOTE_WRITES_PER_IP; i++) expect((await change()).statusCode).toBe(200);

    for (const attempt of [
      guestVote(e, poll, "Neu"),
      change(),
      call(e, "DELETE", url, { headers: keyHeader(mia.voteKey) }),
    ]) {
      const response = await attempt;
      expect(response.statusCode).toBe(429);
      expect(code(response)).toBe("rate_limited");
      expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    }
    // Reading and voting with an account are not limited; another address is not affected.
    expect((await call(e, "GET", link(poll))).statusCode).toBe(200);
    expect((await accountVote(e, poll, e.anna.token)).statusCode).toBe(200);
    expect((await guestVote(e, poll, "Neu", "yes", "10.0.0.7")).statusCode).toBe(201);

    e.clock.advanceMinutes(16);
    expect((await guestVote(e, poll, "Später")).statusCode).toBe(201);
  });

  it("does not count requests that fail validation or are refused as writes", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    for (let i = 0; i < GUEST_VOTE_WRITES_PER_IP + 5; i++) {
      expect((await guestVote(e, poll, "Vincent R.")).statusCode).toBe(409);
      expect((await call(e, "POST", `${link(poll)}/votes`, { body: { name: "Mia", answers: [] } })).statusCode).toBe(400);
    }
    expect((await guestVote(e, poll, "Mia")).statusCode).toBe(201);
  });
});

describe("closing and deadlines", () => {
  async function everyVoteIsRefused(e: Setup, poll: PollView, mia: GuestVoteCreated): Promise<void> {
    const url = `${link(poll)}/votes/${mia.voteId}`;
    const responses = [
      await guestVote(e, poll, "Neu"),
      await call(e, "PUT", url, { headers: keyHeader(mia.voteKey), body: { name: "Mia", answers: answersFor(poll) } }),
      await call(e, "DELETE", url, { headers: keyHeader(mia.voteKey) }),
      await accountVote(e, poll, e.anna.token),
      await call(e, "DELETE", `${link(poll)}/my-vote`, { token: e.anna.token }),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(code(response)).toBe("poll_closed");
    }
  }

  it("takes no more votes after the deadline, but still shows the poll", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ deadline: "2026-11-02T10:00:00Z" }));
    const mia = await castGuest(e, poll, "Mia");
    expect((await accountVote(e, poll, e.anna.token)).statusCode).toBe(200);

    e.clock.advanceHours(23);
    expect((await call(e, "GET", link(poll))).json<PollView>().open).toBe(true);
    e.clock.advanceHours(1);
    const view = (await call(e, "GET", link(poll))).json<PollView>();
    expect(view).toMatchObject({ open: false, closed: false });
    expect(view.votes).toHaveLength(2);
    await everyVoteIsRefused(e, poll, mia);
  });

  it("takes no more votes while closed by hand and takes them again when reopened", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    const closed = await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: { closed: true } });
    expect(closed.json<PollView>()).toMatchObject({ closed: true, open: false });
    await everyVoteIsRefused(e, poll, mia);

    const reopened = await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: { closed: false } });
    expect(reopened.json<PollView>()).toMatchObject({ closed: false, open: true });
    expect((await guestVote(e, poll, "Neu")).statusCode).toBe(201);
    expect((await accountVote(e, poll, e.anna.token)).statusCode).toBe(200);
  });

  it("opens a poll again when the deadline moves or is removed", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ deadline: "2026-11-02T10:00:00Z" }));
    e.clock.advanceDays(2);
    expect((await guestVote(e, poll, "Mia")).statusCode).toBe(409);
    const moved = await call(e, "PATCH", `/api/polls/${poll.id}`, {
      token: e.me.token,
      body: { deadline: "2026-11-05T10:00:00Z" },
    });
    expect(moved.json<PollView>()).toMatchObject({ deadline: "2026-11-05T10:00:00.000Z", open: true });
    expect((await guestVote(e, poll, "Mia")).statusCode).toBe(201);
    const removed = await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: { deadline: null } });
    expect(removed.json<PollView>()).toMatchObject({ deadline: null, open: true });
  });
});

describe("managing a poll", () => {
  it("lets the creator and an admin change title, note, deadline and closed, and sets updatedAt", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ note: "alt" }));
    e.clock.advanceMinutes(30);
    const patched = await call(e, "PATCH", `/api/polls/${poll.id}`, {
      token: e.me.token,
      body: { title: "  Neuer   Titel ", note: "", deadline: "2026-11-04T08:00:00Z" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<PollView>()).toMatchObject({
      title: "Neuer Titel",
      note: "",
      deadline: "2026-11-04T08:00:00.000Z",
      closed: false,
      canManage: true,
      proposals: poll.proposals,
    });
    expect(e.db.prepare("SELECT updated_at FROM polls").get()).toEqual({ updated_at: "2026-11-01T10:30:00.000Z" });

    const byAdmin = await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.admin.token, body: { closed: true } });
    expect(byAdmin.json<PollView>()).toMatchObject({ closed: true, title: "Neuer Titel", canManage: true });
  });

  it("accepts an empty body and changes nothing", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const response = await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json<PollView>()).toEqual(poll);
    expect((await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token })).statusCode).toBe(200);
  });

  it.each([
    ["an empty title", { title: " " }, "title"],
    ["a long note", { note: "n".repeat(501) }, "note"],
    ["a deadline in the past", { deadline: "2026-10-31T10:00:00Z" }, "deadline"],
    ["a closed that is not true or false", { closed: "yes" }, "closed"],
  ])("refuses %s", async (_name, body, expectedField) => {
    const e = await setup();
    const poll = await createPoll(e);
    const response = await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body });
    expect(response.statusCode).toBe(400);
    expect(field(response)).toBe(expectedField);
  });

  it("answers 403 for others, 404 for unknown or expired polls and 401 without login", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    const routes: [("PATCH" | "POST" | "DELETE"), string, unknown][] = [
      ["PATCH", `/api/polls/${poll.id}`, { title: "Hack" }],
      ["POST", `/api/polls/${poll.id}/share-link`, undefined],
      ["DELETE", `/api/polls/${poll.id}/votes/${mia.voteId}`, undefined],
      ["DELETE", `/api/polls/${poll.id}`, undefined],
    ];
    for (const [method, url, body] of routes) {
      const forbidden = await call(e, method, url, { token: e.anna.token, body });
      expect(forbidden.statusCode, `${method} ${url}`).toBe(403);
      expect(code(forbidden)).toBe("forbidden");
      expect((await call(e, method, url, { body })).statusCode).toBe(401);
      const missing = await call(e, method, url.replace(`/${poll.id}`, "/99999"), { token: e.me.token, body });
      expect(missing.statusCode).toBe(404);
      expect(code(missing)).toBe("not_found");
    }
    expect((await call(e, "PATCH", "/api/polls/abc", { token: e.me.token, body: {} })).statusCode).toBe(404);
    // Nothing happened.
    const view = (await call(e, "GET", link(poll))).json<PollView>();
    expect(view.title).toBe("Spieleabend");
    expect(view.votes).toHaveLength(1);

    e.clock.advanceDays(60);
    for (const [method, url, body] of routes) {
      expect((await call(e, method, url, { token: e.me.token, body })).statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("renews the share link: the new one works at once, the old one is invalid", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const renewed = await call(e, "POST", `/api/polls/${poll.id}/share-link`, { token: e.me.token });
    expect(renewed.statusCode).toBe(200);
    const { shareToken } = renewed.json<NewShareLink>();
    expect(shareToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(shareToken).not.toBe(poll.shareToken);

    const old = await call(e, "GET", link(poll));
    expect(old.statusCode).toBe(404);
    expect(code(old)).toBe("poll_invalid");
    const fresh = await call(e, "GET", `/api/poll-links/${shareToken}`);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json<PollView>().shareToken).toBe(shareToken);
    expect(code(await guestVote(e, poll, "Mia"))).toBe("poll_invalid");
  });

  it("deletes the poll with everything in it (204), and its link is invalid afterwards", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await castGuest(e, poll, "Mia");
    await accountVote(e, poll, e.anna.token);
    const deleted = await call(e, "DELETE", `/api/polls/${poll.id}`, { token: e.me.token });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");
    const response = await call(e, "GET", link(poll));
    expect(response.statusCode).toBe(404);
    expect(code(response)).toBe("poll_invalid");
    for (const table of ["polls", "poll_proposals", "poll_participants", "poll_votes", "poll_vote_answers"]) {
      expect(e.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect((await call(e, "DELETE", `/api/polls/${poll.id}`, { token: e.me.token })).statusCode).toBe(404);
  });

  it("lets the creator and an admin remove any vote, also while the poll is closed", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    const tom = await castGuest(e, poll, "Tom");
    await accountVote(e, poll, e.anna.token);
    const annaVote = (await call(e, "GET", link(poll), { token: e.anna.token })).json<PollView>().myVoteId;
    await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: { closed: true } });

    const first = await call(e, "DELETE", `/api/polls/${poll.id}/votes/${mia.voteId}`, { token: e.me.token });
    expect(first.statusCode).toBe(200);
    expect(first.json<PollView>().votes.map((v) => v.name)).toEqual(["Anna K.", "Tom"]);
    const second = await call(e, "DELETE", `/api/polls/${poll.id}/votes/${annaVote}`, { token: e.admin.token });
    expect(second.json<PollView>().votes.map((v) => v.name)).toEqual(["Tom"]);

    // Gone twice, or a vote of another poll, is not found.
    expect((await call(e, "DELETE", `/api/polls/${poll.id}/votes/${mia.voteId}`, { token: e.me.token })).statusCode).toBe(404);
    const other = await createPoll(e);
    const stranger = await castGuest(e, other, "Zed");
    expect((await call(e, "DELETE", `/api/polls/${poll.id}/votes/${stranger.voteId}`, { token: e.me.token })).statusCode).toBe(404);
    expect((await call(e, "DELETE", `/api/polls/${poll.id}/votes/abc`, { token: e.me.token })).statusCode).toBe(404);
    // The guest whose vote was removed cannot use the key any more.
    expect(
      (await call(e, "DELETE", `${link(poll)}/votes/${tom.voteId}`, { headers: keyHeader(tom.voteKey) })).statusCode,
    ).toBe(409);
  });
});

describe("expiry", () => {
  it("behaves as not existing once expired, and purgeExpired deletes the rows", async () => {
    const e = await setup();
    const poll = await createPoll(e);
    await castGuest(e, poll, "Mia");
    await accountVote(e, poll, e.anna.token);
    expect(poll.expiresAt).toBe("2026-12-08T19:00:00.000Z");

    e.clock.advance(Date.parse(poll.expiresAt) - e.clock.now().getTime() - 1000);
    expect((await call(e, "GET", link(poll))).statusCode).toBe(200);
    e.clock.advance(1000);

    const expired = await call(e, "GET", link(poll));
    expect(expired.statusCode).toBe(404);
    expect(code(expired)).toBe("poll_invalid");
    expect(code(await guestVote(e, poll, "Neu"))).toBe("poll_invalid");
    expect(code(await accountVote(e, poll, e.anna.token))).toBe("poll_invalid");
    expect(code(await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: {} }))).toBe("not_found");
    for (const token of [e.me.token, e.anna.token]) {
      expect((await call(e, "GET", "/api/polls", { token })).json<PollList>().polls).toEqual([]);
    }
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM polls").get()).toEqual({ n: 1 });

    purgeExpired(e.db, e.clock.now());
    for (const table of ["polls", "poll_proposals", "poll_participants", "poll_votes", "poll_vote_answers"]) {
      expect(e.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it("keeps a poll 30 days after the latest of several proposals", async () => {
    const e = await setup();
    const poll = await createPoll(
      e,
      timedBody({ proposals: [SLOT_B, SLOT_A, { start: "2026-11-20T08:00Z", end: "2026-11-20T09:30Z" }] }),
    );
    expect(poll.expiresAt).toBe("2026-12-20T09:30:00.000Z");
    const days = await createPoll(
      e,
      daysBody({ proposals: [{ first: "2026-11-20", last: "2026-11-21" }, { first: "2026-11-02", last: "2026-11-02" }] }),
    );
    expect(days.expiresAt).toBe("2026-12-21T23:00:00.000Z");
  });

  it("uses German midnight in summer time for days", async () => {
    const e = await setup();
    e.clock.advanceDays(200); // 2027-05-20
    e.db.prepare("UPDATE sessions SET expires_at = '2099-01-01T00:00:00.000Z'").run();
    const poll = await createPoll(e, daysBody({ proposals: [{ first: "2027-05-22", last: "2027-05-23" }] }));
    // 2027-05-24 00:00 CEST = 2027-05-23 22:00 UTC, plus 30 days.
    expect(poll.expiresAt).toBe("2027-06-22T22:00:00.000Z");
  });
});

describe("deleting accounts", () => {
  it("keeps the poll without a creator, drops the voter's vote and the participant", async () => {
    const e = await setup();
    const poll = await createPoll(e, timedBody({ participants: [e.anna.id, e.ben.id] }));
    await accountVote(e, poll, e.anna.token);
    await accountVote(e, poll, e.ben.token);
    await castGuest(e, poll, "Mia");

    expect((await call(e, "DELETE", `/api/admin/users/${e.anna.id}`, { token: e.admin.token })).statusCode).toBe(204);
    const afterVoter = (await call(e, "GET", link(poll))).json<PollView>();
    expect(afterVoter.votes.map((v) => v.name)).toEqual(["ben m.", "Mia"]);
    expect(afterVoter.participants.map((p) => p.username)).toEqual(["ben m.", "Vincent R."]);

    expect((await call(e, "DELETE", `/api/admin/users/${e.me.id}`, { token: e.admin.token })).statusCode).toBe(204);
    const afterCreator = await call(e, "GET", link(poll), { token: e.admin.token });
    expect(afterCreator.statusCode).toBe(200);
    expect(afterCreator.json<PollView>()).toMatchObject({ creator: null, canManage: true, title: "Spieleabend" });
    expect(afterCreator.json<PollView>().participants.map((p) => p.username)).toEqual(["ben m."]);
    // Only an admin manages it now.
    expect((await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.ben.token, body: {} })).statusCode).toBe(403);
    expect((await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.admin.token, body: { closed: true } })).statusCode).toBe(200);
    // Guests can still vote and the deleted creator's name is free for a guest.
    expect((await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.admin.token, body: { closed: false } })).statusCode).toBe(200);
    expect((await guestVote(e, poll, "Vincent R.")).statusCode).toBe(201);
  });
});

describe("the request log", () => {
  it("contains neither share tokens nor vote keys", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const e = await setup({ logLevel: "info" }, { logStream: stream });
    const poll = await createPoll(e);
    const mia = await castGuest(e, poll, "Mia");
    await call(e, "GET", link(poll));
    await call(e, "PUT", `${link(poll)}/votes/${mia.voteId}`, {
      headers: keyHeader(mia.voteKey),
      body: { name: "Mia", answers: answersFor(poll) },
    });
    await call(e, "DELETE", `${link(poll)}/votes/${mia.voteId}`, { headers: keyHeader(mia.voteKey) });
    await call(e, "GET", "/api/poll-links/typed-wrong-link-22ch");
    const renewed = (await call(e, "POST", `/api/polls/${poll.id}/share-link`, { token: e.me.token })).json<NewShareLink>();
    await call(e, "GET", `/api/poll-links/${renewed.shareToken}`);

    const text = chunks.join("");
    expect(text).toContain(`/api/poll-links/***/votes/${mia.voteId}`);
    for (const secret of [poll.shareToken, renewed.shareToken, mia.voteKey, "typed-wrong-link-22ch", e.me.token]) {
      expect(text).not.toContain(secret);
    }
  });
});
