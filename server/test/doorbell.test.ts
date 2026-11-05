import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import type { AppDeviceRegistered, AppPushTokenSaved, DoorbellStatus } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrations, runMigrations } from "../src/db.js";
import { loadConfig, parseFcmAccount } from "../src/config.js";
import { createFcmRinger, fcmErrorCode, isGoneAnswer, type RingDevice, type RingResult } from "../src/notifications/ring.js";
import { addUserWithSession, call, createTestEnv, DEFAULT_PASSWORD, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await env?.app.close();
  env = undefined;
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
const SLOT = { start: "2026-11-07T17:00:00.000Z", end: "2026-11-07T19:00:00.000Z" };
const TOKEN_A = "token-a:APA91bF_xyz-123";
const TOKEN_B = "token-b:APA91bF_xyz-456";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
function accountFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    project_id: "lueckenfueller-test",
    private_key_id: "abc",
    private_key: PEM,
    client_email: "firebase-adminsdk@lueckenfueller-test.iam.gserviceaccount.com",
    ...overrides,
  });
}
const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("FCM_SERVICE_ACCOUNT", () => {
  it("is off without a value, and loadConfig does not fail", () => {
    const config = loadConfig({});
    expect(config.fcm).toBeNull();
    expect(config.fcmProblem).toBe("FCM_SERVICE_ACCOUNT is not set");
  });

  it.each([
    ["not base64", "this is not base64!"],
    ["no JSON", b64("hello")],
    ["a JSON array", b64("[]")],
    ["the wrong type", b64(accountFile({ type: "authorized_user" }))],
    ["a bad project id", b64(accountFile({ project_id: "Bad_Project" }))],
    ["no client email", b64(accountFile({ client_email: 5 }))],
    ["no private key", b64(accountFile({ private_key: "nope" }))],
  ])("is invalid for %s, and the problem never contains the value", (_name, value) => {
    const config = loadConfig({ FCM_SERVICE_ACCOUNT: value });
    expect(config.fcm).toBeNull();
    expect(config.fcmProblem).toMatch(/^FCM_SERVICE_ACCOUNT is not valid: /);
    expect(config.fcmProblem).not.toContain(value);
    expect(config.fcmProblem).not.toContain("BEGIN PRIVATE KEY");
  });

  it("reads a valid service account", () => {
    const config = loadConfig({ FCM_SERVICE_ACCOUNT: b64(accountFile()) });
    expect(config.fcmProblem).toBeNull();
    expect(config.fcm).toEqual({
      projectId: "lueckenfueller-test",
      clientEmail: "firebase-adminsdk@lueckenfueller-test.iam.gserviceaccount.com",
      privateKey: PEM,
    });
    expect(parseFcmAccount(` ${b64(accountFile())} `).account).not.toBeNull();
  });
});

describe("migration 9", () => {
  it("adds a unique fcm_token to a database at migration 8 and keeps its rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db, migrations.slice(0, 8));
    db.prepare("INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('Anna', 'anna', 'h', 'a')").run();
    const insert = db.prepare("INSERT INTO app_devices (user_id, key_hash, created_at, last_used_at) VALUES (1, ?, 'a', 'a')");
    insert.run("k1");
    runMigrations(db);
    expect(db.prepare("SELECT key_hash, fcm_token FROM app_devices").all()).toEqual([{ key_hash: "k1", fcm_token: null }]);
    // Several phones without a token are fine; the same token twice is not.
    insert.run("k2");
    db.prepare("UPDATE app_devices SET fcm_token = 't' WHERE key_hash = 'k1'").run();
    expect(() => db.prepare("UPDATE app_devices SET fcm_token = 't' WHERE key_hash = 'k2'").run()).toThrow(/UNIQUE/);
  });
});

