import { SESSION_VALID_DAYS, type ApiErrorBody, type SessionResponse } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addUser, addUserWithSession, call, createTestEnv, DEFAULT_PASSWORD, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup(): Promise<TestEnv> {
  env = await createTestEnv();
  return env;
}

describe("POST /api/auth/login", () => {
  it("logs in and returns a token plus the user", async () => {
    const e = await setup();
    await addUser(e, "Vincent R.");
    const response = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<SessionResponse>();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user).toEqual({ id: expect.any(Number), username: "Vincent R.", isAdmin: false, seedColor: null });

    const me = await call(e, "GET", "/api/me", { token: body.token });
    expect(me.statusCode).toBe(200);
  });

  it("compares the username without case and extra spaces", async () => {
    const e = await setup();
    await addUser(e, "Vincent R.");
    const response = await call(e, "POST", "/api/auth/login", {
      body: { username: "  vincent   r. ", password: DEFAULT_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<SessionResponse>().user.username).toBe("Vincent R.");
  });

  it("gives the same answer for a wrong password and an unknown user", async () => {
    const e = await setup();
    await addUser(e, "Vincent R.");
    const wrong = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: "nope nope nope" },
    });
    const unknown = await call(e, "POST", "/api/auth/login", {
      body: { username: "Nobody", password: "nope nope nope" },
    });
    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json<ApiErrorBody>().code).toBe("invalid_credentials");
    }
    expect(wrong.body).toBe(unknown.body);
  });

  it("answers 400 validation when fields are missing", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/auth/login", { body: { username: "x" } });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "password" });
  });

  it("blocks after 5 failures for one username, even with the right password, and says how long", async () => {
    const e = await setup();
    await addUser(e, "Vincent R.");
    for (let i = 0; i < 5; i++) {
      const response = await call(e, "POST", "/api/auth/login", {
        body: { username: "Vincent R.", password: "wrong wrong" },
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await call(e, "POST", "/api/auth/login", {
      body: { username: "vincent r.", password: DEFAULT_PASSWORD },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>()).toMatchObject({ code: "rate_limited", retryAfterSeconds: 15 * 60 });
    expect(blocked.headers["retry-after"]).toBe("900");

    e.clock.advanceMinutes(10);
    const stillBlocked = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(stillBlocked.statusCode).toBe(429);
    expect(stillBlocked.json<ApiErrorBody>().retryAfterSeconds).toBe(5 * 60);

    e.clock.advanceMinutes(5);
    const allowed = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("does not count successful logins and resets the counter on success", async () => {
    const e = await setup();
    await addUser(e, "Vincent R.");
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) {
        await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: "wrong wrong" } });
      }
      const ok = await call(e, "POST", "/api/auth/login", {
        body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
      });
      expect(ok.statusCode).toBe(200);
    }
  });

  it("limits unknown usernames too, so the limit does not reveal which names exist", async () => {
    const e = await setup();
    for (let i = 0; i < 5; i++) {
      await call(e, "POST", "/api/auth/login", { body: { username: "Ghost", password: "wrong wrong" } });
    }
    const blocked = await call(e, "POST", "/api/auth/login", { body: { username: "Ghost", password: "wrong wrong" } });
    expect(blocked.statusCode).toBe(429);
  });

  it("blocks an address after 20 failures across usernames, and other addresses stay free", async () => {
    const e = await setup();
    await addUser(e, "Vincent R.");
    for (let i = 0; i < 20; i++) {
      await call(e, "POST", "/api/auth/login", {
        ip: "10.0.0.1",
        body: { username: `Ghost ${i}`, password: "wrong wrong" },
      });
    }
    const blocked = await call(e, "POST", "/api/auth/login", {
      ip: "10.0.0.1",
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(blocked.statusCode).toBe(429);
    const other = await call(e, "POST", "/api/auth/login", {
      ip: "10.0.0.2",
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(other.statusCode).toBe(200);

    e.clock.advanceMinutes(16);
    const later = await call(e, "POST", "/api/auth/login", {
      ip: "10.0.0.1",
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(later.statusCode).toBe(200);
  });

  it("deletes expired sessions on login", async () => {
    const e = await setup();
    const user = await addUserWithSession(e, "Vincent R.");
    e.clock.advanceDays(SESSION_VALID_DAYS + 1);
    await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: user.password } });
    const count = e.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends only the current session", async () => {
    const e = await setup();
    const first = await addUserWithSession(e, "Vincent R.");
    const second = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: first.password },
    });
    const secondToken = second.json<SessionResponse>().token;

    const out = await call(e, "POST", "/api/auth/logout", { token: first.token });
    expect(out.statusCode).toBe(204);
    expect((await call(e, "GET", "/api/me", { token: first.token })).statusCode).toBe(401);
    expect((await call(e, "GET", "/api/me", { token: secondToken })).statusCode).toBe(200);
  });

  it("needs a login", async () => {
    const e = await setup();
    expect((await call(e, "POST", "/api/auth/logout")).statusCode).toBe(401);
  });
});

describe("sessions", () => {
  it.each([
    ["no header", undefined],
    ["unknown token", "Bearer nope"],
    ["wrong scheme", "Basic abc"],
    ["empty token", "Bearer "],
  ])("rejects a request with %s", async (_label, header) => {
    const e = await setup();
    const response = await e.app.inject({
      method: "GET",
      url: "/api/me",
      ...(header !== undefined ? { headers: { authorization: header } } : {}),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiErrorBody>().code).toBe("unauthorized");
  });

  it("lasts 180 days after the last use, not after the login", async () => {
    const e = await setup();
    const user = await addUserWithSession(e, "Vincent R.");
    for (let round = 0; round < 3; round++) {
      e.clock.advanceDays(SESSION_VALID_DAYS - 1);
      expect((await call(e, "GET", "/api/me", { token: user.token })).statusCode).toBe(200);
    }
    // 537 days after the login, but only 179 days after the last use.
    e.clock.advanceDays(SESSION_VALID_DAYS);
    expect((await call(e, "GET", "/api/me", { token: user.token })).statusCode).toBe(401);
  });

  it("is rejected and deleted once it has expired", async () => {
    const e = await setup();
    const user = await addUserWithSession(e, "Vincent R.");
    e.clock.advanceDays(SESSION_VALID_DAYS);
    const response = await call(e, "GET", "/api/me", { token: user.token });
    expect(response.statusCode).toBe(401);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(0);
  });

  it("is prolonged only when last used more than an hour ago", async () => {
    const e = await setup();
    const user = await addUserWithSession(e, "Vincent R.");
    const row = () =>
      e.db.prepare("SELECT last_used_at, expires_at FROM sessions").get() as {
        last_used_at: string;
        expires_at: string;
      };
    const created = row();

    e.clock.advanceMinutes(30);
    await call(e, "GET", "/api/me", { token: user.token });
    expect(row()).toEqual(created);

    e.clock.advanceMinutes(40);
    await call(e, "GET", "/api/me", { token: user.token });
    const refreshed = row();
    expect(refreshed.last_used_at).toBe(e.clock.now().toISOString());
    expect(Date.parse(refreshed.expires_at) - Date.parse(created.expires_at)).toBe(70 * 60 * 1000);
  });
});
