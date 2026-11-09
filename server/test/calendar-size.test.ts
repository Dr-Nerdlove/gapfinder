import {
  CALENDAR_LARGE_BYTES,
  CALENDARS_LARGE_TOTAL_BYTES,
  type ApiErrorBody,
  type Calendar,
  type CalendarList,
  type CalendarSizes,
  type NotificationItem,
  type NotificationList,
} from "@lueckenfueller/shared";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrations, runMigrations } from "../src/db.js";
import { createCalendarEnv, GOOGLE_LINK, ics, OTHER_LINK, OUTLOOK_LINK, type CalendarEnv } from "./calendar-helpers.js";
import { addUserWithSession, call } from "./helpers.js";

let env: CalendarEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup() {
  env = await createCalendarEnv();
  const admin = await addUserWithSession(env, "Chef", { isAdmin: true });
  const admin2 = await addUserWithSession(env, "Chefin", { isAdmin: true });
  const anna = await addUserWithSession(env, "Anna");
  const tim = await addUserWithSession(env, "Tim");
  return { ...env, admin, admin2, anna, tim };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** A feed of exactly `bytes` bytes (ASCII padding in a description line the parser ignores). */
function feedOfSize(bytes: number): string {
  const base = ics([], "Kalender");
  const padding = "X-PAD:";
  const rest = bytes - Buffer.byteLength(base, "utf8") - padding.length - 2;
  return base.replace("END:VCALENDAR", `${padding}${"a".repeat(rest)}\r\nEND:VCALENDAR`);
}

async function add(e: Setup, token: string, link: string, feed: string): Promise<Calendar> {
  e.feeds.set(link, feed);
  const response = await call(e, "POST", "/api/calendars", { token, body: { link } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Calendar>();
}

/** Forgets the cache and reads the calendar again through the preview. */
async function readAgain(e: Setup, token: string): Promise<void> {
  e.clock.advanceMinutes(16);
  const response = await call(e, "GET", "/api/calendars/preview", { token });
  expect(response.statusCode, response.body).toBe(200);
}

async function large(e: Setup, token: string): Promise<NotificationItem[]> {
  const response = await call(e, "GET", "/api/notifications", { token });
  return response.json<NotificationList>().items.filter((item) => item.data.kind === "calendar_large");
}

async function totals(e: Setup, token: string): Promise<NotificationItem[]> {
  const response = await call(e, "GET", "/api/notifications", { token });
  return response.json<NotificationList>().items.filter((item) => item.data.kind === "calendars_large_total");
}

const sizeOf = async (e: Setup, token: string): Promise<(number | null | undefined)[]> =>
  (await call(e, "GET", "/api/calendars", { token })).json<CalendarList>().calendars.map((c) => c.sizeBytes);

describe("calendar sizes", () => {
  it("stores the size when a calendar is added and returns it; null before it was read", async () => {
    const e = await setup();
    const feed = ics([], "Kalender");
    const added = await add(e, e.anna.token, GOOGLE_LINK, feed);
    expect(added.sizeBytes).toBe(Buffer.byteLength(feed, "utf8"));
    expect(await sizeOf(e, e.anna.token)).toEqual([Buffer.byteLength(feed, "utf8")]);

    e.db.prepare("UPDATE calendars SET size_bytes = NULL").run();
    expect(await sizeOf(e, e.anna.token)).toEqual([null]);
  });

  it("counts bytes, not characters", async () => {
    const e = await setup();
    const feed = ics([], "Größe äöü");
    const added = await add(e, e.anna.token, GOOGLE_LINK, feed);
    expect(added.sizeBytes).toBe(Buffer.byteLength(feed, "utf8"));
    expect(added.sizeBytes).toBeGreaterThan(feed.length);
  });

  it("stores the size when the calendar is read again, and when it gets a new link", async () => {
    const e = await setup();
    const calendar = await add(e, e.anna.token, GOOGLE_LINK, ics([], "Kalender"));
    e.db.prepare("UPDATE calendars SET size_bytes = NULL").run();
    const bigger = feedOfSize(4000);
    e.feeds.set(GOOGLE_LINK, bigger);
    await readAgain(e, e.anna.token);
    expect(await sizeOf(e, e.anna.token)).toEqual([Buffer.byteLength(bigger, "utf8")]);

    const other = ics([{ start: "2026-11-07T10:00:00Z", end: "2026-11-07T11:00:00Z", summary: "Termin" }], "Neu");
    e.feeds.set(OTHER_LINK, other);
    const patched = await call(e, "PATCH", `/api/calendars/${calendar.id}`, { token: e.anna.token, body: { link: OTHER_LINK } });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<Calendar>().sizeBytes).toBe(Buffer.byteLength(other, "utf8"));
  });

  it("does not store contents anywhere", async () => {
    const e = await setup();
    await add(e, e.anna.token, GOOGLE_LINK, ics([{ start: "2026-11-07T10:00:00Z", end: "2026-11-07T11:00:00Z", summary: "Geheimer Arzttermin" }]));
    const dump = JSON.stringify(e.db.prepare("SELECT * FROM calendars").all());
    expect(dump).not.toContain("Arzttermin");
  });
});

describe("large calendar notification", () => {
  it("tells every admin exactly once, not the owner, not other users", async () => {
    const e = await setup();
    await add(e, e.anna.token, GOOGLE_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 1000));
    for (const admin of [e.admin, e.admin2]) {
      const items = await large(e, admin.token);
      expect(items).toHaveLength(1);
      expect(items[0]!.data).toEqual({
        kind: "calendar_large",
        actorName: "Anna",
        sizeBytes: CALENDAR_LARGE_BYTES + 1000,
      });
    }
    await readAgain(e, e.anna.token);
    await readAgain(e, e.anna.token);
    expect(await large(e, e.admin.token)).toHaveLength(1);
    expect(await large(e, e.admin2.token)).toHaveLength(1);
    expect(await large(e, e.anna.token)).toHaveLength(0);
    expect(await large(e, e.tim.token)).toHaveLength(0);
  });

  it("does not notify for exactly 5 MB, and tells an admin about their own calendar", async () => {
    const e = await setup();
    await add(e, e.tim.token, OTHER_LINK, feedOfSize(CALENDAR_LARGE_BYTES));
    expect(await large(e, e.admin.token)).toHaveLength(0);
    await add(e, e.admin.token, GOOGLE_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 1));
    expect(await large(e, e.admin.token)).toHaveLength(1);
    expect(await large(e, e.admin2.token)).toHaveLength(1);
  });

  it("re-arms when the calendar gets smaller, and tells again when it crosses again", async () => {
    const e = await setup();
    await add(e, e.anna.token, GOOGLE_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 10));
    expect(await large(e, e.admin.token)).toHaveLength(1);

    e.feeds.set(GOOGLE_LINK, feedOfSize(1000));
    await readAgain(e, e.anna.token);
    expect(await large(e, e.admin.token)).toHaveLength(1);
    expect(e.db.prepare("SELECT size_warned FROM calendars").get()).toEqual({ size_warned: 0 });

    e.feeds.set(GOOGLE_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 20));
    await readAgain(e, e.anna.token);
    expect(await large(e, e.admin.token)).toHaveLength(2);
  });

  it("ignores a size recorded for a link that was replaced meanwhile", async () => {
    const e = await setup();
    const calendar = await add(e, e.anna.token, GOOGLE_LINK, ics([], "Kalender"));
    const { recordCalendarSize } = await import("../src/calendars/size.js");
    const row = e.db.prepare("SELECT link_encrypted FROM calendars WHERE id = ?").get(calendar.id) as { link_encrypted: string };
    const ctx = { db: e.db, now: e.clock.now, log: { warn: () => {} } } as never;
    recordCalendarSize(ctx, calendar.id, `${row.link_encrypted}-old`, CALENDAR_LARGE_BYTES * 2);
    expect(Number((e.db.prepare("SELECT size_bytes FROM calendars").get() as { size_bytes: number }).size_bytes)).toBeLessThan(10000);
  });
});

