import { INVITE_VALID_DAYS, RESET_VALID_HOURS, type SessionResponse } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli-commands.js";
import { addUserWithSession, call, createTestEnv, testConfig, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

function run(e: TestEnv, args: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(args, {
    db: e.db,
    config: testConfig(),
    now: e.clock.now,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("cli admin-link", () => {
  it("prints a link under APP_URL that creates an admin account", async () => {
    env = await createTestEnv();
    const result = run(env, ["admin-link", "Vincent Richter"]);
    expect(result.code).toBe(0);
    const match = /(https:\/\/friends\.example\.github\.io\/app\/#\/einladung\/)([A-Za-z0-9_-]{43})/.exec(result.out);
    expect(match).not.toBeNull();
    expect(result.out).toMatch(/works once and until \w+,? \d+ \w+ \d{4}.* \d\d:\d\d \w+\./);
    expect(result.out).toContain("Suggested username: Vincent R.");

    const info = await call(env, "GET", `/api/invites/${match![2]}`);
    expect(info.json()).toMatchObject({ suggestedUsername: "Vincent R." });
    const accepted = await call(env, "POST", `/api/invites/${match![2]}/accept`, {
      body: { username: "Vincent R.", password: "my chosen password" },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json<SessionResponse>().user.isAdmin).toBe(true);
  });

  it("suggests Admin without a name and expires after 14 days", async () => {
    env = await createTestEnv();
    const result = run(env, ["admin-link"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Suggested username: Admin");
    const token = /#\/einladung\/(\S+)/.exec(result.out)![1]!;
    env.clock.advanceDays(INVITE_VALID_DAYS);
    expect((await call(env, "GET", `/api/invites/${token}`)).statusCode).toBe(404);
  });

  it("is the only way to get an admin invite", async () => {
    env = await createTestEnv();
    const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
    run(env, ["admin-link"]);
    await call(env, "POST", "/api/admin/invites", { token: admin.token, body: { name: "Friend F." } });
    const rows = env.db.prepare("SELECT is_admin, created_by FROM invites ORDER BY id").all() as {
      is_admin: number;
      created_by: number | null;
    }[];
    expect(rows).toEqual([
      { is_admin: 1, created_by: null },
      { is_admin: 0, created_by: admin.id },
    ]);
  });
});

describe("cli password-link", () => {
  it("prints a reset link for the user, found without case", async () => {
    env = await createTestEnv();
    const user = await addUserWithSession(env, "Vincent R.");
    const result = run(env, ["password-link", "vincent", "r."]);
    expect(result.code).toBe(0);
    const match = /https:\/\/friends\.example\.github\.io\/app\/#\/passwort\/([A-Za-z0-9_-]{43})/.exec(result.out);
    expect(match).not.toBeNull();

    const info = await call(env, "GET", `/api/password-resets/${match![1]}`);
    expect(info.json()).toMatchObject({ username: "Vincent R." });
    const done = await call(env, "POST", `/api/password-resets/${match![1]}`, {
      body: { password: "a new password!" },
    });
    expect(done.statusCode).toBe(200);
    expect((await call(env, "GET", "/api/me", { token: user.token })).statusCode).toBe(401);
  });

  it("replaces an earlier link and expires after 24 hours", async () => {
    env = await createTestEnv();
    await addUserWithSession(env, "Vincent R.");
    const first = /#\/passwort\/(\S+)/.exec(run(env, ["password-link", "Vincent R."]).out)![1]!;
    const second = /#\/passwort\/(\S+)/.exec(run(env, ["password-link", "Vincent R."]).out)![1]!;
    expect((await call(env, "GET", `/api/password-resets/${first}`)).statusCode).toBe(404);
    expect((await call(env, "GET", `/api/password-resets/${second}`)).statusCode).toBe(200);
    env.clock.advanceHours(RESET_VALID_HOURS);
    expect((await call(env, "GET", `/api/password-resets/${second}`)).statusCode).toBe(404);
  });

  it("says clearly when the account is unknown and lists the existing ones", async () => {
    env = await createTestEnv();
    await addUserWithSession(env, "Vincent R.");
    const result = run(env, ["password-link", "Nobody"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('There is no account named "Nobody".');
    expect(result.err).toContain("Vincent R.");
    expect(result.out).toBe("");
    expect((env.db.prepare("SELECT COUNT(*) AS n FROM password_resets").get() as { n: number }).n).toBe(0);
  });

  it("needs a username", async () => {
    env = await createTestEnv();
    const result = run(env, ["password-link"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Usage:");
  });
});

describe("cli usage", () => {
  it.each([[[]], [["unknown"]], [["--help"]]])("prints the usage and fails for %j", async (args) => {
    env = await createTestEnv();
    const result = run(env, args);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Usage:");
    expect(result.err).toContain("admin-link");
    expect(result.err).toContain("password-link");
  });
});
