import type { AdminUser, ApiErrorBody } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createInvite } from "../src/accounts/invites.js";
import { addUserWithSession, allStrings, call, createTestEnv, type TestEnv } from "./helpers.js";

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

const adminRoutes: [string, string, unknown?][] = [
  ["GET", "/api/admin/users"],
  ["PATCH", "/api/admin/users/1", { username: "Whoever" }],
  ["DELETE", "/api/admin/users/1"],
  ["POST", "/api/admin/users/1/password-reset"],
  ["GET", "/api/admin/invites"],
  ["POST", "/api/admin/invites", { name: "Some One" }],
  ["DELETE", "/api/admin/invites/1"],
];

describe("admin guard", () => {
  it.each(adminRoutes)("%s %s answers 401 without a login", async (method, url, body) => {
    const e = await setup();
    const response = await call(e, method as "GET", url, { body });
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiErrorBody>().code).toBe("unauthorized");
  });

  it.each(adminRoutes)("%s %s answers 403 for a non-admin and changes nothing", async (method, url, body) => {
    const e = await setup();
    const before = JSON.stringify(e.db.prepare("SELECT * FROM users").all());
    const response = await call(e, method as "GET", url, { token: e.friend.token, body });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiErrorBody>().code).toBe("forbidden");
    expect(JSON.stringify(e.db.prepare("SELECT * FROM users").all())).toBe(before);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM invites").get() as { n: number }).n).toBe(0);
  });

  it("lets admins in", async () => {
    const e = await setup();
    expect((await call(e, "GET", "/api/admin/users", { token: e.admin.token })).statusCode).toBe(200);
  });
});

describe("GET /api/admin/users", () => {
  it("lists all accounts sorted by username, without secrets", async () => {
    const e = await setup();
    await addUserWithSession(e, "anna K.");
    const response = await call(e, "GET", "/api/admin/users", { token: e.admin.token });
    const users = response.json<AdminUser[]>();
    expect(users.map((u) => u.username)).toEqual(["Admin A.", "anna K.", "Vincent R."]);
    expect(users[0]).toEqual({
      id: e.admin.id,
      username: "Admin A.",
      isAdmin: true,
      createdAt: e.clock.now().toISOString(),
    });
    expect(Object.keys(users[1]!).sort()).toEqual(["createdAt", "id", "isAdmin", "username"]);
  });
});

