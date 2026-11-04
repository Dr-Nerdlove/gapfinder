import type {
  ApiErrorBody,
  GuestVoteCreated,
  NotificationData,
  NotificationItem,
  NotificationList,
  NotificationSettings,
  PollView,
  PushPublicKey,
  ReminderSent,
  VoteAnswer,
} from "@lueckenfueller/shared";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import type { PushTarget } from "../src/notifications/send.js";
import { addUserWithSession, call, createTestEnv, testConfig, TestClock, type TestEnv } from "./helpers.js";

interface Sent {
  target: PushTarget;
  item: NotificationItem;
}

let env: TestEnv | undefined;
let tempDir: string | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

const code = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().code;
const SLOT_A = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };
const SLOT_B = { start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" };
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const endpointOf = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

async function setup(options: { failWith?: (target: PushTarget) => number | undefined; logStream?: Writable } = {}) {
  const sent: Sent[] = [];
  env = await createTestEnv(options.logStream ? { logLevel: "warn" } : {}, {
    ...(options.logStream ? { logStream: options.logStream } : {}),
    sendPush: async (target, payload) => {
      sent.push({ target, item: JSON.parse(payload) as NotificationItem });
      const status = options.failWith?.(target);
      if (status !== undefined) throw Object.assign(new Error("push failed"), { statusCode: status });
    },
  });
  const owner = await addUserWithSession(env, "Olga O.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  const cara = await addUserWithSession(env, "Cara C.");
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  return { ...env, sent, owner, anna, ben, cara, admin };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type User = { id: number; token: string };

async function subscribe(e: Setup, user: User, name: string) {
  const response = await call(e, "POST", "/api/push/subscriptions", {
    token: user.token,
    body: { endpoint: endpointOf(name), keys: { p256dh: P256DH, auth: AUTH } },
  });
  expect(response.statusCode, response.body).toBe(204);
}

/** Every account gets one device named after its id, so a message can be attributed. */
async function subscribeAll(e: Setup) {
  for (const user of [e.owner, e.anna, e.ben, e.cara, e.admin]) await subscribe(e, user, `u${user.id}`);
}

async function createPoll(e: Setup, participants: User[], body: Record<string, unknown> = {}): Promise<PollView> {
  const response = await call(e, "POST", "/api/polls", {
    token: e.owner.token,
    body: { title: "Spieleabend", kind: "timed", proposals: [SLOT_A, SLOT_B], participants: participants.map((p) => p.id), ...body },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<PollView>();
}

const link = (poll: PollView) => `/api/poll-links/${poll.shareToken}`;
const answersFor = (poll: PollView, answer: VoteAnswer | VoteAnswer[]) =>
  poll.proposals.map((p, i) => ({ proposalId: p.id, answer: Array.isArray(answer) ? answer[i]! : answer }));

async function vote(e: Setup, poll: PollView, user: User, answer: VoteAnswer | VoteAnswer[] = "yes") {
  const response = await call(e, "PUT", `${link(poll)}/my-vote`, { token: user.token, body: { answers: answersFor(poll, answer) } });
  expect(response.statusCode, response.body).toBe(200);
}

async function fix(e: Setup, poll: PollView, proposalIndex: number) {
  const response = await call(e, "PUT", `/api/polls/${poll.id}/fixed`, {
    token: e.owner.token,
    body: { proposalId: poll.proposals[proposalIndex]!.id },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function notificationsOf(e: Setup, user: User, after?: number): Promise<NotificationItem[]> {
  const response = await call(e, "GET", `/api/notifications${after === undefined ? "" : `?after=${after}`}`, { token: user.token });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<NotificationList>().items;
}

const kindsOf = async (e: Setup, user: User) => (await notificationsOf(e, user)).map((item) => item.data.kind);
const setSettings = (e: Setup, user: User, settings: Partial<NotificationSettings>) =>
  call(e, "PUT", "/api/me/notification-settings", {
    token: user.token,
    body: {
      pollCreated: true, voteOwn: true, voteOthers: false, allVotedOwn: true, allVotedOthers: false, dateFixed: true, reminder: true,
      ...settings,
    },
  });

describe("who is told about a new poll", () => {
  it("tells the participants except the creator, with data and no text", async () => {
    const e = await setup();
    await subscribeAll(e);
    const poll = await createPoll(e, [e.anna, e.ben]);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created"]);
    expect(await kindsOf(e, e.ben)).toEqual(["poll_created"]);
    expect(await kindsOf(e, e.owner)).toEqual([]);
    expect(await kindsOf(e, e.cara)).toEqual([]);
    const [item] = await notificationsOf(e, e.anna);
    expect(item!.data).toEqual({ kind: "poll_created", pollTitle: "Spieleabend", shareToken: poll.shareToken, actorName: "Olga O." });
    // The push goes out in the background, with the same item as payload.
    await vi.waitFor(() => expect(e.sent).toHaveLength(2));
    expect(e.sent.map((s) => s.target.endpoint).sort()).toEqual([endpointOf(`u${e.anna.id}`), endpointOf(`u${e.ben.id}`)].sort());
    expect(e.sent.find((s) => s.target.endpoint === endpointOf(`u${e.anna.id}`))!.item).toEqual(item);
  });

  it("respects the setting", async () => {
    const e = await setup();
    await setSettings(e, e.ben, { pollCreated: false });
    await createPoll(e, [e.anna, e.ben]);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created"]);
    expect(await kindsOf(e, e.ben)).toEqual([]);
  });
});

describe("who is told about a vote", () => {
  it("tells the creator by default and others only when switched on; never the voter", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.ben]);
    await setSettings(e, e.ben, { voteOthers: true });
    await vote(e, poll, e.anna);
    const ownerItems = await notificationsOf(e, e.owner);
    expect(ownerItems.map((i) => i.data.kind)).toEqual(["vote"]);
    expect(ownerItems[0]!.data).toMatchObject({ actorName: "Anna K.", shareToken: poll.shareToken });
    expect(await kindsOf(e, e.ben)).toEqual(["poll_created", "vote"]);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created"]);
    expect(await kindsOf(e, e.cara)).toEqual([]);
  });

  it("tells about a changed vote, but not about a withdrawn one", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await vote(e, poll, e.anna);
    await vote(e, poll, e.anna, "no");
    expect(await kindsOf(e, e.owner)).toEqual(["vote", "vote"]);
    const gone = await call(e, "DELETE", `${link(poll)}/my-vote`, { token: e.anna.token });
    expect(gone.statusCode).toBe(200);
    expect(await kindsOf(e, e.owner)).toEqual(["vote", "vote"]);
  });

  it("tells about guest votes (new and changed) with the guest's name, and counts the guest as actor only", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await setSettings(e, e.anna, { voteOthers: true });
    const created = await call(e, "POST", `${link(poll)}/votes`, { body: { name: "Gustav", answers: answersFor(poll, "yes") } });
    expect(created.statusCode).toBe(201);
    const { voteId, voteKey } = created.json<GuestVoteCreated>();
    const changed = await call(e, "PUT", `${link(poll)}/votes/${voteId}`, {
      headers: { "x-vote-key": voteKey },
      body: { name: "Gustav", answers: answersFor(poll, "no") },
    });
    expect(changed.statusCode).toBe(200);
    const items = await notificationsOf(e, e.owner);
    expect(items.map((i) => i.data)).toMatchObject([{ kind: "vote", actorName: "Gustav" }, { kind: "vote", actorName: "Gustav" }]);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created", "vote", "vote"]);
  });

  it("includes accounts that voted without being a participant as involved", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await setSettings(e, e.cara, { voteOthers: true });
    await vote(e, poll, e.cara);
    await vote(e, poll, e.anna);
    expect(await kindsOf(e, e.cara)).toEqual(["vote"]);
  });
});

describe("everyone has voted", () => {
  it("is sent once, when the last participant votes, in addition to the vote", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.ben]);
    await setSettings(e, e.ben, { allVotedOthers: true });
    await vote(e, poll, e.owner);
    await vote(e, poll, e.anna);
    expect(await kindsOf(e, e.owner)).toEqual(["vote"]);
    await vote(e, poll, e.ben);
    expect(await kindsOf(e, e.owner)).toEqual(["vote", "vote", "all_voted"]);
    const all = (await notificationsOf(e, e.owner)).at(-1)!.data;
    expect(all).toMatchObject({ kind: "all_voted", actorName: "ben m." });
    // The others only get it when they switched it on; the last voter never.
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created"]);
    expect(await kindsOf(e, e.ben)).toEqual(["poll_created"]);
    // Changing a vote afterwards is not a new transition.
    await vote(e, poll, e.ben, "no");
    expect(await kindsOf(e, e.owner)).toEqual(["vote", "vote", "all_voted", "vote"]);
  });

  it("is also sent to an involved account who switched it on", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.ben]);
    await setSettings(e, e.anna, { allVotedOthers: true });
    await vote(e, poll, e.owner);
    await vote(e, poll, e.ben);
    await vote(e, poll, e.anna, "no");
    expect(await kindsOf(e, e.ben)).toEqual(["poll_created"]);
    // Anna is the last voter herself: nothing for her.
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created"]);
    // Had Ben been the last, Anna would have got it.
    const poll2 = await createPoll(e, [e.anna, e.ben]);
    await vote(e, poll2, e.owner);
    await vote(e, poll2, e.anna);
    await vote(e, poll2, e.ben);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created", "poll_created", "all_voted"]);
  });
});