async function setup(ringDevice: RingDevice | null = async () => ({ ok: true }), logStream?: PassThrough) {
  env = await createTestEnv(logStream ? { logLevel: "warn" } : {}, { ringDevice, ...(logStream ? { logStream } : {}) });
  const owner = await addUserWithSession(env, "Olga O.");
  const anna = await addUserWithSession(env, "Anna K.");
  const ben = await addUserWithSession(env, "ben m.");
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  return { ...env, owner, anna, ben, admin };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function register(e: Setup, token: string): Promise<string> {
  const response = await call(e, "POST", "/api/app-devices", { token });
  return response.json<AppDeviceRegistered>().deviceKey;
}
const putToken = (e: Setup, key: string | undefined, body: unknown) =>
  call(e, "PUT", "/api/app-devices/push-token", { ...(key ? { headers: { "x-device-key": key } } : {}), body });
const tokensOf = (e: Setup, userId: number) =>
  (e.db.prepare("SELECT fcm_token FROM app_devices WHERE user_id = ? ORDER BY id").all(userId) as { fcm_token: string | null }[]).map(
    (row) => row.fcm_token,
  );
async function notifyAnna(e: Setup) {
  const response = await call(e, "POST", "/api/polls", {
    token: e.owner.token,
    body: { title: "Spieleabend", kind: "timed", proposals: [SLOT], participants: [e.anna.id] },
  });
  expect(response.statusCode, response.body).toBe(201);
}

describe("PUT /api/app-devices/push-token", () => {
  it("answers 401 without a key, with a wrong key and with a session token", async () => {
    const e = await setup();
    for (const key of [undefined, "wrong", e.anna.token]) {
      const response = await putToken(e, key, { token: TOKEN_A });
      expect(response.statusCode).toBe(401);
      expect(response.json<{ code: string }>().code).toBe("unauthorized");
    }
  });

  it.each([{}, { token: "" }, { token: 5 }, { token: "has space" }, { token: "umlaut-ä" }, { token: "x".repeat(4097) }])(
    "rejects the body %j",
    async (body) => {
      const e = await setup();
      const key = await register(e, e.anna.token);
      expect((await putToken(e, key, body)).statusCode).toBe(400);
      expect(tokensOf(e, e.anna.id)).toEqual([null]);
    },
  );

  it("stores the token and says whether the server can ring", async () => {
    const e = await setup();
    const key = await register(e, e.anna.token);
    const response = await putToken(e, key, { token: TOKEN_A });
    expect(response.statusCode).toBe(200);
    expect(response.json<AppPushTokenSaved>()).toEqual({ instant: true });
    expect(tokensOf(e, e.anna.id)).toEqual([TOKEN_A]);
    // Sending it again (a refresh) replaces it.
    await putToken(e, key, { token: TOKEN_B });
    expect(tokensOf(e, e.anna.id)).toEqual([TOKEN_B]);
  });

  it("says instant false when the server has no Firebase key, but still stores the token", async () => {
    const e = await setup(null);
    const key = await register(e, e.anna.token);
    const response = await putToken(e, key, { token: TOKEN_A });
    expect(response.json<AppPushTokenSaved>()).toEqual({ instant: false });
    expect(tokensOf(e, e.anna.id)).toEqual([TOKEN_A]);
  });

  it("moves a token to the newest device that reports it", async () => {
    const e = await setup();
    const annaKey = await register(e, e.anna.token);
    const benKey = await register(e, e.ben.token);
    await putToken(e, annaKey, { token: TOKEN_A });
    await putToken(e, benKey, { token: TOKEN_A });
    expect(tokensOf(e, e.anna.id)).toEqual([null]);
    expect(tokensOf(e, e.ben.id)).toEqual([TOKEN_A]);
  });

  it("is gone with the device, the user and ended sessions", async () => {
    const e = await setup();
    const removed = await register(e, e.anna.token);
    await putToken(e, removed, { token: TOKEN_A });
    await call(e, "DELETE", "/api/app-devices", { token: e.anna.token, body: { deviceKey: removed } });
    expect(tokensOf(e, e.anna.id)).toEqual([]);

    const key = await register(e, e.anna.token);
    await putToken(e, key, { token: TOKEN_A });
    await call(e, "POST", "/api/me/password", {
      token: e.anna.token,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword: "a brand new password" },
    });
    expect(tokensOf(e, e.anna.id)).toEqual([]);

    const benKey = await register(e, e.ben.token);
    await putToken(e, benKey, { token: TOKEN_B });
    e.db.prepare("DELETE FROM users WHERE id = ?").run(e.ben.id);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM app_devices WHERE fcm_token IS NOT NULL").get()).toEqual({ n: 0 });
  });
});

