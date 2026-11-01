import type {
  AdminUser,
  ApiErrorBody,
  Calendar,
  CalendarList,
  CalendarPreview,
  CalendarProvider,
} from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { decryptSecret, encryptSecret, prepareCalendarKey } from "../src/calendar-key.js";
import { normalizeCalendarUrl } from "../src/calendars/fetch.js";
import { insertCalendar } from "../src/calendars/store.js";
import { openDatabase } from "../src/db.js";
import {
  APPLE_LINK,
  CALENDAR_KEY,
  captureLog,
  createCalendarEnv,
  FakeFeeds,
  GOOGLE_LINK,
  ics,
  OTHER_LINK,
  OUTLOOK_LINK,
  type CalendarEnv,
} from "./calendar-helpers.js";
import { addUserWithSession, allStrings, call, testConfig, TestClock } from "./helpers.js";

let env: CalendarEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

const EMPTY = ics([], "Mein Kalender");

async function setup(overrides: Parameters<typeof createCalendarEnv>[0] = {}) {
  env = await createCalendarEnv(overrides);
  const me = await addUserWithSession(env, "Vincent R.");
  const other = await addUserWithSession(env, "Anna K.");
  return { ...env, me, other };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** Teaches the fake network a link, then hands the environment back (to chain into `add`). */
function withFeed<T extends { feeds: FakeFeeds }>(e: T, link: string, reply: Parameters<FakeFeeds["set"]>[1]): T {
  e.feeds.set(link, reply);
  return e;
}

async function add(e: Setup, link: string, body: Record<string, unknown> = {}, token = e.me.token): Promise<Calendar> {
  const response = await call(e, "POST", "/api/calendars", { token, body: { link, ...body } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Calendar>();
}

const list = async (e: Setup, token = e.me.token) =>
  (await call(e, "GET", "/api/calendars", { token })).json<CalendarList>();
const code = (response: { json: <T>() => T }) => response.json<ApiErrorBody>().code;

describe("login", () => {
  const routes: ["GET" | "POST" | "PATCH" | "DELETE", string, unknown?][] = [
    ["GET", "/api/calendars"],
    ["GET", "/api/calendars/preview"],
    ["POST", "/api/calendars", { link: GOOGLE_LINK }],
    ["PATCH", "/api/calendars/1", { name: "x" }],
    ["DELETE", "/api/calendars/1"],
  ];
  it.each(routes)("%s %s answers 401 without a login", async (method, url, body) => {
    const e = await setup();
    const response = await call(e, method, url, { body });
    expect(response.statusCode).toBe(401);
    expect(code(response)).toBe("unauthorized");
    expect(e.feeds.calls).toEqual([]);
  });
});

describe("GET /api/calendars", () => {
  it("is ready and empty at first", async () => {
    const e = await setup();
    expect(await list(e)).toEqual({ state: "ready", calendars: [] });
  });

  it("says unavailable, but still answers, without a key", async () => {
    env = await createCalendarEnv({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const me = await addUserWithSession(env, "Vincent R.");
    const response = await call(env, "GET", "/api/calendars", { token: me.token });
    expect(response.statusCode).toBe(200);
    expect(response.json<CalendarList>()).toEqual({ state: "unavailable", calendars: [] });
  });

  it("says unavailable with the wrong key", async () => {
    const clock = new TestClock();
    const db = openDatabase(":memory:");
    prepareCalendarKey(db, Buffer.alloc(32, 1)); // the links were made with another key
    const feeds = new FakeFeeds();
    const app = await buildApp(testConfig({ calendarKey: Buffer.alloc(32, "wrong".charCodeAt(0)) }), {
      now: clock.now,
      db,
      fetchCalendarText: feeds.fetch,
    });
    env = { app, db, clock, feeds };
    const me = await addUserWithSession(env, "Vincent R.");
    expect((await call(env, "GET", "/api/calendars", { token: me.token })).json<CalendarList>().state).toBe(
      "unavailable",
    );
    for (const [method, url, body] of [
      ["GET", "/api/calendars/preview", undefined],
      ["POST", "/api/calendars", { link: GOOGLE_LINK }],
    ] as const) {
      const response = await call(env, method, url, { token: me.token, body });
      expect(response.statusCode).toBe(503);
      expect(code(response)).toBe("calendars_unavailable");
    }
    expect(feeds.calls).toEqual([]);
  });

  it("shows the default first, then the others in the order they were added", async () => {
    const e = await setup();
    const a = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK, { name: "A" });
    const b = await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK, { name: "B" });
    const c = await add(withFeed(e, OTHER_LINK, EMPTY), OTHER_LINK, { name: "C" });
    expect((await list(e)).calendars.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    await call(e, "PATCH", `/api/calendars/${c.id}`, { token: e.me.token, body: { isDefault: true } });
    expect((await list(e)).calendars.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it("shows only the caller's own calendars", async () => {
    const e = await setup();
    e.feeds.set(GOOGLE_LINK, EMPTY).set(APPLE_LINK, EMPTY);
    await add(e, GOOGLE_LINK, { name: "Mine" });
    await add(e, APPLE_LINK, { name: "Hers" }, e.other.token);
    expect((await list(e)).calendars.map((x) => x.name)).toEqual(["Mine"]);
    expect((await list(e, e.other.token)).calendars.map((x) => x.name)).toEqual(["Hers"]);
  });
});

describe("POST /api/calendars", () => {
  it("adds a calendar with the feed's name, provider and default, and fetches the link once", async () => {
    const e = await setup();
    e.feeds.set(GOOGLE_LINK, ics([], "Familie"));
    const response = await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link: GOOGLE_LINK } });
    expect(response.statusCode).toBe(201);
    expect(response.json<Calendar>()).toEqual({
      id: expect.any(Number),
      name: "Familie",
      provider: "google",
      countsAsBusy: true,
      isDefault: true,
      status: "ok",
      createdAt: e.clock.now().toISOString(),
    });
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(1);
  });

  it.each([
    [GOOGLE_LINK, "google"],
    [APPLE_LINK, "apple"],
    [OUTLOOK_LINK, "outlook"],
    [OTHER_LINK, "other"],
  ] as [string, CalendarProvider][])("tells the provider of %s", async (link, provider) => {
    const e = await setup();
    expect((await add(withFeed(e, link, EMPTY), link)).provider).toBe(provider);
  });

  it("only the first calendar becomes the default", async () => {
    const e = await setup();
    const first = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const second = await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);
    // Another person's first calendar is that person's default.
    expect((await add(withFeed(e, OTHER_LINK, EMPTY), OTHER_LINK, {}, e.other.token)).isDefault).toBe(true);
  });

  it("takes the given name (normalized) before the feed's name", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, ics([], "Familie")), GOOGLE_LINK, { name: "  Mein   \t Kalender " });
    expect(calendar.name).toBe("Mein Kalender");
  });

  it("uses the feed's name when the given one is empty, and cuts a long one", async () => {
    const e = await setup();
    const long = "ä".repeat(80);
    const calendar = await add(withFeed(e, GOOGLE_LINK, ics([], long)), GOOGLE_LINK, { name: "   " });
    expect(calendar.name).toBe("ä".repeat(60));
  });

  it("stores an empty name when there is none (the app shows the provider)", async () => {
    const e = await setup();
    expect((await add(withFeed(e, GOOGLE_LINK, ics([])), GOOGLE_LINK)).name).toBe("");
  });

  it("refuses a given name longer than 60 characters before fetching anything", async () => {
    const e = await setup();
    e.feeds.set(GOOGLE_LINK, EMPTY);
    const response = await call(e, "POST", "/api/calendars", {
      token: e.me.token,
      body: { link: GOOGLE_LINK, name: "x".repeat(61) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "name" });
    expect(e.feeds.calls).toEqual([]);
    expect((await list(e)).calendars).toEqual([]);
  });

  it.each([
    ["no link", {}],
    ["a number as link", { link: 5 }],
    ["a link that is too long", { link: "https://example.com/" + "a".repeat(2048) }],
    ["a name that is not text", { link: GOOGLE_LINK, name: 5 }],
  ])("answers a validation error for %s", async (_label, body) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/calendars", { token: e.me.token, body });
    expect(response.statusCode).toBe(400);
    expect(code(response)).toBe("validation");
    expect(e.feeds.calls).toEqual([]);
  });

  it.each(["", "   ", "http://calendar.google.com/x.ics", "ftp://example.com/x.ics", "not a link", "https://user:pw@example.com/x.ics", "https://example.com:8443/x.ics", "https://127.0.0.1/x.ics"])(
    "refuses the link %j as invalid without fetching",
    async (link) => {
      const e = await setup();
      const response = await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link } });
      expect(response.statusCode).toBe(400);
      expect(response.json<ApiErrorBody>()).toMatchObject({ code: "calendar_link_invalid", field: "link" });
      expect(e.feeds.calls).toEqual([]);
    },
  );

  it.each([
    ["blocked_address", 400, "calendar_link_blocked"],
    ["gone", 400, "calendar_gone"],
    ["unreachable", 502, "calendar_unreachable"],
    ["too_large", 400, "calendar_too_large"],
    ["invalid_link", 400, "calendar_link_invalid"],
  ] as const)("maps the fetch failure %s to %i %s and stores nothing", async (reason, status, expected) => {
    const e = await setup();
    e.feeds.fail(GOOGLE_LINK, reason);
    const response = await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link: GOOGLE_LINK } });
    expect(response.statusCode).toBe(status);
    expect(code(response)).toBe(expected);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(1);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM calendars").get() as { n: number }).n).toBe(0);
    expect((await list(e)).calendars).toEqual([]);
  });

  it("refuses something that is not a calendar (400 calendar_not_ics) and stores nothing", async () => {
    const e = await setup();
    e.feeds.set(GOOGLE_LINK, "<html><body>Please log in</body></html>");
    const response = await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link: GOOGLE_LINK } });
    expect(response.statusCode).toBe(400);
    expect(code(response)).toBe("calendar_not_ics");
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM calendars").get() as { n: number }).n).toBe(0);
  });

  it("answers 503 calendars_unavailable without a key and fetches nothing", async () => {
    env = await createCalendarEnv({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const me = await addUserWithSession(env, "Vincent R.");
    env.feeds.set(GOOGLE_LINK, EMPTY);
    const response = await call(env, "POST", "/api/calendars", { token: me.token, body: { link: GOOGLE_LINK } });
    expect(response.statusCode).toBe(503);
    expect(code(response)).toBe("calendars_unavailable");
    expect(env.feeds.calls).toEqual([]);
  });

  it("allows 10 calendars and refuses the 11th with 409 calendar_limit, without fetching", async () => {
    const e = await setup();
    for (let i = 0; i < 10; i++) {
      await add(withFeed(e, `https://kalender.example.org/${i}.ics`, EMPTY), `https://kalender.example.org/${i}.ics`);
    }
    const before = e.feeds.calls.length;
    e.feeds.set(GOOGLE_LINK, EMPTY);
    const response = await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link: GOOGLE_LINK } });
    expect(response.statusCode).toBe(409);
    expect(code(response)).toBe("calendar_limit");
    expect(e.feeds.calls.length).toBe(before);
    // The limit is per person.
    expect((await add(e, GOOGLE_LINK, {}, e.other.token)).isDefault).toBe(true);
  });

  it("limits link checks to 20 per person and window (429 rate_limited), then lets them through again", async () => {
    const e = await setup();
    e.feeds.fail(GOOGLE_LINK, "unreachable");
    for (let i = 0; i < 20; i++) {
      expect((await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link: GOOGLE_LINK } })).statusCode).toBe(
        502,
      );
    }
    const blocked = await call(e, "POST", "/api/calendars", { token: e.me.token, body: { link: GOOGLE_LINK } });
    expect(blocked.statusCode).toBe(429);
    expect(code(blocked)).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(20);
    // Another person is not affected.
    e.feeds.set(APPLE_LINK, EMPTY);
    await add(e, APPLE_LINK, {}, e.other.token);
    // After the window it works again.
    e.clock.advanceMinutes(16);
    e.feeds.set(GOOGLE_LINK, EMPTY);
    await add(e, GOOGLE_LINK);
  });

  it("counts a new link on PATCH as an attempt too, and a PATCH without link as none", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    e.feeds.fail(APPLE_LINK, "unreachable");
    for (let i = 0; i < 19; i++) {
      await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { name: `Name ${i}` } });
    }
    // 1 (the POST) + 19 failed links = 20 attempts.
    for (let i = 0; i < 19; i++) {
      expect(
        (await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { link: APPLE_LINK } }))
          .statusCode,
      ).toBe(502);
    }
    const blocked = await call(e, "PATCH", `/api/calendars/${calendar.id}`, {
      token: e.me.token,
      body: { link: APPLE_LINK },
    });
    expect(blocked.statusCode).toBe(429);
    expect(
      (await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { name: "Still works" } }))
        .statusCode,
    ).toBe(200);
  });
});