describe("total size notification", () => {
  it("tells every admin once when all calendars together pass 300 MB, and re-arms below it", async () => {
    const e = await setup();
    await add(e, e.tim.token, OTHER_LINK, ics([], "Tim"));
    e.db.prepare("UPDATE calendars SET size_bytes = ?").run(CALENDARS_LARGE_TOTAL_BYTES - 5000);
    await add(e, e.anna.token, GOOGLE_LINK, ics([], "Kalender"));
    expect(await totals(e, e.admin.token)).toHaveLength(0);

    // Anna's calendar grows by a little: the total passes 300 MB.
    e.feeds.set(GOOGLE_LINK, feedOfSize(10000));
    await readAgain(e, e.anna.token);
    for (const admin of [e.admin, e.admin2]) {
      const items = await totals(e, admin.token);
      expect(items).toHaveLength(1);
      expect(items[0]!.data.kind).toBe("calendars_large_total");
      expect((items[0]!.data as { totalBytes: number }).totalBytes).toBeGreaterThan(CALENDARS_LARGE_TOTAL_BYTES);
    }
    await readAgain(e, e.anna.token);
    expect(await totals(e, e.admin.token)).toHaveLength(1);
    expect(await totals(e, e.anna.token)).toHaveLength(0);

    // Below the limit again, then above again: told again.
    e.db.prepare("UPDATE calendars SET size_bytes = 5 WHERE user_id = ?").run(e.tim.id);
    await readAgain(e, e.anna.token);
    expect(await totals(e, e.admin.token)).toHaveLength(1);
    e.db.prepare("UPDATE calendars SET size_bytes = ? WHERE user_id = ?").run(CALENDARS_LARGE_TOTAL_BYTES, e.tim.id);
    await readAgain(e, e.anna.token);
    expect(await totals(e, e.admin.token)).toHaveLength(2);
  });
});