describe("date fixed", () => {
  it("tells those who said yes or maybe and those without a vote, not those who said no", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.ben, e.cara]);
    await vote(e, poll, e.anna, ["yes", "no"]);
    await vote(e, poll, e.ben, ["no", "yes"]);
    // Cara has no vote; the owner has voted "maybe" on the first proposal.
    await vote(e, poll, e.owner, ["maybe", "no"]);
    await fix(e, poll, 0);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created", "date_fixed"]);
    expect(await kindsOf(e, e.ben)).toEqual(["poll_created"]);
    expect(await kindsOf(e, e.cara)).toEqual(["poll_created", "date_fixed"]);
    // The creator is the actor.
    expect((await kindsOf(e, e.owner)).includes("date_fixed")).toBe(false);
    const fixed = (await notificationsOf(e, e.anna)).at(-1)!.data as Extract<NotificationData, { kind: "date_fixed" }>;
    expect(fixed).toMatchObject({ actorName: "Olga O.", proposal: { id: poll.proposals[0]!.id, ...SLOT_A } });
  });

  it("tells again when the date changes, but not when the same proposal is fixed again or the date is taken back", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await fix(e, poll, 0);
    await fix(e, poll, 0);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created", "date_fixed"]);
    await fix(e, poll, 1);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created", "date_fixed", "date_fixed"]);
    const unfixed = await call(e, "DELETE", `/api/polls/${poll.id}/fixed`, { token: e.owner.token });
    expect(unfixed.statusCode).toBe(200);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created", "date_fixed", "date_fixed"]);
  });

  it("does not tell an admin's own account when the admin fixes it", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.admin]);
    const response = await call(e, "PUT", `/api/polls/${poll.id}/fixed`, {
      token: e.admin.token,
      body: { proposalId: poll.proposals[0]!.id },
    });
    expect(response.statusCode).toBe(200);
    expect(await kindsOf(e, e.admin)).toEqual(["poll_created"]);
    // The creator has no vote, so is told.
    expect(await kindsOf(e, e.owner)).toEqual(["date_fixed"]);
  });
});

