import {
  INVITE_VALID_DAYS,
  type AdminInvite,
  type ApiErrorBody,
  type CreatedInvite,
  type InviteInfo,
  type Me,
  type SessionResponse,
} from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createInvite } from "../src/accounts/invites.js";
import { addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup(): Promise<TestEnv & { adminToken: string; adminId: number }> {
  env = await createTestEnv();
  const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
  return { ...env, adminToken: admin.token, adminId: admin.id };
}

async function invite(e: Awaited<ReturnType<typeof setup>>, username = "Vincent R."): Promise<CreatedInvite> {
  const response = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { username } });
  expect(response.statusCode).toBe(201);
  return response.json<CreatedInvite>();
}

const accept = { username: "Vincent R.", password: "my chosen password" };

describe("creating invites (admin)", () => {
  it("creates an invite with the exact username and 14 days of validity", async () => {
    const e = await setup();
    const created = await invite(e);
    expect(created).toMatchObject({ suggestedUsername: "Vincent R.", id: expect.any(Number) });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(INVITE_VALID_DAYS * 24 * 3600 * 1000);
  });

  it("takes the typed username exactly (normalized), without shortening the last name", async () => {
    const e = await setup();
    expect((await invite(e, "  Samuel   Kr. ")).suggestedUsername).toBe("Samuel Kr.");
    expect((await invite(e, "Max")).suggestedUsername).toBe("Max");
  });

  it("stores only a hash of the token", async () => {
    const e = await setup();
    const created = await invite(e);
    expect(JSON.stringify(e.db.prepare("SELECT * FROM invites").all())).not.toContain(created.token);
  });

  it.each(["", "   ", "1234", "x".repeat(33), "<b> <i>"])("refuses the username %j", async (username) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { username } });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });
  });

  it("refuses a request with neither username nor name", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });
  });

  it("refuses a username a user has (without case)", async () => {
    const e = await setup();
    await addUserWithSession(e, "Samuel Kr.");
    const response = await call(e, "POST", "/api/admin/invites", {
      token: e.adminToken,
      body: { username: "samuel  kr." },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorBody>().code).toBe("username_taken");
  });

  it("refuses a username an open invite has, but not one of a used, expired or withdrawn invite", async () => {
    const e = await setup();
    const open = await invite(e, "Samuel H.");
    const again = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { username: "SAMUEL H." } });
    expect(again.statusCode).toBe(409);
    expect(again.json<ApiErrorBody>().code).toBe("username_taken");

    // Withdrawn: free again.
    await call(e, "DELETE", `/api/admin/invites/${open.id}`, { token: e.adminToken });
    const second = await invite(e, "Samuel H.");
    // Expired: free again.
    e.clock.advanceDays(INVITE_VALID_DAYS);
    const third = await invite(e, "Samuel H.");
    expect(third.id).not.toBe(second.id);
    // Used: the name belongs to a user now (still refused), but through the user, not the invite.
    await call(e, "POST", `/api/invites/${third.token}/accept`, { body: { password: "my chosen password" } });
    const used = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { username: "Samuel H." } });
    expect(used.statusCode).toBe(409);
  });

  it("still takes the legacy name field of older frontends and makes a suggestion from it", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", {
      token: e.adminToken,
      body: { name: "Vincent Richter" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<CreatedInvite>().suggestedUsername).toBe("Vincent R.");
    const taken = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { name: "Vincent Richter" } });
    expect(taken.statusCode).toBe(409);
    for (const name of ["", "1234", "x".repeat(81)]) {
      const bad = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { name } });
      expect(bad.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "name" });
    }
  });

  it("uses username and ignores name when a new frontend sends both", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", {
      token: e.adminToken,
      body: { username: "Samuel Kr.", name: "Samuel Kr." },
    });
    expect(response.json<CreatedInvite>().suggestedUsername).toBe("Samuel Kr.");
  });

  it("never makes admin invites, even when asked to", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", {
      token: e.adminToken,
      body: { username: "Mallory M.", isAdmin: true },
    });
    const created = response.json<CreatedInvite>();
    const accepted = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(accepted.json<SessionResponse>().user.isAdmin).toBe(false);
  });

  it("lists only open invites, newest first, without tokens", async () => {
    const e = await setup();
    const first = await invite(e, "Anna A.");
    const second = await invite(e, "Ben B.");
    const third = await invite(e, "Cem C.");
    await call(e, "POST", `/api/invites/${first.token}/accept`, { body: { password: accept.password } });
    await call(e, "DELETE", `/api/admin/invites/${third.id}`, { token: e.adminToken });

    const list = await call(e, "GET", "/api/admin/invites", { token: e.adminToken });
    expect(list.json<AdminInvite[]>().map((i) => i.id)).toEqual([second.id]);
    expect(list.body).not.toContain(second.token);

    e.clock.advanceDays(INVITE_VALID_DAYS);
    expect((await call(e, "GET", "/api/admin/invites", { token: e.adminToken })).json()).toEqual([]);
  });
});

