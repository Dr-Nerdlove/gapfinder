import type { AppDeviceRegistered, NotificationList } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addUserWithSession, call, createTestEnv, DEFAULT_PASSWORD, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

const SLOT = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };

async function setup() {
  env = await createTestEnv();
  const owner = await addUserWithSession(env, "Olga O.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  return { ...env, owner, anna, ben };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** Owner creates a poll with Anna: Anna gets one notification. */
async function notifyAnna(e: Setup): Promise<void> {
  const response = await call(e, "POST", "/api/polls", {
    token: e.owner.token,
    body: { title: "Spieleabend", kind: "timed", proposals: [SLOT], participants: [e.anna.id] },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function register(e: Setup, token: string): Promise<AppDeviceRegistered> {
  const response = await call(e, "POST", "/api/app-devices", { token });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<AppDeviceRegistered>();
}

const poll = (e: Setup, key: string | undefined, query = "") =>
  call(e, "GET", `/api/app-notifications${query}`, { ...(key ? { headers: { "x-device-key": key } } : {}) });
const deviceCount = (e: Setup, userId: number) =>
  Number((e.db.prepare("SELECT COUNT(*) AS n FROM app_devices WHERE user_id = ?").get(userId) as { n: number }).n);

describe("POST /api/app-devices", () => {
  it("needs a login", async () => {
    const e = await setup();
    expect((await call(e, "POST", "/api/app-devices")).statusCode).toBe(401);
  });

  it("returns a key and the newest notification id (0 without notifications)", async () => {
    const e = await setup();
    const first = await register(e, e.anna.token);
    expect(first.deviceKey.length).toBeGreaterThan(20);
    expect(first.lastNotificationId).toBe(0);

    await notifyAnna(e);
    const listed = (await call(e, "GET", "/api/notifications", { token: e.anna.token })).json<NotificationList>();
    const second = await register(e, e.anna.token);
    expect(second.lastNotificationId).toBe(listed.items[0]!.id);
    expect(second.deviceKey).not.toBe(first.deviceKey);
    // Nobody else's notifications count.
    expect((await register(e, e.ben.token)).lastNotificationId).toBe(0);
  });

  it("stores only a hash of the key", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    const rows = e.db.prepare("SELECT key_hash FROM app_devices").all() as { key_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key_hash).not.toBe(deviceKey);
  });

  it("keeps at most 10 devices per user and pushes out the one used longest ago", async () => {
    const e = await setup();
    const keys: string[] = [];
    for (let i = 0; i < 10; i++) {
      keys.push((await register(e, e.anna.token)).deviceKey);
      e.clock.advanceMinutes(1);
    }
    // The first phone is used again, so the second one is now the oldest.
    expect((await poll(e, keys[0])).statusCode).toBe(200);
    e.clock.advanceMinutes(1);
    const eleventh = await register(e, e.anna.token);
    expect(deviceCount(e, e.anna.id)).toBe(10);
    expect((await poll(e, keys[1])).statusCode).toBe(401);
    expect((await poll(e, keys[0])).statusCode).toBe(200);
    expect((await poll(e, eleventh.deviceKey)).statusCode).toBe(200);
  });

  it("deletes the devices of anyone unused for more than 90 days when a new one is added", async () => {
    const e = await setup();
    const old = await register(e, e.ben.token);
    e.clock.advanceDays(91);
    await register(e, e.anna.token);
    expect(deviceCount(e, e.ben.id)).toBe(0);
    expect((await poll(e, old.deviceKey)).statusCode).toBe(401);
  });
});

describe("GET /api/app-notifications", () => {
  it("lists the notifications of the key's user and respects `after`", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    await notifyAnna(e);
    await notifyAnna(e);
    const all = (await poll(e, deviceKey)).json<NotificationList>();
    expect(all.items).toHaveLength(2);
    const viaSession = (await call(e, "GET", "/api/notifications", { token: e.anna.token })).json<NotificationList>();
    expect(all).toEqual(viaSession);
    const rest = (await poll(e, deviceKey, `?after=${all.items[0]!.id}`)).json<NotificationList>();
    expect(rest.items.map((i) => i.id)).toEqual([all.items[1]!.id]);
    expect((await poll(e, deviceKey, "?after=abc")).statusCode).toBe(400);
  });

  it("does not show other people's notifications or notifications older than 7 days", async () => {
    const e = await setup();
    const annaKey = (await register(e, e.anna.token)).deviceKey;
    const benKey = (await register(e, e.ben.token)).deviceKey;
    await notifyAnna(e);
    expect((await poll(e, benKey)).json<NotificationList>().items).toHaveLength(0);
    e.clock.advanceDays(8);
    expect((await poll(e, annaKey)).json<NotificationList>().items).toHaveLength(0);
  });

  it("answers 401 without a key, with a wrong key and with a session token", async () => {
    const e = await setup();
    await register(e, e.anna.token);
    for (const response of [await poll(e, undefined), await poll(e, "wrong"), await poll(e, e.anna.token)]) {
      expect(response.statusCode).toBe(401);
      expect(response.json<{ code: string }>().code).toBe("unauthorized");
    }
  });

  it("does not work with a key unused for more than 90 days, and deletes it", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    e.clock.advanceDays(89);
    expect((await poll(e, deviceKey)).statusCode).toBe(200);
    e.clock.advanceDays(89);
    expect((await poll(e, deviceKey)).statusCode).toBe(200); // use prolongs the key
    e.clock.advanceDays(91);
    expect((await poll(e, deviceKey)).statusCode).toBe(401);
    expect(deviceCount(e, e.anna.id)).toBe(0);
  });

  it("is the only thing a device key opens", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    for (const [method, url] of [
      ["GET", "/api/me"],
      ["GET", "/api/notifications"],
      ["POST", "/api/app-devices"],
      ["GET", "/api/me/notification-settings"],
    ] as const) {
      expect((await call(e, method, url, { token: deviceKey })).statusCode, url).toBe(401);
    }
  });
});

describe("DELETE /api/app-devices", () => {
  it("removes the user's own device", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    const response = await call(e, "DELETE", "/api/app-devices", { token: e.anna.token, body: { deviceKey } });
    expect(response.statusCode).toBe(204);
    expect((await poll(e, deviceKey)).statusCode).toBe(401);
  });

  it("never removes another user's device, and unknown keys are fine", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    const other = await call(e, "DELETE", "/api/app-devices", { token: e.ben.token, body: { deviceKey } });
    expect(other.statusCode).toBe(204);
    expect((await poll(e, deviceKey)).statusCode).toBe(200);
    const unknown = await call(e, "DELETE", "/api/app-devices", { token: e.ben.token, body: { deviceKey: "nope" } });
    expect(unknown.statusCode).toBe(204);
  });

  it("needs a login and a valid body", async () => {
    const e = await setup();
    expect((await call(e, "DELETE", "/api/app-devices", { body: { deviceKey: "x" } })).statusCode).toBe(401);
    expect((await call(e, "DELETE", "/api/app-devices", { token: e.anna.token, body: {} })).statusCode).toBe(400);
    const tooLong = { deviceKey: "x".repeat(201) };
    expect((await call(e, "DELETE", "/api/app-devices", { token: e.anna.token, body: tooLong })).statusCode).toBe(400);
  });
});

describe("ending sessions and accounts", () => {
  it("removes the user's devices (only theirs) with a password change", async () => {
    const e = await setup();
    const annaKey = (await register(e, e.anna.token)).deviceKey;
    const benKey = (await register(e, e.ben.token)).deviceKey;
    const response = await call(e, "POST", "/api/me/password", {
      token: e.anna.token,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword: "a brand new password" },
    });
    expect(response.statusCode).toBe(204);
    expect((await poll(e, annaKey)).statusCode).toBe(401);
    expect((await poll(e, benKey)).statusCode).toBe(200);
  });

  it("removes the devices when the account is deleted", async () => {
    const e = await setup();
    const { deviceKey } = await register(e, e.anna.token);
    e.db.prepare("DELETE FROM users WHERE id = ?").run(e.anna.id);
    expect(deviceCount(e, e.anna.id)).toBe(0);
    expect((await poll(e, deviceKey)).statusCode).toBe(401);
  });
});