describe("reminders", () => {
  it("goes to participants without a vote, only from the creator, at most every 24 hours", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.ben]);
    await vote(e, poll, e.anna);
    expect((await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.anna.token })).statusCode).toBe(403);
    const adminTry = await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.admin.token });
    expect(adminTry.statusCode).toBe(403);
    expect(code(adminTry)).toBe("forbidden");
    expect((await call(e, "POST", `/api/polls/99999/reminders`, { token: e.owner.token })).statusCode).toBe(404);
    expect((await call(e, "POST", `/api/polls/${poll.id}/reminders`)).statusCode).toBe(401);

    const first = await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.owner.token });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<ReminderSent>()).toEqual({ sentAt: e.clock.now().toISOString(), recipients: 1 });
    expect(await kindsOf(e, e.ben)).toEqual(["poll_created", "reminder"]);
    expect(await kindsOf(e, e.anna)).toEqual(["poll_created"]);
    expect((await kindsOf(e, e.owner)).includes("reminder")).toBe(false);

    e.clock.advanceHours(23);
    const tooSoon = await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.owner.token });
    expect(tooSoon.statusCode).toBe(429);
    expect(code(tooSoon)).toBe("reminder_too_soon");
    expect(tooSoon.json<ApiErrorBody>().retryAfterSeconds).toBe(3600);

    const view = await call(e, "GET", `${link(poll)}`, { token: e.owner.token });
    expect(view.json<PollView>().lastReminderAt).toBe("2026-11-01T10:00:00.000Z");
    const guestView = await call(e, "GET", link(poll), { token: e.anna.token });
    expect(guestView.json<PollView>().lastReminderAt).toBeUndefined();

    e.clock.advanceHours(1);
    expect((await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.owner.token })).statusCode).toBe(200);
  });

  it("is refused once the date is fixed", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await fix(e, poll, 0);
    const response = await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.owner.token });
    expect(response.statusCode).toBe(409);
    expect(code(response)).toBe("poll_fixed");
  });

  it("with nobody to remind sends nothing and does not use up the 24 hours", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await vote(e, poll, e.anna);
    const first = await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.owner.token });
    expect(first.json<ReminderSent>().recipients).toBe(0);
    const view = await call(e, "GET", link(poll), { token: e.owner.token });
    expect(view.json<PollView>().lastReminderAt).toBeNull();
    // Someone still to vote: a second try works at once.
    const poll2 = await createPoll(e, [e.anna]);
    expect((await call(e, "POST", `/api/polls/${poll2.id}/reminders`, { token: e.owner.token })).json<ReminderSent>().recipients).toBe(1);
  });

  it("respects the setting of the participants", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await setSettings(e, e.anna, { reminder: false });
    const response = await call(e, "POST", `/api/polls/${poll.id}/reminders`, { token: e.owner.token });
    expect(response.json<ReminderSent>().recipients).toBe(0);
  });
});