describe("PATCH /api/calendars/:id", () => {
  it("changes name, countsAsBusy and default", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const second = await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    const response = await call(e, "PATCH", `/api/calendars/${second.id}`, {
      token: e.me.token,
      body: { name: "  Geburtstage ", countsAsBusy: false, isDefault: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<Calendar>()).toMatchObject({ id: second.id, name: "Geburtstage", countsAsBusy: false, isDefault: true });
    const calendars = (await list(e)).calendars;
    expect(calendars.map((c) => c.isDefault)).toEqual([true, false]);
    expect(calendars[0]!.id).toBe(second.id);
  });

  it("allows an empty name (the app shows the provider) and an empty body", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, ics([], "Familie")), GOOGLE_LINK);
    const blank = await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { name: "  " } });
    expect(blank.json<Calendar>().name).toBe("");
    const nothing = await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: {} });
    expect(nothing.statusCode).toBe(200);
  });

  it.each([
    ["a name that is too long", { name: "x".repeat(61) }, "name"],
    ["isDefault false", { isDefault: false }, "isDefault"],
    ["countsAsBusy as text", { countsAsBusy: "yes" }, "countsAsBusy"],
  ])("answers a validation error for %s and changes nothing", async (_label, body, field) => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, ics([], "Familie")), GOOGLE_LINK);
    const response = await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field });
    expect((await list(e)).calendars[0]!.name).toBe("Familie");
  });

  it("does name, busy and default changes without the key", async () => {
    env = await createCalendarEnv({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const me = await addUserWithSession(env, "Vincent R.");
    const now = env.clock.now().toISOString();
    const id = insertCalendar(env.db, { userId: me.id, name: "A", provider: "google", linkEncrypted: "v1.x", now });
    const second = insertCalendar(env.db, { userId: me.id, name: "B", provider: "other", linkEncrypted: "v1.y", now });
    const response = await call(env, "PATCH", `/api/calendars/${second}`, {
      token: me.token,
      body: { name: "Neu", countsAsBusy: false, isDefault: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<Calendar>()).toMatchObject({ name: "Neu", countsAsBusy: false, isDefault: true });
    expect((await call(env, "GET", "/api/calendars", { token: me.token })).json<CalendarList>().calendars[1]!.id).toBe(id);
    // A new link needs the key.
    const withLink = await call(env, "PATCH", `/api/calendars/${id}`, { token: me.token, body: { link: GOOGLE_LINK } });
    expect(withLink.statusCode).toBe(503);
    expect(code(withLink)).toBe("calendars_unavailable");
  });

  it("replaces the link after checking it, sets the status ok and forgets the old contents", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, ics([{ start: "2026-11-05T09:00:00Z", end: "2026-11-05T10:00:00Z", summary: "Alt" }], "Alt")), GOOGLE_LINK);
    e.db.prepare("UPDATE calendars SET status = 'broken'").run();
    e.feeds.set(OUTLOOK_LINK, ics([{ start: "2026-11-06T09:00:00Z", end: "2026-11-06T10:00:00Z", summary: "Neu" }], "Neu"));
    const response = await call(e, "PATCH", `/api/calendars/${calendar.id}`, {
      token: e.me.token,
      body: { link: OUTLOOK_LINK },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<Calendar>()).toMatchObject({ id: calendar.id, provider: "outlook", status: "ok", name: "Alt" });
    const stored = (e.db.prepare("SELECT link_encrypted FROM calendars").get() as { link_encrypted: string }).link_encrypted;
    expect(decryptSecret(CALENDAR_KEY, stored)).toBe(new URL(OUTLOOK_LINK).href);
    const preview = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(preview.events.map((x) => x.title)).toEqual(["Neu"]);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(1);
    expect(e.feeds.callsFor(OUTLOOK_LINK)).toBe(1); // the check filled the cache, the preview did not fetch again
  });

  it("keeps the old link when the new one does not work", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const before = (e.db.prepare("SELECT * FROM calendars").get() as object);
    for (const [reply, status, expected] of [
      [{ ok: false, reason: "gone" }, 400, "calendar_gone"],
      [{ ok: false, reason: "unreachable" }, 502, "calendar_unreachable"],
      [{ ok: true, text: "nope" }, 400, "calendar_not_ics"],
    ] as const) {
      e.feeds.set(OUTLOOK_LINK, reply);
      const response = await call(e, "PATCH", `/api/calendars/${calendar.id}`, {
        token: e.me.token,
        body: { link: OUTLOOK_LINK, name: "Should not stick" },
      });
      expect(response.statusCode).toBe(status);
      expect(code(response)).toBe(expected);
    }
    const invalid = await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { link: "http://x.example/a.ics" } });
    expect(code(invalid)).toBe("calendar_link_invalid");
    expect(e.db.prepare("SELECT * FROM calendars").get()).toEqual(before);
  });

  it("answers 404 for another person's calendar and changes nothing", async () => {
    const e = await setup();
    const theirs = await add(withFeed(e, GOOGLE_LINK, ics([], "Hers")), GOOGLE_LINK, {}, e.other.token);
    e.feeds.set(APPLE_LINK, EMPTY);
    const before = JSON.stringify(e.db.prepare("SELECT * FROM calendars").all());
    for (const body of [{ name: "Mine now" }, { countsAsBusy: false }, { isDefault: true }, { link: APPLE_LINK }]) {
      const response = await call(e, "PATCH", `/api/calendars/${theirs.id}`, { token: e.me.token, body });
      expect(response.statusCode).toBe(404);
      expect(code(response)).toBe("not_found");
    }
    expect(JSON.stringify(e.db.prepare("SELECT * FROM calendars").all())).toBe(before);
    expect(e.feeds.callsFor(APPLE_LINK)).toBe(0);
  });

  it.each(["999", "abc", "-1", "1.5"])("answers 404 for the id %s", async (id) => {
    const e = await setup();
    expect((await call(e, "PATCH", `/api/calendars/${id}`, { token: e.me.token, body: { name: "x" } })).statusCode).toBe(404);
  });

  it("making a calendar the default clears it on the person's others only", async () => {
    const e = await setup();
    const mine1 = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const mine2 = await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    const hers = await add(withFeed(e, OTHER_LINK, EMPTY), OTHER_LINK, {}, e.other.token);
    await call(e, "PATCH", `/api/calendars/${mine2.id}`, { token: e.me.token, body: { isDefault: true } });
    await call(e, "PATCH", `/api/calendars/${mine2.id}`, { token: e.me.token, body: { isDefault: true } });
    const rows = e.db.prepare("SELECT id, is_default FROM calendars ORDER BY id").all() as { id: number; is_default: number }[];
    expect(rows).toEqual([
      { id: mine1.id, is_default: 0 },
      { id: mine2.id, is_default: 1 },
      { id: hers.id, is_default: 1 },
    ]);
  });
});

