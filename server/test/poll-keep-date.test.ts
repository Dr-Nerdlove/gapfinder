import type { ApiErrorBody, PollList, PollView, VoteAnswer } from "@lueckenfueller/shared";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { purgeExpired } from "../src/accounts/cleanup.js";
import { migrations, runMigrations } from "../src/db.js";
import { feedEventsOf } from "../src/polls/feed.js";
import { countPollsOfCreator } from "../src/polls/store.js";
import { createCalendarEnv, type CalendarEnv } from "./calendar-helpers.js";
import { addUserWithSession, call } from "./helpers.js";

let env: CalendarEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup() {
  env = await createCalendarEnv();
  const me = await addUserWithSession(env, "Vincent R.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  const cara = await addUserWithSession(env, "Cara C.");
  const dan = await addUserWithSession(env, "Dan D.");
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  return { ...env, me, anna, ben, cara, dan, admin };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const code = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().code;
const link = (poll: { shareToken: string }) => `/api/poll-links/${poll.shareToken}`;
const removeUrl = (poll: { id: number }) => `/api/polls/${poll.id}/remove-keeping-date`;

async function createPoll(e: Setup, participants: number[]): Promise<PollView> {
  const response = await call(e, "POST", "/api/polls", {
    token: e.me.token,
    body: {
      title: "Spieleabend",
      kind: "timed",
      proposals: [
        { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" },
        { start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" },
      ],
      participants,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PollView>();
}

const vote = (e: Setup, poll: PollView, token: string, answers: [VoteAnswer, VoteAnswer]) =>
  call(e, "PUT", `${link(poll)}/my-vote`, {
    token,
    body: { answers: poll.proposals.map((p, i) => ({ proposalId: p.id, answer: answers[i]! })) },
  });

const fixSecond = (e: Setup, poll: PollView) =>
  call(e, "PUT", `/api/polls/${poll.id}/fixed`, { token: e.me.token, body: { proposalId: poll.proposals[1]!.id } });

const inFeed = (e: Setup, userId: number) => feedEventsOf(e.db, userId, e.clock.now()).map((event) => event.pollId);
const count = (e: Setup, sql: string, ...args: number[]) => (e.db.prepare(sql).get(...args) as { n: number }).n;

/**
 * A fixed poll (second proposal): Anna is a participant without a vote, Ben votes yes (voter, no participant), Cara
 * says yes to the first and no to the fixed one (voter), Dan is a participant and says no to the fixed one.
 */
async function fixedPoll(e: Setup): Promise<PollView> {
  const poll = await createPoll(e, [e.anna.id, e.dan.id]);
  await vote(e, poll, e.ben.token, ["yes", "yes"]);
  await vote(e, poll, e.cara.token, ["yes", "no"]);
  await vote(e, poll, e.dan.token, ["yes", "no"]);
  await call(e, "POST", `${link(poll)}/votes`, {
    body: { name: "Gast", answers: poll.proposals.map((p) => ({ proposalId: p.id, answer: "yes" })) },
  });
  e.db
    .prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (?, ?, '{}', 'x')")
    .run(e.anna.id, poll.id);
  e.clock.advanceMinutes(5);
  expect((await fixSecond(e, poll)).statusCode).toBe(200);
  return poll;
}

describe("deleting a poll but keeping its date", () => {
  it("makes the poll vanish everywhere in the app", async () => {
    const e = await setup();
    const poll = await fixedPoll(e);
    expect(countPollsOfCreator(e.db, e.me.id, e.clock.now())).toBe(1);
    const response = await call(e, "POST", removeUrl(poll), { token: e.me.token });
    expect(response.statusCode, response.body).toBe(204);

    for (const token of [e.me.token, e.anna.token, e.ben.token]) {
      expect((await call(e, "GET", "/api/polls", { token })).json<PollList>().polls).toEqual([]);
    }
    const byLink = await call(e, "GET", link(poll));
    expect(byLink.statusCode).toBe(404);
    expect(code(byLink)).toBe("poll_invalid");
    expect(code(await call(e, "GET", `${link(poll)}/event.ics`))).toBe("poll_invalid");
    expect(code(await call(e, "PATCH", `/api/polls/${poll.id}`, { token: e.me.token, body: {} }))).toBe("not_found");
    expect(code(await call(e, "POST", removeUrl(poll), { token: e.me.token }))).toBe("not_found");
    expect(countPollsOfCreator(e.db, e.me.id, e.clock.now())).toBe(0);
  });

  it("keeps the event in the feed for the same people as before, and drops votes, proposals and notifications", async () => {
    const e = await setup();
    const poll = await fixedPoll(e);
    const people = [e.me, e.anna, e.ben, e.cara, e.dan, e.admin];
    const before = people.map((u) => inFeed(e, u.id).length);
    expect(before).toEqual([1, 1, 1, 0, 0, 0]);
    expect((await call(e, "POST", removeUrl(poll), { token: e.admin.token })).statusCode).toBe(204);

    expect(people.map((u) => inFeed(e, u.id).length)).toEqual(before);
    const event = feedEventsOf(e.db, e.ben.id, e.clock.now())[0]!;
    expect(event).toMatchObject({ pollId: poll.id, title: "Spieleabend", sequence: 1 });
    expect(event.when).toEqual({ kind: "timed", start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" });

    expect(count(e, "SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ?", poll.id)).toBe(0);
    expect(count(e, "SELECT COUNT(*) AS n FROM poll_vote_answers")).toBe(0);
    expect(count(e, "SELECT COUNT(*) AS n FROM poll_proposals WHERE poll_id = ?", poll.id)).toBe(1);
    expect(count(e, "SELECT COUNT(*) AS n FROM notifications WHERE poll_id = ?", poll.id)).toBe(0);
  });

  it("drops the creator from the feed when the creator's own vote said no", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna.id]);
    await vote(e, poll, e.me.token, ["yes", "no"]);
    await fixSecond(e, poll);
    expect(inFeed(e, e.me.id)).toEqual([]);
    expect((await call(e, "POST", removeUrl(poll), { token: e.me.token })).statusCode).toBe(204);
    expect(inFeed(e, e.me.id)).toEqual([]);
    expect(inFeed(e, e.anna.id)).toEqual([poll.id]);
  });

  it("answers 409 poll_not_fixed without a fixed date and deletes nothing", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna.id]);
    const response = await call(e, "POST", removeUrl(poll), { token: e.me.token });
    expect(response.statusCode).toBe(409);
    expect(code(response)).toBe("poll_not_fixed");
    expect((await call(e, "GET", link(poll))).statusCode).toBe(200);
  });

  it("is allowed for the creator and an admin only, and needs a login", async () => {
    const e = await setup();
    const poll = await fixedPoll(e);
    expect((await call(e, "POST", removeUrl(poll), { token: e.anna.token })).statusCode).toBe(403);
    expect((await call(e, "POST", removeUrl(poll))).statusCode).toBe(401);
    expect((await call(e, "POST", "/api/polls/99999/remove-keeping-date", { token: e.me.token })).statusCode).toBe(404);
    expect((await call(e, "GET", link(poll))).statusCode).toBe(200);
  });

  it("stays in the feed until it expires, then purgeExpired deletes it", async () => {
    const e = await setup();
    const poll = await fixedPoll(e);
    await call(e, "POST", removeUrl(poll), { token: e.me.token });
    const row = e.db.prepare("SELECT expires_at FROM polls WHERE id = ?").get(poll.id) as { expires_at: string };
    e.clock.advance(Date.parse(row.expires_at) - e.clock.now().getTime() - 1000);
    expect(inFeed(e, e.ben.id)).toEqual([poll.id]);
    e.clock.advance(1000);
    expect(inFeed(e, e.ben.id)).toEqual([]);
    purgeExpired(e.db, e.clock.now());
    for (const table of ["polls", "poll_proposals", "poll_participants"]) {
      expect(e.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it("migration 13 adds removed_at to an existing database and keeps its polls live", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(
      db,
      migrations.filter((m) => m.id < 13),
    );
    db.prepare("INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('a', 'a', 'x', 'x')").run();
    db.prepare(
      "INSERT INTO polls (share_token, creator_id, title, kind, created_at, updated_at, expires_at) VALUES ('t', 1, 'T', 'timed', 'x', 'x', 'x')",
    ).run();
    runMigrations(db);
    expect(db.prepare("SELECT removed_at FROM polls").get()).toEqual({ removed_at: null });
  });
});
