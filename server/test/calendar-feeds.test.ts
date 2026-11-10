import type { ApiErrorBody, CalendarFeed, PollView, VoteAnswer } from "@lueckenfueller/shared";
import ICAL from "ical.js";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_FAILURES_PER_IP } from "../src/auth/rate-limit.js";
import { addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

// The test clock starts on Sunday 2026-11-01 at 10:00 UTC (11:00 German time, CET).
async function setup() {
  env = await createTestEnv();
  const me = await addUserWithSession(env, "Vincent R.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  return { ...env, me, anna, ben };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const code = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().code;

const slot = (day: number) => ({
  start: `2026-11-${String(day).padStart(2, "0")}T17:00:00.000Z`,
  end: `2026-11-${String(day).padStart(2, "0")}T19:00:00.000Z`,
});

/** A poll with two proposals (days `day` and `day + 1`, 17:00 to 19:00 UTC). */
async function createPoll(e: Setup, token: string, title: string, day: number, participants: number[] = []): Promise<PollView> {
  const response = await call(e, "POST", "/api/polls", {
    token,
    body: { title, kind: "timed", proposals: [slot(day), slot(day + 1)], participants },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PollView>();
}

async function vote(e: Setup, poll: PollView, token: string, answers: VoteAnswer[]) {
  const response = await call(e, "PUT", `/api/poll-links/${poll.shareToken}/my-vote`, {
    token,
    body: { answers: poll.proposals.map((p, i) => ({ proposalId: p.id, answer: answers[i]! })) },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function fix(e: Setup, poll: PollView, index: number, token: string) {
  const response = await call(e, "PUT", `/api/polls/${poll.id}/fixed`, {
    token,
    body: { proposalId: poll.proposals[index]!.id },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function feedToken(e: Setup, token: string): Promise<string> {
  const response = await call(e, "POST", "/api/me/calendar-feed", { token });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<CalendarFeed>().token!;
}

const feed = (e: Setup, token: string, options: { ip?: string } = {}) => call(e, "GET", `/api/calendar-feeds/${token}`, options);

function titlesIn(text: string): string[] {
  const calendar = new ICAL.Component(ICAL.parse(text));
  return calendar.getAllSubcomponents("vevent").map((vevent) => new ICAL.Event(vevent).summary);
}

describe("managing the feed link", () => {
  it("answers 401 without a login", async () => {
    const e = await setup();
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const response = await call(e, method, "/api/me/calendar-feed");
      expect(response.statusCode, method).toBe(401);
      expect(code(response)).toBe("unauthorized");
    }
  });

  it("has no feed at first, creates one with a 128-bit token and shows it again", async () => {
    const e = await setup();
    expect((await call(e, "GET", "/api/me/calendar-feed", { token: e.me.token })).json<CalendarFeed>()).toEqual({ token: null, fetches: [] });

    const created = await call(e, "POST", "/api/me/calendar-feed", { token: e.me.token });
    expect(created.statusCode).toBe(200);
    const { token } = created.json<CalendarFeed>();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(e.db.prepare("SELECT user_id, token FROM calendar_feeds").all()).toEqual([{ user_id: e.me.id, token }]);
    expect((await call(e, "GET", "/api/me/calendar-feed", { token: e.me.token })).json<CalendarFeed>()).toEqual({ token, fetches: [] });
    // Everybody has their own.
    expect((await call(e, "GET", "/api/me/calendar-feed", { token: e.anna.token })).json<CalendarFeed>()).toEqual({ token: null, fetches: [] });
  });

  it("renews the token: the new link works at once and the old one is dead", async () => {
    const e = await setup();
    const first = await feedToken(e, e.me.token);
    expect((await feed(e, first)).statusCode).toBe(200);
    const second = await feedToken(e, e.me.token);
    expect(second).not.toBe(first);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM calendar_feeds").get()).toEqual({ n: 1 });
    expect((await feed(e, second)).statusCode).toBe(200);
    const old = await feed(e, first);
    expect(old.statusCode).toBe(404);
    expect(code(old)).toBe("not_found");
  });

  it("switches the feed off, also when it is already off", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    const off = await call(e, "DELETE", "/api/me/calendar-feed", { token: e.me.token });
    expect(off.statusCode).toBe(204);
    expect(off.body).toBe("");
    expect((await call(e, "GET", "/api/me/calendar-feed", { token: e.me.token })).json<CalendarFeed>()).toEqual({ token: null, fetches: [] });
    expect((await feed(e, token)).statusCode).toBe(404);
    expect((await call(e, "DELETE", "/api/me/calendar-feed", { token: e.me.token })).statusCode).toBe(204);
  });

  it("ends the feed with the account", async () => {
    const e = await setup();
    const token = await feedToken(e, e.anna.token);
    e.db.prepare("DELETE FROM users WHERE id = ?").run(e.anna.id);
    expect((await feed(e, token)).statusCode).toBe(404);
  });
});

describe("reading the feed", () => {
  it("needs no login, works with and without .ics and is never cached", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    for (const url of [token, `${token}.ics`]) {
      const response = await call(e, "GET", `/api/calendar-feeds/${url}`);
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"]).toBe("text/calendar; charset=utf-8");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toContain("X-WR-CALNAME:Lückenfüller\r\n");
      expect(response.body).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n");
    }
    // Only the token's own ending is removed.
    expect((await call(e, "GET", `/api/calendar-feeds/${token}x.ics`)).statusCode).toBe(404);
    expect((await call(e, "GET", `/api/calendar-feeds/${token}.ics.ics`)).statusCode).toBe(404);
  });

  it("is a valid calendar without events when no date is fixed", async () => {
    const e = await setup();
    await createPoll(e, e.me.token, "Offen", 7);
    const response = await feed(e, await feedToken(e, e.me.token));
    expect(response.statusCode).toBe(200);
    expect(response.body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(response.body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(titlesIn(response.body)).toEqual([]);
  });

  it("holds the fixed dates of polls the person created, takes part in, or voted in, except after a 'no'", async () => {
    const e = await setup();
    // me created it.
    const created = await createPoll(e, e.me.token, "Selbst erstellt", 7);
    // me is a participant and did not vote.
    const participant = await createPoll(e, e.anna.token, "Nur eingeladen", 8, [e.me.id]);
    // me is neither, but voted with the link.
    const voter = await createPoll(e, e.anna.token, "Nur abgestimmt", 9);
    await vote(e, voter, e.me.token, ["maybe", "yes"]);
    // me is a participant and said no to the proposal that gets fixed.
    const declined = await createPoll(e, e.anna.token, "Abgesagt", 10, [e.me.id]);
    await vote(e, declined, e.me.token, ["yes", "no"]);
    // me said no to the other proposal only.
    const declinedOther = await createPoll(e, e.anna.token, "Anderer abgesagt", 11, [e.me.id]);
    await vote(e, declinedOther, e.me.token, ["yes", "no"]);
    // me created it and said no to the fixed proposal.
    const ownNo = await createPoll(e, e.me.token, "Selbst abgesagt", 12);
    await vote(e, ownNo, e.me.token, ["no", "yes"]);
    // Not fixed, and a poll of others.
    const notFixed = await createPoll(e, e.me.token, "Nicht festgelegt", 13);
    const others = await createPoll(e, e.anna.token, "Fremd", 14, [e.ben.id]);
    // A guest named like nobody: guests have no feed, but their votes must not matter for me.
    await call(e, "POST", `/api/poll-links/${declined.shareToken}/votes`, {
      body: { name: "Gast", answers: declined.proposals.map((p) => ({ proposalId: p.id, answer: "no" })) },
    });

    await fix(e, created, 0, e.me.token);
    await fix(e, participant, 0, e.anna.token);
    await fix(e, voter, 1, e.anna.token);
    await fix(e, declined, 1, e.anna.token);
    await fix(e, declinedOther, 0, e.anna.token);
    await fix(e, ownNo, 0, e.me.token);
    await fix(e, others, 0, e.anna.token);
    expect(notFixed.fixedProposalId).toBeNull();

    const mine = await feed(e, await feedToken(e, e.me.token));
    // Sorted by the time of the event.
    expect(titlesIn(mine.body)).toEqual(["Selbst erstellt", "Nur eingeladen", "Nur abgestimmt", "Anderer abgesagt"]);

    const ben = await feed(e, await feedToken(e, e.ben.token));
    expect(titlesIn(ben.body)).toEqual(["Fremd"]);
    const anna = await feed(e, await feedToken(e, e.anna.token));
    expect(titlesIn(anna.body)).toEqual(["Nur eingeladen", "Nur abgestimmt", "Abgesagt", "Anderer abgesagt", "Fremd"]);
  });

  it("writes the fixed proposal's time, a stable uid and a growing sequence", async () => {
    const e = await setup();
    const poll = await createPoll(e, e.me.token, "Spieleabend", 7);
    const token = await feedToken(e, e.me.token);
    await fix(e, poll, 0, e.me.token);
    const [first] = new ICAL.Component(ICAL.parse((await feed(e, token)).body)).getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
    expect(first!.uid).toBe(`poll-${poll.id}@lueckenfueller`);
    expect(first!.startDate.toJSDate().toISOString()).toBe(slot(7).start);
    expect(first!.sequence).toBe(1);

    await fix(e, poll, 1, e.me.token);
    const [second] = new ICAL.Component(ICAL.parse((await feed(e, token)).body)).getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
    expect(second!.uid).toBe(first!.uid);
    expect(second!.startDate.toJSDate().toISOString()).toBe(slot(8).start);
    expect(second!.sequence).toBe(2);
  });

  it("drops a date when it is taken back, when the person's no is fixed, and when the poll is deleted or has expired", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    const a = await createPoll(e, e.me.token, "A", 7);
    const b = await createPoll(e, e.anna.token, "B", 9, [e.me.id]);
    const c = await createPoll(e, e.me.token, "C", 11);
    await vote(e, b, e.me.token, ["yes", "no"]);
    for (const [poll, owner] of [[a, e.me], [b, e.anna], [c, e.me]] as const) await fix(e, poll, 0, owner.token);
    expect(titlesIn((await feed(e, token)).body)).toEqual(["A", "B", "C"]);

    await call(e, "DELETE", `/api/polls/${a.id}/fixed`, { token: e.me.token });
    expect(titlesIn((await feed(e, token)).body)).toEqual(["B", "C"]);
    await fix(e, b, 1, e.anna.token);
    expect(titlesIn((await feed(e, token)).body)).toEqual(["C"]);
    await call(e, "DELETE", `/api/polls/${c.id}`, { token: e.me.token });
    expect(titlesIn((await feed(e, token)).body)).toEqual([]);

    await fix(e, a, 0, e.me.token);
    expect(titlesIn((await feed(e, token)).body)).toEqual(["A"]);
    // 30 days after the last proposal (2026-11-08) the poll is gone, even before the rows are purged.
    e.clock.advanceDays(38);
    const expired = await feed(e, token);
    expect(expired.statusCode).toBe(200);
    expect(titlesIn(expired.body)).toEqual([]);
  });

  it("answers an unknown token with 404 not_found and does not count it against the address", async () => {
    const e = await setup();
    const poll = await createPoll(e, e.me.token, "A", 7);
    const token = await feedToken(e, e.me.token);
    const attempts = TOKEN_FAILURES_PER_IP + 20;
    for (let i = 0; i < attempts; i++) {
      const response = await feed(e, `wrong-token-${i}`);
      expect(response.statusCode, `attempt ${i + 1}`).toBe(404);
      expect(code(response)).toBe("not_found");
    }
    // The address is not blocked: the right feed, a share link and an invite check still answer as usual.
    expect((await feed(e, token)).statusCode).toBe(200);
    expect((await call(e, "GET", `/api/poll-links/${poll.shareToken}`)).statusCode).toBe(200);
    expect((await call(e, "GET", "/api/invites/wrong")).statusCode).toBe(404);
  });

  it("does not let an address that is blocked for wrong links lose its feed", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    for (let i = 0; i < TOKEN_FAILURES_PER_IP; i++) await call(e, "GET", `/api/invites/wrong-${i}`);
    expect((await call(e, "GET", "/api/invites/wrong")).statusCode).toBe(429);
    expect((await feed(e, token)).statusCode).toBe(200);
  });
});

describe("when the feed was last fetched", () => {
  const GOOGLE = { "user-agent": "Google-Calendar-Importer" };
  const APPLE = { "user-agent": "iOS/17.5 (21F79) dataaccessd/1.0" };
  const read = async (e: Setup) => (await call(e, "GET", "/api/me/calendar-feed", { token: e.me.token })).json<CalendarFeed>();
  const fetchAs = (e: Setup, token: string, headers: Record<string, string>) =>
    call(e, "GET", `/api/calendar-feeds/${token}`, { headers });

  it("starts empty, and the answer to switching on has an empty list", async () => {
    const e = await setup();
    expect((await read(e)).fetches).toEqual([]);
    const created = await call(e, "POST", "/api/me/calendar-feed", { token: e.me.token });
    expect(created.json<CalendarFeed>().fetches).toEqual([]);
    expect((await read(e)).fetches).toEqual([]);
  });

  it("remembers the kind of app and the time, newest first, one row per kind", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    expect((await fetchAs(e, token, GOOGLE)).statusCode).toBe(200);
    expect((await read(e)).fetches).toEqual([{ app: "google", at: "2026-11-01T10:00:00.000Z" }]);

    e.clock.advanceMinutes(30);
    await fetchAs(e, token, APPLE);
    expect((await read(e)).fetches).toEqual([
      { app: "apple", at: "2026-11-01T10:30:00.000Z" },
      { app: "google", at: "2026-11-01T10:00:00.000Z" },
    ]);

    e.clock.advanceMinutes(30);
    await fetchAs(e, token, GOOGLE);
    expect((await read(e)).fetches).toEqual([
      { app: "google", at: "2026-11-01T11:00:00.000Z" },
      { app: "apple", at: "2026-11-01T10:30:00.000Z" },
    ]);
    // Only kind and time are stored.
    expect(Object.keys(e.db.prepare("SELECT * FROM calendar_feed_fetches").get() as object).sort()).toEqual(["app", "fetched_at", "user_id"]);
  });

  it("files a request without a known app as 'other'", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    await feed(e, token);
    expect((await read(e)).fetches).toEqual([{ app: "other", at: "2026-11-01T10:00:00.000Z" }]);
  });

  it("records nothing for a wrong token", async () => {
    const e = await setup();
    await feedToken(e, e.me.token);
    expect((await fetchAs(e, "x".repeat(22), GOOGLE)).statusCode).toBe(404);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM calendar_feed_fetches").get()).toEqual({ n: 0 });
  });

  it("clears them when the link is renewed", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    await fetchAs(e, token, GOOGLE);
    expect((await read(e)).fetches).toHaveLength(1);
    await feedToken(e, e.me.token);
    expect((await read(e)).fetches).toEqual([]);
  });

  it("starts empty again after switching off and on", async () => {
    const e = await setup();
    const token = await feedToken(e, e.me.token);
    await fetchAs(e, token, GOOGLE);
    await call(e, "DELETE", "/api/me/calendar-feed", { token: e.me.token });
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM calendar_feed_fetches").get()).toEqual({ n: 0 });
    await feedToken(e, e.me.token);
    expect((await read(e)).fetches).toEqual([]);
  });
});