describe("DELETE /api/calendars/:id", () => {
  it("deletes the calendar (204) and forgets its contents", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const response = await call(e, "DELETE", `/api/calendars/${calendar.id}`, { token: e.me.token });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect((await list(e)).calendars).toEqual([]);
    expect((await call(e, "DELETE", `/api/calendars/${calendar.id}`, { token: e.me.token })).statusCode).toBe(404);
    // Added again, the link is fetched again: nothing stayed in the cache.
    await add(e, GOOGLE_LINK);
    await call(e, "GET", "/api/calendars/preview", { token: e.me.token });
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(2);
  });

  it("answers 404 for another person's calendar and keeps it", async () => {
    const e = await setup();
    const theirs = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK, {}, e.other.token);
    const response = await call(e, "DELETE", `/api/calendars/${theirs.id}`, { token: e.me.token });
    expect(response.statusCode).toBe(404);
    expect(code(response)).toBe("not_found");
    expect((await list(e, e.other.token)).calendars).toHaveLength(1);
  });

  it("hands the default to the oldest remaining calendar when the default is deleted", async () => {
    const e = await setup();
    const a = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const b = await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    const c = await add(withFeed(e, OTHER_LINK, EMPTY), OTHER_LINK);
    await call(e, "PATCH", `/api/calendars/${c.id}`, { token: e.me.token, body: { isDefault: true } });
    await call(e, "DELETE", `/api/calendars/${c.id}`, { token: e.me.token });
    expect((await list(e)).calendars.map((x) => [x.id, x.isDefault])).toEqual([
      [a.id, true],
      [b.id, false],
    ]);
    // Deleting one that is not the default leaves the default alone.
    await call(e, "DELETE", `/api/calendars/${b.id}`, { token: e.me.token });
    expect((await list(e)).calendars.map((x) => [x.id, x.isDefault])).toEqual([[a.id, true]]);
    await call(e, "DELETE", `/api/calendars/${a.id}`, { token: e.me.token });
    expect((await list(e)).calendars).toEqual([]);
  });

  it("works without the key", async () => {
    env = await createCalendarEnv({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const me = await addUserWithSession(env, "Vincent R.");
    const id = insertCalendar(env.db, { userId: me.id, name: "A", provider: "google", linkEncrypted: "v1.x", now: env.clock.now().toISOString() });
    expect((await call(env, "DELETE", `/api/calendars/${id}`, { token: me.token })).statusCode).toBe(204);
  });
});