describe("settings", () => {
  it("has defaults without a row, stores the full body and rejects incomplete or unknown bodies", async () => {
    const e = await setup();
    const defaults = await call(e, "GET", "/api/me/notification-settings", { token: e.anna.token });
    expect(defaults.json()).toEqual({
      pollCreated: true, voteOwn: true, voteOthers: false, allVotedOwn: true, allVotedOthers: false, dateFixed: true, reminder: true,
    });
    const saved = await setSettings(e, e.anna, { voteOthers: true, reminder: false });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ voteOthers: true, reminder: false, pollCreated: true });
    expect((await call(e, "GET", "/api/me/notification-settings", { token: e.anna.token })).json()).toMatchObject({ voteOthers: true, reminder: false });
    // Someone else still has the defaults; a second save updates the same row.
    expect((await call(e, "GET", "/api/me/notification-settings", { token: e.ben.token })).json()).toMatchObject({ voteOthers: false });
    expect((await setSettings(e, e.anna, { voteOthers: false })).json()).toMatchObject({ voteOthers: false, reminder: true });
    const incomplete = await call(e, "PUT", "/api/me/notification-settings", { token: e.anna.token, body: { pollCreated: false } });
    expect(incomplete.statusCode).toBe(400);
    expect(code(incomplete)).toBe("validation");
    expect((await call(e, "GET", "/api/me/notification-settings")).statusCode).toBe(401);
  });
});

