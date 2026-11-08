import type {
  AdminUser,
  ApiErrorBody,
  Calendar,
  NotificationItem,
  NotificationList,
  PollView,
} from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CalendarCache } from "../src/calendars/cache.js";
import { createCalendarEnv, GOOGLE_LINK, ics, OUTLOOK_LINK, type CalendarEnv } from "./calendar-helpers.js";
import { addUserWithSession, call, DEFAULT_PASSWORD } from "./helpers.js";

let env: CalendarEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

const SLOT_A = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };
const SLOT_B = { start: "2026-11-08T17:00:00.000Z", end: "2026-11-08T19:00:00.000Z" };

async function setup() {
  const cache = new CalendarCache(() => new Date());
  env = await createCalendarEnv({}, { calendarCache: cache });
  const admin = await addUserWithSession(env, "Chef", { isAdmin: true });
  const admin2 = await addUserWithSession(env, "Chefin", { isAdmin: true });
  const me = await addUserWithSession(env, "Vincent R.");
  const other = await addUserWithSession(env, "Anna K.");
  return { ...env, cache, admin, admin2, me, other };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const remove = (e: Setup, token: string, password: unknown = DEFAULT_PASSWORD) =>
  call(e, "DELETE", "/api/me", { token, body: { password } });

async function notificationsOf(e: Setup, token: string): Promise<NotificationItem[]> {
  const response = await call(e, "GET", "/api/notifications", { token });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<NotificationList>().items;
}

/** Adds a calendar and reads it once, so its contents sit in the memory cache. */
async function addCachedCalendar(e: Setup, token: string, link: string): Promise<number> {
  e.feeds.set(link, ics([], "Kalender"));
  const added = await call(e, "POST", "/api/calendars", { token, body: { link } });
  expect(added.statusCode, added.body).toBe(201);
  const preview = await call(e, "GET", "/api/calendars/preview", { token });
  expect(preview.statusCode, preview.body).toBe(200);
  return added.json<Calendar>().id;
}

describe("DELETE /api/me", () => {
  it("refuses a wrong password and keeps the account", async () => {
    const e = await setup();
    const response = await remove(e, e.me.token, "not the password");
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().code).toBe("wrong_password");
    expect((await call(e, "GET", "/api/me", { token: e.me.token })).statusCode).toBe(200);
    expect(await notificationsOf(e, e.admin.token)).toEqual([]);
  });

  it("refuses a missing or too long password by validation", async () => {
    const e = await setup();
    expect((await call(e, "DELETE", "/api/me", { token: e.me.token, body: {} })).statusCode).toBe(400);
    expect((await remove(e, e.me.token, "x".repeat(1001))).statusCode).toBe(400);
    expect((await call(e, "GET", "/api/me", { token: e.me.token })).statusCode).toBe(200);
  });

  it("blocks after 5 wrong passwords, together with the password change", async () => {
    const e = await setup();
    for (let i = 0; i < 5; i++) expect((await remove(e, e.me.token, "not the password")).statusCode).toBe(400);
    const blocked = await remove(e, e.me.token);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>()).toMatchObject({ code: "rate_limited", retryAfterSeconds: 15 * 60 });
    expect((await call(e, "GET", "/api/me", { token: e.me.token })).statusCode).toBe(200);

    e.clock.advanceMinutes(16);
    expect((await remove(e, e.me.token)).statusCode).toBe(204);
  });

  it("refuses an admin with cannot_delete_self, even with the right password", async () => {
    const e = await setup();
    const response = await remove(e, e.admin.token);
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().code).toBe("cannot_delete_self");
    expect((await call(e, "GET", "/api/me", { token: e.admin.token })).statusCode).toBe(200);
    expect(await notificationsOf(e, e.admin2.token)).toEqual([]);
  });

  it("needs a login", async () => {
    const e = await setup();
    expect((await call(e, "DELETE", "/api/me", { body: { password: DEFAULT_PASSWORD } })).statusCode).toBe(401);
  });

  it("deletes the account: token dead, polls stay without creator, votes and calendars go", async () => {
    const e = await setup();
    const own = await call(e, "POST", "/api/polls", {
      token: e.me.token,
      body: { title: "Spieleabend", kind: "timed", proposals: [SLOT_A, SLOT_B], participants: [e.other.id] },
    });
    expect(own.statusCode, own.body).toBe(201);
    const ownPoll = own.json<PollView>();
    const foreign = await call(e, "POST", "/api/polls", {
      token: e.other.token,
      body: { title: "Grillen", kind: "timed", proposals: [SLOT_A, SLOT_B], participants: [e.me.id] },
    });
    const foreignPoll = foreign.json<PollView>();
    const voted = await call(e, "PUT", `/api/poll-links/${foreignPoll.shareToken}/my-vote`, {
      token: e.me.token,
      body: { answers: foreignPoll.proposals.map((p) => ({ proposalId: p.id, answer: "yes" })) },
    });
    expect(voted.statusCode, voted.body).toBe(200);
    const calendarIds = [await addCachedCalendar(e, e.me.token, GOOGLE_LINK), await addCachedCalendar(e, e.me.token, OUTLOOK_LINK)];
    expect(e.cache.size()).toBe(2);
    e.db.prepare("INSERT INTO people_groups (user_id, name, name_key, created_at) VALUES (?, 'Team', 'team', 'a')").run(e.me.id);

    const response = await remove(e, e.me.token);
    expect(response.statusCode, response.body).toBe(204);
    expect(response.body).toBe("");

    expect((await call(e, "GET", "/api/me", { token: e.me.token })).statusCode).toBe(401);
    const users = (await call(e, "GET", "/api/admin/users", { token: e.admin.token })).json<AdminUser[]>();
    expect(users.map((u) => u.username).sort()).toEqual(["Anna K.", "Chef", "Chefin"]);
    // Their poll stays, without creator.
    expect(e.db.prepare("SELECT title, creator_id FROM polls WHERE id = ?").get(ownPoll.id)).toEqual({ title: "Spieleabend", creator_id: null });
    // Their vote in somebody else's poll is gone.
    const after = (await call(e, "GET", `/api/poll-links/${foreignPoll.shareToken}`, { token: e.other.token })).json<PollView>();
    expect(after.votes).toEqual([]);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM calendars").get()).toEqual({ n: 0 });
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM people_groups").get()).toEqual({ n: 0 });
    // The calendar contents left the memory at once.
    expect(e.cache.size()).toBe(0);
    expect(calendarIds).toHaveLength(2);
  });

  it("tells every other admin, always, and keeps the notification after the user is gone", async () => {
    const e = await setup();
    // No setting is consulted: an admin who switched everything off still gets it.
    const off = await call(e, "PUT", "/api/me/notification-settings", {
      token: e.admin2.token,
      body: { pollCreated: false, voteOwn: false, voteOthers: false, allVotedOwn: false, allVotedOthers: false, dateFixed: false, reminder: false },
    });
    expect(off.statusCode, off.body).toBe(200);

    expect((await remove(e, e.me.token)).statusCode).toBe(204);

    for (const admin of [e.admin, e.admin2]) {
      const items = await notificationsOf(e, admin.token);
      expect(items).toHaveLength(1);
      expect(items[0]!.data).toEqual({ kind: "account_deleted", actorName: "Vincent R." });
    }
    expect(await notificationsOf(e, e.other.token)).toEqual([]);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE poll_id IS NULL").get()).toEqual({ n: 2 });
  });

  it("does not fail when there is no other admin", async () => {
    const e = await setup();
    e.db.prepare("DELETE FROM users WHERE is_admin = 1").run();
    expect((await remove(e, e.me.token)).statusCode).toBe(204);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("drops the deleted user's calendars from the memory cache", async () => {
    const e = await setup();
    await addCachedCalendar(e, e.me.token, GOOGLE_LINK);
    await addCachedCalendar(e, e.other.token, OUTLOOK_LINK);
    expect(e.cache.size()).toBe(2);

    const response = await call(e, "DELETE", `/api/admin/users/${e.me.id}`, { token: e.admin.token });
    expect(response.statusCode).toBe(204);
    expect(e.cache.size()).toBe(1);
  });
});