describe("the link stays secret", () => {
  const SECRETS = ["secret-google-token-91", "private-abc", "secret-apple-token-77", "secret-outlook-token-55", "secret-other-token-33"];

  it("is in no response, no admin answer and no log line, and is encrypted in the database", async () => {
    const log = captureLog();
    env = await createCalendarEnv({ logLevel: "info" }, { logStream: log.stream });
    const me = await addUserWithSession(env, "Vincent R.");
    const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
    const e = { ...env, me, admin } as unknown as Setup & { admin: typeof admin };
    const bodies: string[] = [];
    const keep = async (promise: ReturnType<typeof call>) => {
      const response = await promise;
      bodies.push(response.body, JSON.stringify(response.headers));
      return response;
    };

    e.feeds.set(GOOGLE_LINK, ics([{ start: "2026-11-05T09:00:00Z", end: "2026-11-05T10:00:00Z", summary: "Termin" }], "Familie"));
    e.feeds.set(APPLE_LINK, EMPTY);
    e.feeds.fail(OUTLOOK_LINK, "gone");
    e.feeds.fail(OTHER_LINK, "unreachable");
    const google = (await keep(call(e, "POST", "/api/calendars", { token: me.token, body: { link: GOOGLE_LINK } }))).json<Calendar>();
    const apple = (await keep(call(e, "POST", "/api/calendars", { token: me.token, body: { link: APPLE_LINK } }))).json<Calendar>();
    await keep(call(e, "POST", "/api/calendars", { token: me.token, body: { link: OUTLOOK_LINK } }));
    await keep(call(e, "POST", "/api/calendars", { token: me.token, body: { link: OTHER_LINK } }));
    await keep(call(e, "POST", "/api/calendars", { token: me.token, body: { link: "http://secret-other-token-33.example/a" } }));
    await keep(call(e, "POST", "/api/calendars", { token: me.token, body: { link: "https://example.com/secret-other-token-33", name: "x".repeat(70) } }));
    await keep(call(e, "GET", "/api/calendars", { token: me.token }));
    await keep(call(e, "GET", "/api/calendars/preview", { token: me.token }));
    await keep(call(e, "PATCH", `/api/calendars/${apple.id}`, { token: me.token, body: { link: OUTLOOK_LINK } }));
    await keep(call(e, "PATCH", `/api/calendars/${apple.id}`, { token: me.token, body: { name: "Neu" } }));
    await keep(call(e, "GET", "/api/admin/users", { token: admin.token }));
    await keep(call(e, "DELETE", `/api/calendars/${google.id}`, { token: me.token }));
    // A stored link that cannot be decrypted is not a 500 either.
    e.db.prepare("INSERT INTO calendars (user_id, name, provider, link_encrypted, created_at, updated_at) VALUES (?, '', 'other', 'v1.garbage', 'x', 'x')").run(me.id);
    const preview = await keep(call(e, "GET", "/api/calendars/preview", { token: me.token }));
    expect(preview.statusCode).toBe(200);

    const all = bodies.join("\n");
    for (const secret of SECRETS) {
      expect(all).not.toContain(secret);
      expect(log.text()).not.toContain(secret);
    }
    expect(log.text()).toContain("/api/calendars"); // the log was really captured
    expect(all).not.toContain("calendar.google.com");
    expect(log.text()).not.toContain("calendar.google.com");
    expect(log.text()).not.toContain("icloud.com");
    expect(log.text()).not.toContain("kalender.example.org");

    // In the database only the encrypted form, which decrypts back with the key.
    const rows = e.db.prepare("SELECT link_encrypted FROM calendars WHERE id <> 0").all() as { link_encrypted: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const secret of SECRETS) expect(row.link_encrypted).not.toContain(secret);
    }
    const appleRow = e.db.prepare("SELECT link_encrypted FROM calendars WHERE id = ?").get(apple.id) as { link_encrypted: string };
    // (the replacement with the Outlook link was refused: that feed said "gone")
    expect(decryptSecret(CALENDAR_KEY, appleRow.link_encrypted)).toBe(normalizeCalendarUrl(APPLE_LINK)!.href);
    expect(allStrings(JSON.parse(preview.body))).not.toContain(OUTLOOK_LINK);
  });

  it("is stored encrypted, not as text", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    const raw = JSON.stringify(e.db.prepare("SELECT * FROM calendars").all());
    expect(raw).not.toContain("secret-google-token-91");
    expect(raw).not.toContain("google.com");
    const stored = (e.db.prepare("SELECT link_encrypted FROM calendars").get() as { link_encrypted: string }).link_encrypted;
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptSecret(CALENDAR_KEY, stored)).toBe(normalizeCalendarUrl(GOOGLE_LINK)!.href);
    expect(stored).not.toBe(encryptSecret(CALENDAR_KEY, normalizeCalendarUrl(GOOGLE_LINK)!.href)); // fresh nonce
  });
});