describe("push subscriptions", () => {
  it("serves the public key to logged-in users", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/push/public-key", { token: e.anna.token });
    expect(response.json<PushPublicKey>().publicKey).toMatch(/^[A-Za-z0-9_-]{80,100}$/);
    expect((await call(e, "GET", "/api/push/public-key")).statusCode).toBe(401);
  });

  it.each([
    ["another host", "https://example.com/push/abc"],
    ["a look-alike host", "https://fcm.googleapis.com.evil.example/x"],
    ["a suffix without a dot", "https://evilpush.apple.com.example/x"],
    ["http", "http://fcm.googleapis.com/fcm/send/x"],
    ["another port", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["user info", "https://user:pw@fcm.googleapis.com/fcm/send/x"],
    ["an address", "https://127.0.0.1/x"],
    ["not an address", "fcm.googleapis.com/x"],
    ["a too long address", `https://fcm.googleapis.com/${"a".repeat(2100)}`],
  ])("rejects %s", async (_label, endpoint) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/push/subscriptions", {
      token: e.anna.token,
      body: { endpoint, keys: { p256dh: P256DH, auth: AUTH } },
    });
    expect(response.statusCode).toBe(400);
    expect(code(response)).toBe("push_endpoint_invalid");
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/x",
    "https://web.push.apple.com/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://autopush.push.services.mozilla.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://api.push.apple.com:443/x",
  ])("accepts %s", async (endpoint) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/push/subscriptions", {
      token: e.anna.token,
      body: { endpoint, keys: { p256dh: P256DH, auth: AUTH } },
    });
    expect(response.statusCode, response.body).toBe(204);
  });

  it("rejects malformed keys", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/push/subscriptions", {
      token: e.anna.token,
      body: { endpoint: endpointOf("x"), keys: { p256dh: "not base64url!", auth: AUTH } },
    });
    expect(code(response)).toBe("push_endpoint_invalid");
  });

  it("moves an address to the latest account, keeps at most 10 per account and deletes only own", async () => {
    const e = await setup();
    await subscribe(e, e.anna, "shared");
    await subscribe(e, e.ben, "shared");
    const count = (id: number) => (e.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(id) as { n: number }).n;
    expect([count(e.anna.id), count(e.ben.id)]).toEqual([0, 1]);

    for (let i = 0; i < 11; i++) {
      e.clock.advance(1000);
      await subscribe(e, e.cara, `device${i}`);
    }
    expect(count(e.cara.id)).toBe(10);
    const endpoints = (e.db.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?").all(e.cara.id) as { endpoint: string }[]).map((r) => r.endpoint);
    expect(endpoints).not.toContain(endpointOf("device0"));
    expect(endpoints).toContain(endpointOf("device10"));

    // Someone else cannot remove it; the owner can.
    const foreign = await call(e, "DELETE", "/api/push/subscriptions", { token: e.anna.token, body: { endpoint: endpointOf("device10") } });
    expect(foreign.statusCode).toBe(204);
    expect(count(e.cara.id)).toBe(10);
    const own = await call(e, "DELETE", "/api/push/subscriptions", { token: e.cara.token, body: { endpoint: endpointOf("device10") } });
    expect(own.statusCode).toBe(204);
    expect(count(e.cara.id)).toBe(9);
  });

  it("is removed when the push service says it is gone (404 and 410) but kept on other failures, and the log has no address", async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const e = await setup({
      logStream,
      failWith: (target) =>
        target.endpoint.endsWith("gone") ? 410 : target.endpoint.endsWith("missing") ? 404 : target.endpoint.endsWith("broken") ? 500 : undefined,
    });
    await subscribe(e, e.anna, "gone");
    await subscribe(e, e.anna, "missing");
    await subscribe(e, e.anna, "broken");
    await subscribe(e, e.anna, "fine");
    await createPoll(e, [e.anna]);
    const remaining = () =>
      (e.db.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?").all(e.anna.id) as { endpoint: string }[]).map((r) => r.endpoint).sort();
    await vi.waitFor(() => expect(remaining()).toEqual([endpointOf("broken"), endpointOf("fine")]));
    const log = lines.join("");
    expect(log).toContain("Push message was not delivered");
    expect(log).toContain('"status":410');
    expect(log).not.toContain("fcm.googleapis.com");
    expect(log).not.toContain(P256DH);
  });
});