describe("the ring after a notification", () => {
  it("rings every app device of the notified user once, and nobody else", async () => {
    const rung: string[] = [];
    const e = await setup(async (token) => {
      rung.push(token);
      return { ok: true };
    });
    const phone1 = await register(e, e.anna.token);
    const phone2 = await register(e, e.anna.token);
    await register(e, e.anna.token); // no token yet
    const benPhone = await register(e, e.ben.token);
    await putToken(e, phone1, { token: TOKEN_A });
    await putToken(e, phone2, { token: TOKEN_B });
    await putToken(e, benPhone, { token: "ben-token" });
    await notifyAnna(e);
    await flush();
    expect(rung.sort()).toEqual([TOKEN_A, TOKEN_B]);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM app_devices WHERE fcm_token IS NOT NULL").get()).toEqual({ n: 3 });
  });

  it("does not ring a device unused for more than 90 days", async () => {
    const rung: string[] = [];
    const e = await setup(async (token) => {
      rung.push(token);
      return { ok: true };
    });
    const phone = await register(e, e.anna.token);
    await putToken(e, phone, { token: TOKEN_A });
    e.db.prepare("UPDATE app_devices SET last_used_at = ?").run(new Date(e.clock.now().getTime() - 91 * 86_400_000).toISOString());
    await notifyAnna(e);
    await flush();
    expect(rung).toEqual([]);
  });

  it("does not ring when the user switched the notification off", async () => {
    const rung: string[] = [];
    const e = await setup(async (token) => {
      rung.push(token);
      return { ok: true };
    });
    const phone = await register(e, e.anna.token);
    await putToken(e, phone, { token: TOKEN_A });
    const all = { pollCreated: false, voteOwn: true, voteOthers: false, allVotedOwn: true, allVotedOthers: false, dateFixed: true, reminder: true };
    await call(e, "PUT", "/api/me/notification-settings", { token: e.anna.token, body: all });
    await notifyAnna(e);
    await flush();
    expect(rung).toEqual([]);
  });

  it("forgets a token that Firebase reports as gone (and only that one)", async () => {
    const e = await setup(async (token): Promise<RingResult> => (token === TOKEN_A ? { ok: false, gone: true, status: 404 } : { ok: true }));
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_A });
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_B });
    await notifyAnna(e);
    await flush();
    expect(tokensOf(e, e.anna.id)).toEqual([null, TOKEN_B]);
  });

  it("keeps the token on a failure that is not final, logs without the token, and does not fail the request", async () => {
    const log = new PassThrough();
    let text = "";
    log.on("data", (chunk: Buffer) => (text += chunk.toString()));
    const e = await setup(async () => ({ ok: false, gone: false, status: 503 }), log);
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_A });
    await notifyAnna(e);
    await flush();
    expect(tokensOf(e, e.anna.id)).toEqual([TOKEN_A]);
    expect(text).toContain("Ring was not delivered");
    expect(text).toContain("503");
    expect(text).not.toContain(TOKEN_A);
  });

  it("does not fail the request when the ringer throws", async () => {
    const e = await setup(async () => {
      throw new Error("boom");
    });
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_A });
    await notifyAnna(e);
    await flush();
    expect(tokensOf(e, e.anna.id)).toEqual([TOKEN_A]);
  });

  it("does nothing without a ringer", async () => {
    const e = await setup(null);
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_A });
    await notifyAnna(e);
    await flush();
    expect(tokensOf(e, e.anna.id)).toEqual([TOKEN_A]);
  });
});