describe("GET /api/calendars/preview", () => {
  const T = (summary: string, start: string, end: string, extra: object = {}) => ({ summary, start, end, ...extra });

  it("answers 503 calendars_unavailable without a key", async () => {
    env = await createCalendarEnv({ calendarKey: null, calendarKeyProblem: "CALENDAR_KEY is not set" });
    const me = await addUserWithSession(env, "Vincent R.");
    const response = await call(env, "GET", "/api/calendars/preview", { token: me.token });
    expect(response.statusCode).toBe(503);
    expect(code(response)).toBe("calendars_unavailable");
  });

  it("is empty without calendars", async () => {
    const e = await setup();
    const preview = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(preview).toEqual({
      state: "ready",
      from: "2026-10-31T23:00:00.000Z",
      to: "2026-11-28T23:00:00.000Z",
      events: [],
      problems: [],
    });
  });

  it("covers 28 days from 00:00 German time today, in winter time", async () => {
    const e = await setup();
    e.feeds.set(
      GOOGLE_LINK,
      ics([
        T("vor Mitternacht", "2026-10-31T20:00:00Z", "2026-10-31T22:30:00Z"), // before the range
        T("laeuft noch", "2026-10-31T22:00:00Z", "2026-11-01T01:00:00Z"), // overlaps the start
        T("letzter Moment", "2026-11-28T22:59:00Z", "2026-11-28T23:30:00Z"), // starts just inside
        T("zu spaet", "2026-11-28T23:00:00Z", "2026-11-29T00:00:00Z"), // starts at the end (exclusive)
        T("viel spaeter", "2026-12-20T10:00:00Z", "2026-12-20T11:00:00Z"),
      ]),
    );
    await add(e, GOOGLE_LINK);
    const preview = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(preview.from).toBe("2026-10-31T23:00:00.000Z");
    expect(preview.to).toBe("2026-11-28T23:00:00.000Z");
    expect(preview.events.map((x) => x.title)).toEqual(["laeuft noch", "letzter Moment"]);
  });

  it("follows the daylight saving change (clock on 2027-03-20, change on 2027-03-28)", async () => {
    const e = await setup();
    e.clock.advance(Date.parse("2027-03-20T10:00:00Z") - e.clock.now().getTime());
    const preview = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(preview.from).toBe("2027-03-19T23:00:00.000Z"); // 00:00 CET
    expect(preview.to).toBe("2027-04-16T22:00:00.000Z"); // 00:00 CEST, 28 days later
  });

  it("combines 'free' events and the calendar setting into countsAsBusy, sorted, with titles", async () => {
    const e = await setup();
    e.feeds.set(
      GOOGLE_LINK,
      ics(
        [
          T("Zahnarzt", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"),
          T("Frei eingetragen", "2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z", { free: true }),
          T("Ganztags", "2026-11-06", "2026-11-07"),
        ],
        "Privat",
      ),
    );
    e.feeds.set(APPLE_LINK, ics([T("Geburtstag Oma", "2026-11-05T09:00:00Z", "2026-11-05T09:30:00Z")], "Geburtstage"));
    const google = await add(e, GOOGLE_LINK);
    const apple = await add(e, APPLE_LINK);
    await call(e, "PATCH", `/api/calendars/${apple.id}`, { token: e.me.token, body: { countsAsBusy: false } });
    const preview = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(preview.problems).toEqual([]);
    expect(preview.events).toEqual([
      { calendarId: google.id, title: "Frei eingetragen", start: "2026-11-04T09:00:00.000Z", end: "2026-11-04T10:00:00.000Z", allDay: false, countsAsBusy: false },
      { calendarId: apple.id, title: "Geburtstag Oma", start: "2026-11-05T09:00:00.000Z", end: "2026-11-05T09:30:00.000Z", allDay: false, countsAsBusy: false },
      { calendarId: google.id, title: "Zahnarzt", start: "2026-11-05T09:00:00.000Z", end: "2026-11-05T10:00:00.000Z", allDay: false, countsAsBusy: true },
      { calendarId: google.id, title: "Ganztags", start: "2026-11-05T23:00:00.000Z", end: "2026-11-06T23:00:00.000Z", allDay: true, countsAsBusy: true },
    ]);
  });

  it("shows only the caller's own calendars", async () => {
    const e = await setup();
    e.feeds.set(GOOGLE_LINK, ics([T("Meins", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")]));
    e.feeds.set(APPLE_LINK, ics([T("Ihres", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")]));
    await add(e, GOOGLE_LINK);
    await add(e, APPLE_LINK, {}, e.other.token);
    const mine = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(mine.events.map((x) => x.title)).toEqual(["Meins"]);
  });

  it("reports calendars that cannot be read as problems: gone → broken, anything else → unreachable", async () => {
    const e = await setup();
    const ok = await add(withFeed(e, GOOGLE_LINK, ics([T("Da", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")])), GOOGLE_LINK);
    const gone = await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    const down = await add(withFeed(e, OUTLOOK_LINK, EMPTY), OUTLOOK_LINK);
    const notIcs = await add(withFeed(e, OTHER_LINK, EMPTY), OTHER_LINK);
    e.clock.advanceMinutes(20); // everything expired
    e.feeds.fail(APPLE_LINK, "gone").fail(OUTLOOK_LINK, "unreachable").set(OTHER_LINK, "<html>login</html>");
    const preview = (await call(e, "GET", "/api/calendars/preview", { token: e.me.token })).json<CalendarPreview>();
    expect(preview.events.map((x) => x.calendarId)).toEqual([ok.id]);
    expect(preview.problems).toEqual([
      { calendarId: gone.id, problem: "broken" },
      { calendarId: down.id, problem: "unreachable" },
      { calendarId: notIcs.id, problem: "unreachable" },
    ]);
  });

  it("reads all calendars in parallel", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    e.clock.advanceMinutes(20);
    let running = 0;
    let peak = 0;
    for (const link of [GOOGLE_LINK, APPLE_LINK]) {
      e.feeds.set(link, async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running--;
        return { ok: true, text: EMPTY };
      });
    }
    await call(e, "GET", "/api/calendars/preview", { token: e.me.token });
    expect(peak).toBe(2);
  });

  it("writes no calendar contents anywhere in the database", async () => {
    const e = await setup();
    e.feeds.set(GOOGLE_LINK, ics([T("Streng-geheimer-Arzttermin", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")], "Feedname-geheim"));
    await add(e, GOOGLE_LINK, { name: "Eigener Name" });
    await call(e, "GET", "/api/calendars/preview", { token: e.me.token });
    e.clock.advanceMinutes(20);
    await call(e, "GET", "/api/calendars/preview", { token: e.me.token });
    const tables = (e.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    const dump = tables.map((name) => JSON.stringify(e.db.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
    expect(dump).not.toContain("Streng-geheimer-Arzttermin");
    expect(dump).not.toContain("Feedname-geheim");
    expect(dump).not.toContain("2026-11-05T09:00");
    expect(dump).toContain("Eigener Name");
  });
});

describe("keeping contents in memory for 15 minutes", () => {
  const feed = ics([{ summary: "Termin", start: "2026-11-05T09:00:00Z", end: "2026-11-05T10:00:00Z" }]);
  const preview = (e: Setup) => call(e, "GET", "/api/calendars/preview", { token: e.me.token });

  it("does not fetch again within 15 minutes, but after 16", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, feed), GOOGLE_LINK); // the check fetched once and filled the cache
    await preview(e);
    e.clock.advanceMinutes(14);
    await preview(e);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(1);
    e.clock.advanceMinutes(2);
    await preview(e);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(2);
    await preview(e);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(2);
  });

  it("fetches a new link fresh, never serving the old link's contents", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, feed), GOOGLE_LINK);
    await preview(e);
    e.feeds.set(APPLE_LINK, ics([{ summary: "Anderer Termin", start: "2026-11-07T09:00:00Z", end: "2026-11-07T10:00:00Z" }]));
    await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { link: APPLE_LINK } });
    expect(e.feeds.callsFor(APPLE_LINK)).toBe(1);
    const after = (await preview(e)).json<CalendarPreview>();
    expect(after.events.map((x) => x.title)).toEqual(["Anderer Termin"]);
  });

  it("lets concurrent previews share one fetch", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, feed), GOOGLE_LINK);
    e.clock.advanceMinutes(20);
    e.feeds.set(GOOGLE_LINK, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { ok: true, text: feed };
    });
    const answers = await Promise.all([preview(e), preview(e), preview(e)]);
    expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 200]);
    expect(answers.every((a) => a.json<CalendarPreview>().events.length === 1)).toBe(true);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(2); // one for adding, one for all three previews
  });

  it("does not remember failures", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, feed), GOOGLE_LINK);
    e.clock.advanceMinutes(20);
    e.feeds.fail(GOOGLE_LINK, "unreachable");
    expect((await preview(e)).json<CalendarPreview>().problems).toHaveLength(1);
    expect((await preview(e)).json<CalendarPreview>().problems).toHaveLength(1);
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(3);
    e.feeds.set(GOOGLE_LINK, feed);
    const healed = (await preview(e)).json<CalendarPreview>();
    expect(healed.problems).toEqual([]);
    expect(healed.events).toHaveLength(1);
  });
});

describe("a link that stops working", () => {
  const preview = (e: Setup) => call(e, "GET", "/api/calendars/preview", { token: e.me.token });

  it("is marked broken at once when the provider says gone, never deleted, and heals when it works again", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, ics([], "Familie")), GOOGLE_LINK);
    e.clock.advanceMinutes(20);
    e.feeds.fail(GOOGLE_LINK, "gone");
    expect((await preview(e)).json<CalendarPreview>().problems).toEqual([{ calendarId: calendar.id, problem: "broken" }]);
    const broken = (await list(e)).calendars;
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ id: calendar.id, status: "broken", name: "Familie" });
    // Still there tomorrow, still tried again.
    e.clock.advanceDays(1);
    await preview(e);
    expect((await list(e)).calendars[0]!.status).toBe("broken");
    expect(e.feeds.callsFor(GOOGLE_LINK)).toBe(3);
    // Works again: healed on its own.
    e.feeds.set(GOOGLE_LINK, ics([], "Familie"));
    expect((await preview(e)).json<CalendarPreview>().problems).toEqual([]);
    expect((await list(e)).calendars[0]!.status).toBe("ok");
  });

  it("does not change the status when the provider just does not answer", async () => {
    const e = await setup();
    await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    e.clock.advanceMinutes(20);
    e.feeds.fail(GOOGLE_LINK, "unreachable");
    await preview(e);
    expect((await list(e)).calendars[0]!.status).toBe("ok");
    e.db.prepare("UPDATE calendars SET status = 'broken'").run();
    await preview(e);
    expect((await list(e)).calendars[0]!.status).toBe("broken"); // only a successful read heals
    e.feeds.set(GOOGLE_LINK, "<html>login</html>");
    await preview(e);
    expect((await list(e)).calendars[0]!.status).toBe("broken");
  });

  it("does not let a replaced link inherit the old link's verdict", async () => {
    const e = await setup();
    const calendar = await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    e.clock.advanceMinutes(20);
    let release!: () => void;
    e.feeds.set(GOOGLE_LINK, () => new Promise((resolve) => (release = () => resolve({ ok: false, reason: "gone" }))));
    const slow = preview(e);
    await new Promise((resolve) => setTimeout(resolve, 10));
    e.feeds.set(APPLE_LINK, EMPTY);
    await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.me.token, body: { link: APPLE_LINK } });
    release();
    await slow;
    expect((await list(e)).calendars[0]!.status).toBe("ok");
  });
});