describe("the notification list", () => {
  it("shows only own notifications, after a given id, oldest first, at most 100", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna, e.ben]);
    await vote(e, poll, e.anna);
    await vote(e, poll, e.anna, "no");
    const mine = await notificationsOf(e, e.owner);
    expect(mine.map((i) => i.data.kind)).toEqual(["vote", "vote"]);
    expect(mine[0]!.id).toBeLessThan(mine[1]!.id);
    expect(await notificationsOf(e, e.owner, mine[0]!.id)).toEqual([mine[1]]);
    expect(await notificationsOf(e, e.owner, mine[1]!.id)).toEqual([]);
    expect((await notificationsOf(e, e.ben)).map((i) => i.data.kind)).toEqual(["poll_created"]);
    expect((await call(e, "GET", "/api/notifications?after=abc", { token: e.owner.token })).statusCode).toBe(400);
    expect((await call(e, "GET", "/api/notifications")).statusCode).toBe(401);
  });

  it("caps the page at 100", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    for (let i = 0; i < 105; i++) await vote(e, poll, e.anna, i % 2 ? "yes" : "no");
    const first = await notificationsOf(e, e.owner);
    expect(first).toHaveLength(100);
    expect(await notificationsOf(e, e.owner, first.at(-1)!.id)).toHaveLength(5);
  });

  it("deletes notifications after 7 days", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    await vote(e, poll, e.anna);
    expect(await kindsOf(e, e.owner)).toEqual(["vote"]);
    e.clock.advanceDays(6);
    expect(await kindsOf(e, e.owner)).toEqual(["vote"]);
    e.clock.advanceDays(2);
    // Old ones are hidden at once and removed from the table with the next notification.
    expect(await kindsOf(e, e.owner)).toEqual([]);
    await vote(e, poll, e.anna, "no");
    const rows = e.db.prepare("SELECT created_at FROM notifications WHERE user_id = ?").all(e.owner.id);
    expect(rows).toHaveLength(1);
    expect(await kindsOf(e, e.owner)).toEqual(["vote"]);
  });

  it("goes away with the poll", async () => {
    const e = await setup();
    const poll = await createPoll(e, [e.anna]);
    const response = await call(e, "DELETE", `/api/polls/${poll.id}`, { token: e.owner.token });
    expect(response.statusCode).toBe(204);
    expect(await notificationsOf(e, e.anna)).toEqual([]);
  });
});

describe("account deletion", () => {
  it("removes subscriptions, settings and notifications of the account", async () => {
    const e = await setup();
    await subscribe(e, e.anna, "annas");
    await setSettings(e, e.anna, { voteOthers: true });
    await createPoll(e, [e.anna]);
    const count = (table: string) => (e.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(e.anna.id) as { n: number }).n;
    expect([count("push_subscriptions"), count("notification_prefs"), count("notifications")]).toEqual([1, 1, 1]);
    const response = await call(e, "DELETE", `/api/admin/users/${e.anna.id}`, { token: e.admin.token });
    expect(response.statusCode).toBe(204);
    expect([count("push_subscriptions"), count("notification_prefs"), count("notifications")]).toEqual([0, 0, 0]);
  });
});

describe("VAPID keys", () => {
  it("are made once and stay the same when the server starts again on the same file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lf-vapid-"));
    const path = join(tempDir, "data.db");
    const keyOf = async () => {
      const clock = new TestClock();
      const app = await buildApp(testConfig({ databasePath: path }), { now: clock.now, db: openDatabase(path), sendPush: async () => {} });
      const db = openDatabase(path);
      const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'vapid_%' ORDER BY key").all();
      db.close();
      await app.close();
      return rows;
    };
    const first = await keyOf();
    const second = await keyOf();
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
  });
});
