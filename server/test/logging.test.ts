import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { maskTokens } from "../src/log-masking.js";
import { addUserWithSession, call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

function captureLog(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

describe("maskTokens", () => {
  it.each([
    ["/api/invites/SECRET", "/api/invites/***"],
    ["/api/invites/SECRET/accept", "/api/invites/***/accept"],
    ["/api/invites/SECRET?x=1", "/api/invites/***?x=1"],
    ["/api/password-resets/SECRET", "/api/password-resets/***"],
    ["/api/password-resets/SECRET/", "/api/password-resets/***/"],
    ["/api/admin/invites/5", "/api/admin/invites/5"],
    ["/api/admin/users/5/password-reset", "/api/admin/users/5/password-reset"],
    ["/api/health", "/api/health"],
  ])("%s → %s", (input, expected) => {
    expect(maskTokens(input)).toBe(expected);
  });
});

describe("request log", () => {
  it("never contains invite tokens, reset tokens, session tokens, passwords or Authorization headers", async () => {
    const log = captureLog();
    env = await createTestEnv({ logLevel: "info" }, { logStream: log.stream });
    const admin = await addUserWithSession(env, "Admin A.", { isAdmin: true });
    const friend = await addUserWithSession(env, "Vincent R.");

    const invite = (
      await call(env, "POST", "/api/admin/invites", { token: admin.token, body: { name: "New Friend" } })
    ).json<{
      token: string;
    }>();
    const reset = (
      await call(env, "POST", `/api/admin/users/${friend.id}/password-reset`, { token: admin.token })
    ).json<{ token: string }>();
    await call(env, "GET", `/api/invites/${invite.token}`);
    await call(env, "POST", `/api/invites/${invite.token}/accept`, {
      body: { username: "New F.", password: "very secret password" },
    });
    await call(env, "GET", `/api/password-resets/${reset.token}`);
    await call(env, "POST", `/api/password-resets/${reset.token}`, { body: { password: "another secret password" } });
    await call(env, "GET", `/api/invites/${invite.token}/unknown-extra`);
    await call(env, "GET", "/api/invites/wrong-token-1");

    const text = log.text();
    expect(text).toContain("/api/invites/***/accept");
    expect(text).toContain("/api/password-resets/***");
    for (const secret of [
      invite.token,
      reset.token,
      admin.token,
      friend.token,
      "very secret password",
      "another secret password",
      "wrong-token-1",
      "Bearer",
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
