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

async function invite(e: Awaited<ReturnType<typeof setup>>, name = "Vincent Richter"): Promise<CreatedInvite> {
  const response = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { name } });
  expect(response.statusCode).toBe(201);
  return response.json<CreatedInvite>();
}

const accept = { username: "Vincent R.", password: "my chosen password" };

describe("creating invites (admin)", () => {
  it("creates an invite with a suggested username and 14 days of validity", async () => {
    const e = await setup();
    const created = await invite(e);
    expect(created).toMatchObject({ suggestedUsername: "Vincent R.", id: expect.any(Number) });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(INVITE_VALID_DAYS * 24 * 3600 * 1000);
  });

  it("stores only a hash of the token and not the typed full name", async () => {
    const e = await setup();
    const created = await invite(e, "Vincent Richter");
    const dump = JSON.stringify(e.db.prepare("SELECT * FROM invites").all());
    expect(dump).not.toContain(created.token);
    expect(dump).not.toContain("Richter");
  });

  it.each(["", "   ", "1234", "x".repeat(81), "<b> <i>"])("refuses the name %j", async (name) => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", { token: e.adminToken, body: { name } });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "name" });
  });

  it("never makes admin invites, even when asked to", async () => {
    const e = await setup();
    const response = await call(e, "POST", "/api/admin/invites", {
      token: e.adminToken,
      body: { name: "Mallory M.", isAdmin: true },
    });
    const created = response.json<CreatedInvite>();
    const accepted = await call(e, "POST", `/api/invites/${created.token}/accept`, { body: accept });
    expect(accepted.json<SessionResponse>().user.isAdmin).toBe(false);
  });

  it("lists only open invites, newest first, without tokens", async () => {
    const e = await setup();
    const first = await invite(e, "Anna Alt");
    const second = await invite(e, "Ben Bunt");
    const third = await invite(e, "Cem Clever");
    await call(e, "POST", `/api/invites/${first.token}/accept`, { body: accept });
    await call(e, "DELETE", `/api/admin/invites/${third.id}`, { token: e.adminToken });

    const list = await call(e, "GET", "/api/admin/invites", { token: e.adminToken });
    expect(list.json<AdminInvite[]>().map((i) => i.id)).toEqual([second.id]);
    expect(list.body).not.toContain(second.token);

    e.clock.advanceDays(INVITE_VALID_DAYS);
    expect((await call(e, "GET", "/api/admin/invites", { token: e.adminToken })).json()).toEqual([]);
  });
});

describe("GET /api/invites/:token", () => {
  it("shows the suggested username and expiry without a login", async () => {
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
      body: { username: "Someone Else", password: "another password" },
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
        body: { username: "Twin One", password: "password one!" },
      }),
      call(e, "POST", `/api/invites/${created.token}/accept`, {
        body: { username: "Twin Two", password: "password two!" },
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

  it("refuses a taken username (without case) and keeps the invite usable", async () => {
    const e = await setup();
    await addUserWithSession(e, "Vincent R.");
    const created = await invite(e);
    const taken = await call(e, "POST", `/api/invites/${created.token}/accept`, {
      body: { username: "vincent r.", password: accept.password },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json<ApiErrorBody>().code).toBe("username_taken");
    const ok = await call(e, "POST", `/api/invites/${created.token}/accept`, {
      body: { username: "Vincent Richter", password: accept.password },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("keeps the invite of the loser when two people pick the same name at the same time", async () => {
    const e = await setup();
    const one = await invite(e, "Anna Alt");
    const two = await invite(e, "Ben Bunt");
    const results = await Promise.all([
      call(e, "POST", `/api/invites/${one.token}/accept`, { body: accept }),
      call(e, "POST", `/api/invites/${two.token}/accept`, { body: accept }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const open = e.db.prepare("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL").get() as { n: number };
    expect(open.n).toBe(1);
  });

  it.each([
    [{ username: "A", password: "long enough password" }, "username"],
    [{ username: "Valid Name", password: "short" }, "password"],
    [{ username: "Valid Name", password: "x".repeat(257) }, "password"],
    [{ username: "<script>", password: "long enough password" }, "username"],
    [{ password: "long enough password" }, "username"],
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