describe("admin", () => {
  it("sees only a count of broken calendars per person", async () => {
    const e = await setup();
    const admin = await addUserWithSession(e, "Admin A.", { isAdmin: true });
    await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK);
    await add(withFeed(e, OTHER_LINK, EMPTY), OTHER_LINK, {}, e.other.token);
    e.db.prepare("UPDATE calendars SET status = 'broken' WHERE user_id = ?").run(e.me.id);
    const users = (await call(e, "GET", "/api/admin/users", { token: admin.token })).json<AdminUser[]>();
    expect(Object.fromEntries(users.map((u) => [u.username, u.calendarProblems]))).toEqual({
      "Admin A.": 0,
      "Anna K.": 0,
      "Vincent R.": 2,
    });
    const renamed = await call(e, "PATCH", `/api/admin/users/${e.me.id}`, { token: admin.token, body: { username: "Vincent S." } });
    expect(renamed.json<AdminUser>()).toMatchObject({ username: "Vincent S.", calendarProblems: 2 });
    const text = JSON.stringify(users);
    expect(text).not.toContain("Familie");
    expect(Object.keys(users[0]!).sort()).toEqual(["calendarProblems", "createdAt", "id", "isAdmin", "username"]);
  });

  it("removes a person's calendars together with the person", async () => {
    const e = await setup();
    const admin = await addUserWithSession(e, "Admin A.", { isAdmin: true });
    await add(withFeed(e, GOOGLE_LINK, EMPTY), GOOGLE_LINK);
    await add(withFeed(e, APPLE_LINK, EMPTY), APPLE_LINK, {}, e.other.token);
    expect((await call(e, "DELETE", `/api/admin/users/${e.me.id}`, { token: admin.token })).statusCode).toBe(204);
    expect(e.db.prepare("SELECT user_id FROM calendars").all()).toEqual([{ user_id: e.other.id }]);
  });
});