describe("GET /api/admin/calendar-sizes", () => {
  it("gives the total and the sorted, unique names of people with a calendar over 5 MB", async () => {
    const e = await setup();
    await add(e, e.tim.token, OTHER_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 5));
    await add(e, e.anna.token, GOOGLE_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 7));
    await add(e, e.anna.token, OUTLOOK_LINK, feedOfSize(CALENDAR_LARGE_BYTES + 9));
    const response = await call(e, "GET", "/api/admin/calendar-sizes", { token: e.admin.token });
    expect(response.statusCode).toBe(200);
    expect(response.json<CalendarSizes>()).toEqual({
      totalBytes: 3 * CALENDAR_LARGE_BYTES + 21,
      largeCalendarOwners: ["Anna", "Tim"],
    });
  });

  it("is empty without any calendar and refuses non-admins", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/admin/calendar-sizes", { token: e.admin.token });
    expect(response.json<CalendarSizes>()).toEqual({ totalBytes: 0, largeCalendarOwners: [] });
    const denied = await call(e, "GET", "/api/admin/calendar-sizes", { token: e.anna.token });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<ApiErrorBody>().code).toBeDefined();
  });
});

describe("migration 12", () => {
  it("keeps existing calendars and adds the size columns", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.slice(0, 11));
    db.prepare("INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')").run();
    db.prepare(
      `INSERT INTO calendars (user_id, name, provider, link_encrypted, created_at, updated_at)
       VALUES (1, 'Privat', 'google', 'enc', 'a', 'a')`,
    ).run();
    runMigrations(db);
    expect(db.prepare("SELECT name, size_bytes, size_warned FROM calendars").all()).toEqual([
      { name: "Privat", size_bytes: null, size_warned: 0 },
    ]);
  });
});