describe("PATCH /api/admin/users/:id", () => {
  it("renames a user", async () => {
    const e = await setup();
    const response = await call(e, "PATCH", `/api/admin/users/${e.friend.id}`, {
      token: e.admin.token,
      body: { username: "  Vince  R. " },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminUser>()).toMatchObject({ id: e.friend.id, username: "Vince R.", isAdmin: false });
    expect((await call(e, "GET", "/api/me", { token: e.friend.token })).json<{ username: string }>().username).toBe(
      "Vince R.",
    );
  });

  it("refuses a taken name (without case), invalid names and unknown ids", async () => {
    const e = await setup();
    const taken = await call(e, "PATCH", `/api/admin/users/${e.friend.id}`, {
      token: e.admin.token,
      body: { username: "admin a." },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json<ApiErrorBody>().code).toBe("username_taken");

    const invalid = await call(e, "PATCH", `/api/admin/users/${e.friend.id}`, {
      token: e.admin.token,
      body: { username: "!" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });

    const unknown = await call(e, "PATCH", "/api/admin/users/9999", {
      token: e.admin.token,
      body: { username: "Nobody" },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().code).toBe("not_found");
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("deletes a user together with their sessions and open resets", async () => {
    const e = await setup();
    await call(e, "POST", `/api/admin/users/${e.friend.id}/password-reset`, { token: e.admin.token });
    const response = await call(e, "DELETE", `/api/admin/users/${e.friend.id}`, { token: e.admin.token });
    expect(response.statusCode).toBe(204);
    expect((await call(e, "GET", "/api/me", { token: e.friend.token })).statusCode).toBe(401);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);
    expect((e.db.prepare("SELECT COUNT(*) AS n FROM password_resets").get() as { n: number }).n).toBe(0);
  });

  it("keeps the invite a deleted admin created", async () => {
    const e = await setup();
    const created = await call(e, "POST", "/api/admin/invites", { token: e.admin.token, body: { name: "New Friend" } });
    const second = await addUserWithSession(e, "Second Admin", { isAdmin: true });
    const own = createInvite(e.db, { suggestedUsername: "Own", isAdmin: false, createdBy: second.id }, e.clock.now());
    await call(e, "DELETE", `/api/admin/users/${second.id}`, { token: e.admin.token });
    const list = await call(e, "GET", "/api/admin/invites", { token: e.admin.token });
    expect(
      list
        .json<{ id: number }[]>()
        .map((i) => i.id)
        .sort(),
    ).toEqual([created.json<{ id: number }>().id, own.id].sort());
  });

  it("refuses deleting oneself", async () => {
    const e = await setup();
    const response = await call(e, "DELETE", `/api/admin/users/${e.admin.id}`, { token: e.admin.token });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().code).toBe("cannot_delete_self");
    expect((await call(e, "GET", "/api/me", { token: e.admin.token })).statusCode).toBe(200);
  });

  it("answers not_found for unknown ids", async () => {
    const e = await setup();
    const response = await call(e, "DELETE", "/api/admin/users/9999", { token: e.admin.token });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>().code).toBe("not_found");
  });
});

describe("DELETE /api/admin/invites/:id", () => {
  it("answers not_found for unknown ids and for used invites", async () => {
    const e = await setup();
    expect((await call(e, "DELETE", "/api/admin/invites/9999", { token: e.admin.token })).statusCode).toBe(404);
    const created = (
      await call(e, "POST", "/api/admin/invites", { token: e.admin.token, body: { name: "New Friend" } })
    ).json<{ id: number; token: string }>();
    await call(e, "POST", `/api/invites/${created.token}/accept`, {
      body: { username: "New F.", password: "long enough password" },
    });
    expect((await call(e, "DELETE", `/api/admin/invites/${created.id}`, { token: e.admin.token })).statusCode).toBe(
      404,
    );
  });
});

describe("secrets in responses", () => {
  it("never contain password hashes or token hashes", async () => {
    const e = await setup();
    const responses = [
      await call(e, "GET", "/api/me", { token: e.friend.token }),
      await call(e, "PATCH", "/api/me", { token: e.friend.token, body: { seedColor: "#112233" } }),
      await call(e, "GET", "/api/admin/users", { token: e.admin.token }),
      await call(e, "POST", "/api/admin/invites", { token: e.admin.token, body: { name: "New Friend" } }),
      await call(e, "GET", "/api/admin/invites", { token: e.admin.token }),
      await call(e, "POST", `/api/admin/users/${e.friend.id}/password-reset`, { token: e.admin.token }),
      await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: e.friend.password } }),
      await call(e, "POST", "/api/auth/login", { body: { username: "Vincent R.", password: "wrong wrong" } }),
    ];
    const secrets = [
      ...(e.db.prepare("SELECT password_hash FROM users").all() as { password_hash: string }[]).map(
        (r) => r.password_hash,
      ),
      ...(e.db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[]).map((r) => r.token_hash),
      ...(e.db.prepare("SELECT token_hash FROM invites").all() as { token_hash: string }[]).map((r) => r.token_hash),
      ...(e.db.prepare("SELECT token_hash FROM password_resets").all() as { token_hash: string }[]).map(
        (r) => r.token_hash,
      ),
    ];
    expect(secrets.length).toBeGreaterThanOrEqual(6);
    for (const response of responses) {
      for (const text of allStrings(response.json())) {
        for (const secret of secrets) expect(text).not.toContain(secret);
        expect(text).not.toContain("$argon2");
      }
    }
  });
});