describe("GET /api/invites/:token", () => {
  it("shows the username and expiry without a login", async () => {
    const e = await setup();
    const created = await invite(e);
    const response = await call(e, "GET", `/api/invites/${created.token}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<InviteInfo>()).toEqual({ suggestedUsername: "Vincent R.", expiresAt: created.expiresAt });
  });

  it("answers invite_invalid for an unknown token", async () => {
    const e = await setup();
    const response = await call(e, "GET", "/api/invites/not-a-real-token");
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>().code).toBe("invite_invalid");
  });

  it("answers invite_invalid once it has expired", async () => {
    const e = await setup();
    const created = await invite(e);
    e.clock.advanceDays(INVITE_VALID_DAYS - 1);
    expect((await call(e, "GET", `/api/invites/${created.token}`)).statusCode).toBe(200);
    e.clock.advanceDays(1);
    const response = await call(e, "GET", `/api/invites/${created.token}`);
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>().code).toBe("invite_invalid");
  });

  it("answers invite_invalid after it was withdrawn", async () => {
    const e = await setup();
    const created = await invite(e);
    const withdrawn = await call(e, "DELETE", `/api/admin/invites/${created.id}`, { token: e.adminToken });
    expect(withdrawn.statusCode).toBe(204);
    expect((await call(e, "GET", `/api/invites/${created.token}`)).statusCode).toBe(404);
    expect((await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept })).statusCode).toBe(404);
  });

  it("limits wrong tokens to 30 per address, and an address is freed after the window", async () => {
    const e = await setup();
    const created = await invite(e);
    for (let i = 0; i < 30; i++) {
      expect((await call(e, "GET", `/api/invites/wrong-${i}`, { ip: "10.0.0.9" })).statusCode).toBe(404);
    }
    const blocked = await call(e, "GET", `/api/invites/${created.token}`, { ip: "10.0.0.9" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>()).toMatchObject({ code: "rate_limited", retryAfterSeconds: 15 * 60 });
    expect((await call(e, "GET", `/api/invites/${created.token}`, { ip: "10.0.0.10" })).statusCode).toBe(200);
    e.clock.advanceMinutes(16);
    expect((await call(e, "GET", `/api/invites/${created.token}`, { ip: "10.0.0.9" })).statusCode).toBe(200);
  });
});

describe("POST /api/invites/:token/accept", () => {
  it("creates the account, logs in, and the new user is no admin", async () => {
    const e = await setup();
    const created = await invite(e);
    const response = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(response.statusCode).toBe(201);
    const session = response.json<SessionResponse>();
    expect(session.user).toMatchObject({ username: "Vincent R.", isAdmin: false, seedColor: null });

    const me = await call(e, "GET", "/api/me", { token: session.token });
    expect(me.json<Me>().username).toBe("Vincent R.");
    const login = await call(e, "POST", "/api/auth/login", {
      body: { username: "vincent r.", password: accept.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("can be used only once", async () => {
    const e = await setup();
    const created = await invite(e);
    const first = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(first.statusCode).toBe(201);
    const second = await call(e, "POST", `/api/invites/${created.token}/accept`, {
      body: { password: "another password" },
    });
    expect(second.statusCode).toBe(404);
    expect(second.json<ApiErrorBody>().code).toBe("invite_invalid");
    expect((await call(e, "GET", `/api/invites/${created.token}`)).statusCode).toBe(404);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(2);
  });

  it("lets only one of two simultaneous accepts win", async () => {
    const e = await setup();
    const created = await invite(e);
    const results = await Promise.all([
      call(e, "POST", `/api/invites/${created.token}/accept`, {
        body: { password: "password one!" },
      }),
      call(e, "POST", `/api/invites/${created.token}/accept`, {
        body: { password: "password two!" },
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 404]);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(2);
  });

  it("refuses an expired invite", async () => {
    const e = await setup();
    const created = await invite(e);
    e.clock.advanceDays(INVITE_VALID_DAYS);
    const response = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>().code).toBe("invite_invalid");
  });

  it("ignores a username in the body: the account gets the one the admin fixed", async () => {
    const e = await setup();
    const created = await invite(e, "Samuel Kr.");
    const response = await call(e, "POST", `/api/invites/${created.token}/accept`, {
      body: { username: "Something Else", password: accept.password },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<SessionResponse>().user.username).toBe("Samuel Kr.");
    const login = await call(e, "POST", "/api/auth/login", {
      body: { username: "Samuel Kr.", password: accept.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("answers username_taken when the name was taken in the meantime, and keeps the invite usable", async () => {
    const e = await setup();
    const created = await invite(e);
    // E.g. the admin renamed another user to this name after the invite was made.
    await addUserWithSession(e, "vincent r.");
    const taken = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(taken.statusCode).toBe(409);
    expect(taken.json<ApiErrorBody>().code).toBe("username_taken");
    expect((await call(e, "GET", `/api/invites/${created.token}`)).statusCode).toBe(200);
  });

  it("makes the loser of two accepts for the same name fail with username_taken", async () => {
    const e = await setup();
    const one = await invite(e, "Anna A.");
    // A second invite for the same name can exist only from before the duplicate check: insert it directly.
    const two = createInvite(e.db, { suggestedUsername: "anna a.", isAdmin: false, createdBy: e.adminId }, e.clock.now());
    const results = await Promise.all([
      call(e, "POST", `/api/invites/${one.token}/accept`, { body: { password: accept.password } }),
      call(e, "POST", `/api/invites/${two.token}/accept`, { body: { password: accept.password } }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const open = e.db.prepare("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL").get() as { n: number };
    expect(open.n).toBe(1);
  });

  it.each([
    [{ password: "short" }, "password"],
    [{ password: "x".repeat(257) }, "password"],
    [{}, "password"],
  ])("refuses %j with a validation error on %s and keeps the invite", async (body, field) => {
    const e = await setup();
    const created = await invite(e);
    const response = await call(e, "POST", `/api/invites/${created.token}/accept`, { body });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field });
    expect((await call(e, "GET", `/api/invites/${created.token}`)).statusCode).toBe(200);
  });
});

describe("the admin flag of an invite", () => {
  it("comes from the invite, which only the command line creates as admin invite", async () => {
    const e = await setup();
    const created = createInvite(e.db, { suggestedUsername: "Zed", isAdmin: true, createdBy: null }, e.clock.now());
    const response = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(response.json<SessionResponse>().user.isAdmin).toBe(true);
    expect(
      (await call(e, "GET", "/api/admin/users", { token: response.json<SessionResponse>().token })).statusCode,
    ).toBe(200);
  });
});