describe("createFcmRinger", () => {
  const account = { projectId: "my-project", clientEmail: "a@b.c", privateKey: PEM };

  function stubFetch(answer: () => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer();
    });
    return calls;
  }

  it("sends one content-free data message with high priority", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const result = await createFcmRinger(account, async () => "access-123")(TOKEN_A);
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://fcm.googleapis.com/v1/projects/my-project/messages:send");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer access-123");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      message: {
        token: TOKEN_A,
        data: { kind: "check" },
        android: { priority: "high", ttl: "86400s", collapse_key: "check" },
      },
    });
  });

  const notFound = (code?: string) =>
    new Response(
      JSON.stringify({
        error: {
          code: 404,
          status: "NOT_FOUND",
          details: code ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: code }] : [],
        },
      }),
      { status: 404 },
    );

  it.each([
    ["UNREGISTERED", 404, true],
    ["SENDER_ID_MISMATCH", 403, true],
    ["INVALID_ARGUMENT", 400, false],
    ["QUOTA_EXCEEDED", 429, false],
  ])("treats %s (HTTP %i) as gone=%s", async (code, status, gone) => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: code }] } }),
          { status },
        ),
    );
    expect(await createFcmRinger(account, async () => "t")(TOKEN_A)).toEqual({ ok: false, gone, status });
  });

  it("treats a 404 without an error code as gone, but a 404 with another code not", async () => {
    stubFetch(() => notFound());
    expect(await createFcmRinger(account, async () => "t")(TOKEN_A)).toEqual({ ok: false, gone: true, status: 404 });
    stubFetch(() => notFound("INVALID_ARGUMENT"));
    expect(await createFcmRinger(account, async () => "t")(TOKEN_A)).toEqual({ ok: false, gone: false, status: 404 });
  });

  it("does not mark a 500 with a non-JSON answer as gone", async () => {
    stubFetch(() => new Response("<html>", { status: 500 }));
    expect(await createFcmRinger(account, async () => "t")(TOKEN_A)).toEqual({ ok: false, gone: false, status: 500 });
  });

  it("reports auth and network problems without throwing or leaking secrets", async () => {
    const calls = stubFetch(() => new Response("{}"));
    const noToken = await createFcmRinger(account, async () => {
      throw new Error("invalid_grant SECRET-ACCESS");
    })(TOKEN_A);
    expect(noToken).toEqual({ ok: false, gone: false, reason: "auth" });
    expect(await createFcmRinger(account, async () => null)(TOKEN_A)).toEqual({ ok: false, gone: false, reason: "auth" });
    expect(calls).toHaveLength(0);

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed " + TOKEN_A);
    });
    const down = await createFcmRinger(account, async () => "access-123")(TOKEN_A);
    expect(down).toEqual({ ok: false, gone: false, reason: "network" });
    expect(JSON.stringify(down)).not.toContain(TOKEN_A);
  });

  it("reads the error code only from the FcmError detail", () => {
    expect(fcmErrorCode(null)).toBeNull();
    expect(fcmErrorCode({ error: { details: "x" } })).toBeNull();
    expect(fcmErrorCode({ error: { details: [{ "@type": "other.Type", errorCode: "UNREGISTERED" }] } })).toBeNull();
    expect(isGoneAnswer(404, { error: { details: [{ "@type": "other.Type", errorCode: "UNREGISTERED" }] } })).toBe(true);
    expect(
      fcmErrorCode({
        error: { details: [{ "@type": "x.BadRequest" }, { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] },
      }),
    ).toBe("UNREGISTERED");
  });
});

describe("GET /api/admin/doorbell-status", () => {
  const get = (e: Setup, token: string) => call(e, "GET", "/api/admin/doorbell-status", { token });

  it("is for admins only", async () => {
    const e = await setup();
    expect((await call(e, "GET", "/api/admin/doorbell-status")).statusCode).toBe(401);
    expect((await get(e, e.anna.token)).statusCode).toBe(403);
  });

  it("reports ready with the phones that can be rung and the last ring", async () => {
    const e = await setup();
    expect((await get(e, e.admin.token)).json<DoorbellStatus>()).toEqual({ state: "ready", devicesWithToken: 0, lastRing: null });
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_A });
    await register(e, e.ben.token); // without token
    await notifyAnna(e);
    await flush();
    expect((await get(e, e.admin.token)).json<DoorbellStatus>()).toEqual({
      state: "ready",
      devicesWithToken: 1,
      lastRing: { at: e.clock.now().toISOString(), ok: true },
    });
  });

  it("reports a failed last ring", async () => {
    const e = await setup(async () => ({ ok: false, gone: false, status: 500 }));
    await putToken(e, await register(e, e.anna.token), { token: TOKEN_A });
    await notifyAnna(e);
    await flush();
    expect((await get(e, e.admin.token)).json<DoorbellStatus>().lastRing).toEqual({ at: e.clock.now().toISOString(), ok: false });
  });

  it("tells not configured from invalid", async () => {
    // The test config has no key and the problem "not set".
    const e = await setup(null);
    expect((await get(e, e.admin.token)).json<DoorbellStatus>().state).toBe("not_configured");
    await e.app.close();
    env = await createTestEnv({ fcmProblem: "FCM_SERVICE_ACCOUNT is not valid: x" }, { ringDevice: null });
    const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
    const response = await call(env, "GET", "/api/admin/doorbell-status", { token: admin.token });
    expect(response.json<DoorbellStatus>().state).toBe("invalid");
  });
});
