import type { ApiErrorBody, Me, SessionResponse } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addUserWithSession, call, createTestEnv, DEFAULT_PASSWORD, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup(): Promise<TestEnv & { token: string; id: number }> {
  env = await createTestEnv();
  const user = await addUserWithSession(env, "Vincent R.");
  return { ...env, token: user.token, id: user.id };
}

describe("GET /api/me", () => {
  it("returns the logged-in user without secrets", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/me", { token: e.token });
    expect(response.statusCode).toBe(200);
    expect(response.json<Me>()).toEqual({ id: e.id, username: "Vincent R.", isAdmin: false, seedColor: null });
  });

  it("needs a login", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/me");
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiErrorBody>().code).toBe("unauthorized");
  });
});

describe("PATCH /api/me", () => {
  it.each(["Vince R.", "vincent r.", "Vincent R.", "", "<b>"])(
    "refuses to change the username (%j) and changes nothing",
    async (username) => {
      const e = await setup();
      const response = await call(e, "PATCH", "/api/me", { token: e.token, body: { username } });
      expect(response.statusCode).toBe(403);
      expect(response.json<ApiErrorBody>().code).toBe("forbidden");
      expect((await call(e, "GET", "/api/me", { token: e.token })).json<Me>().username).toBe("Vincent R.");
    },
  );

  it("refuses a username even together with a valid seed colour, and does not apply the colour", async () => {
    const e = await setup();
    const response = await call(e, "PATCH", "/api/me", {
      token: e.token,
      body: { username: "Vince R.", seedColor: "#aabbcc" },
    });
    expect(response.statusCode).toBe(403);
    expect((await call(e, "GET", "/api/me", { token: e.token })).json<Me>().seedColor).toBeNull();
  });

  it("sets, normalizes and resets the seed colour", async () => {
    const e = await setup();
    const set = await call(e, "PATCH", "/api/me", { token: e.token, body: { seedColor: "#AABBCC" } });
    expect(set.json<Me>().seedColor).toBe("#aabbcc");
    // Fields left out stay as they are.
    const same = await call(e, "PATCH", "/api/me", { token: e.token, body: {} });
    expect(same.json<Me>()).toMatchObject({ seedColor: "#aabbcc", username: "Vincent R." });
    const reset = await call(e, "PATCH", "/api/me", { token: e.token, body: { seedColor: null } });
    expect(reset.json<Me>().seedColor).toBeNull();
  });

  it.each(["red", "#abc", "", "#12345g"])("refuses the seed colour %j", async (seedColor) => {
    const e = await setup();
    const response = await call(e, "PATCH", "/api/me", { token: e.token, body: { seedColor } });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "seedColor" });
  });

  it("refuses a number where text is expected", async () => {
    const e = await setup();
    const response = await call(e, "PATCH", "/api/me", { token: e.token, body: { username: 12345 } });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });
  });

  it("needs a login", async () => {
    const e = await setup();
    expect((await call(e, "PATCH", "/api/me", { body: { username: "Someone" } })).statusCode).toBe(401);
  });
});

describe("POST /api/me/password", () => {
  const newPassword = "a brand new password";

  it("changes the password, ends the other sessions and keeps the current one", async () => {
    const e = await setup();
    const other = (
      await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: DEFAULT_PASSWORD } })
    ).json<SessionResponse>().token;

    const response = await call(e, "POST", "/api/me/password", {
      token: e.token,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword },
    });
    expect(response.statusCode).toBe(204);

    expect((await call(e, "GET", "/api/me", { token: e.token })).statusCode).toBe(200);
    expect((await call(e, "GET", "/api/me", { token: other })).statusCode).toBe(401);
    const oldLogin = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/me/password", {
      token: e.token,
      body: { currentPassword: "not the password", newPassword },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().code).toBe("wrong_password");
    const login = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it.each(["short", "x".repeat(257)])("refuses the new password %j by length", async (value) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/me/password", {
      token: e.token,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword: value },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "newPassword" });
  });

  it("blocks after 5 wrong current passwords", async () => {
    const e = await setup();
    for (let i = 0; i < 5; i++) {
      const wrong = await call(e, "POST", "/api/me/password", {
        token: e.token,
        body: { currentPassword: "not the password", newPassword },
      });
      expect(wrong.statusCode).toBe(400);
    }
    const blocked = await call(e, "POST", "/api/me/password", {
      token: e.token,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>()).toMatchObject({ code: "rate_limited", retryAfterSeconds: 15 * 60 });

    e.clock.advanceMinutes(16);
    const later = await call(e, "POST", "/api/me/password", {
      token: e.token,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword },
    });
    expect(later.statusCode).toBe(204);
  });

  it("needs a login", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/me/password", {
      body: { currentPassword: DEFAULT_PASSWORD, newPassword },
    });
    expect(response.statusCode).toBe(401);
  });
});
