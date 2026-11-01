import {
  RESET_VALID_HOURS,
  type ApiErrorBody,
  type CreatedPasswordReset,
  type PasswordResetInfo,
  type SessionResponse,
} from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { addUserWithSession, call, createTestEnv, DEFAULT_PASSWORD, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup() {
  env = await createTestEnv();
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  const friend = await addUserWithSession(env, "Vincent R.");
  return { ...env, admin, friend };
}

async function createReset(e: Awaited<ReturnType<typeof setup>>, userId = e.friend.id): Promise<CreatedPasswordReset> {
  const response = await call(e, "POST", `/api/admin/users/${userId}/password-reset`, { token: e.admin.token });
  expect(response.statusCode).toBe(201);
  return response.json<CreatedPasswordReset>();
}

const newPassword = "my new password!";

describe("POST /api/admin/users/:id/password-reset", () => {
  it("creates a reset valid for 24 hours and stores only a hash", async () => {
    const e = await setup();
    const reset = await createReset(e);
    expect(reset.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(reset.expiresAt) - e.clock.now().getTime()).toBe(RESET_VALID_HOURS * 3600 * 1000);
    expect(JSON.stringify(e.db.prepare("SELECT * FROM password_resets").all())).not.toContain(reset.token);
  });

  it("replaces an open reset of the same user only", async () => {
    const e = await setup();
    const other = await addUserWithSession(e, "Anna K.");
    const first = await createReset(e);
    const otherReset = await createReset(e, other.id);
    const second = await createReset(e);

    expect((await call(e, "GET", `/api/password-resets/${first.token}`)).statusCode).toBe(404);
    expect((await call(e, "GET", `/api/password-resets/${second.token}`)).statusCode).toBe(200);
    expect((await call(e, "GET", `/api/password-resets/${otherReset.token}`)).statusCode).toBe(200);
  });

  it("answers not_found for an unknown or malformed user id", async () => {
    const e = await setup();
    for (const id of ["9999", "abc", "-1", "1.5"]) {
      const response = await call(e, "POST", `/api/admin/users/${id}/password-reset`, { token: e.admin.token });
      expect(response.statusCode).toBe(404);
      expect(response.json<ApiErrorBody>().code).toBe("not_found");
    }
  });
});

describe("GET /api/password-resets/:token", () => {
  it("shows the username and expiry without a login", async () => {
    const e = await setup();
    const reset = await createReset(e);
    const response = await call(e, "GET", `/api/password-resets/${reset.token}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<PasswordResetInfo>()).toEqual({ username: "Vincent R.", expiresAt: reset.expiresAt });
  });

  it("answers reset_invalid for unknown and expired tokens", async () => {
    const e = await setup();
    const unknown = await call(e, "GET", "/api/password-resets/nope");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().code).toBe("reset_invalid");

    const reset = await createReset(e);
    e.clock.advanceHours(RESET_VALID_HOURS - 1);
    expect((await call(e, "GET", `/api/password-resets/${reset.token}`)).statusCode).toBe(200);
    e.clock.advanceHours(1);
    const expired = await call(e, "GET", `/api/password-resets/${reset.token}`);
    expect(expired.statusCode).toBe(404);
    expect(expired.json<ApiErrorBody>().code).toBe("reset_invalid");
  });

  it("limits wrong tokens per address (shared with invites)", async () => {
    const e = await setup();
    for (let i = 0; i < 30; i++) {
      await call(e, "GET", `/api/password-resets/wrong-${i}`, { ip: "10.0.0.7" });
    }
    const blocked = await call(e, "GET", "/api/password-resets/wrong-again", { ip: "10.0.0.7" });
    expect(blocked.statusCode).toBe(429);
    const invites = await call(e, "GET", "/api/invites/wrong-again", { ip: "10.0.0.7" });
    expect(invites.statusCode).toBe(429);
  });
});

describe("POST /api/password-resets/:token", () => {
  it("sets the password, returns a new session and ends all earlier sessions", async () => {
    const e = await setup();
    const reset = await createReset(e);
    const response = await call(e, "POST", `/api/password-resets/${reset.token}`, { body: { password: newPassword } });
    expect(response.statusCode).toBe(200);
    const session = response.json<SessionResponse>();
    expect(session.user.username).toBe("Vincent R.");

    expect((await call(e, "GET", "/api/me", { token: e.friend.token })).statusCode).toBe(401);
    expect((await call(e, "GET", "/api/me", { token: session.token })).statusCode).toBe(200);
    const oldLogin = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: newPassword },
    });
    expect(newLogin.statusCode).toBe(200);
    // Other users keep their sessions.
    expect((await call(e, "GET", "/api/me", { token: e.admin.token })).statusCode).toBe(200);
  });

  it("can be used only once", async () => {
    const e = await setup();
    const reset = await createReset(e);
    await call(e, "POST", `/api/password-resets/${reset.token}`, { body: { password: newPassword } });
    const again = await call(e, "POST", `/api/password-resets/${reset.token}`, {
      body: { password: "an attacker's password" },
    });
    expect(again.statusCode).toBe(404);
    expect(again.json<ApiErrorBody>().code).toBe("reset_invalid");
    expect((await call(e, "GET", `/api/password-resets/${reset.token}`)).statusCode).toBe(404);
  });

  it("refuses an expired reset and keeps the old password", async () => {
    const e = await setup();
    const reset = await createReset(e);
    e.clock.advanceHours(RESET_VALID_HOURS);
    const response = await call(e, "POST", `/api/password-resets/${reset.token}`, { body: { password: newPassword } });
    expect(response.statusCode).toBe(404);
    const login = await call(e, "POST", "/api/auth/login", {
      body: { username: "Vincent R.", password: DEFAULT_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it.each(["short", "x".repeat(257)])("refuses the password %j by length and keeps the reset", async (password) => {
    const e = await setup();
    const reset = await createReset(e);
    const response = await call(e, "POST", `/api/password-resets/${reset.token}`, { body: { password } });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "password" });
    expect((await call(e, "GET", `/api/password-resets/${reset.token}`)).statusCode).toBe(200);
  });

  it("lifts a login block of that user", async () => {
    const e = await setup();
    for (let i = 0; i < 5; i++) {
      await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: "wrong wrong" } });
    }
    const reset = await createReset(e);
    await call(e, "POST", `/api/password-resets/${reset.token}`, { body: { password: newPassword } });
    const login = await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: newPassword } });
    expect(login.statusCode).toBe(200);
  });
});
