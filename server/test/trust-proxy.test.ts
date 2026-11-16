import { PassThrough } from "node:stream";
import type { ApiErrorBody } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { LOGIN_FAILURES_PER_IP } from "../src/auth/rate-limit.js";
import { createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

/** A failed login from a new made-up username each time, so only the limit per address can block it. */
async function failedLogin(e: TestEnv, forwardedFor: string, n: number) {
  return e.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "x-forwarded-for": forwardedFor },
    payload: { username: `Nobody ${n}`, password: "wrong wrong wrong" },
  });
}

describe("TRUST_PROXY (one hop)", () => {
  it("limits per the last X-Forwarded-For entry, so a forged first entry does not help", async () => {
    env = await createTestEnv({ trustProxy: true });
    for (let n = 0; n < LOGIN_FAILURES_PER_IP; n++) {
      const response = await failedLogin(env, `10.0.0.${n}, 5.6.7.8`, n);
      expect(response.statusCode).toBe(401);
    }
    const blocked = await failedLogin(env, "10.9.9.9, 5.6.7.8", 99);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiErrorBody>().code).toBe("rate_limited");
    // Another real address is not affected.
    const other = await failedLogin(env, "10.9.9.9, 5.6.7.9", 100);
    expect(other.statusCode).toBe(401);
  });

  it("logs the last entry as the caller's address", async () => {
    const lines: string[] = [];
    const logStream = new PassThrough();
    logStream.on("data", (chunk: Buffer) => lines.push(chunk.toString()));
    env = await createTestEnv({ trustProxy: true, logLevel: "info" }, { logStream });
    await env.app.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    const log = lines.join("");
    expect(log).toContain('"remoteAddress":"5.6.7.8"');
    expect(log).not.toContain("1.2.3.4");
  });

  it("ignores X-Forwarded-For when the proxy is not trusted", async () => {
    env = await createTestEnv({ trustProxy: false });
    for (let n = 0; n < LOGIN_FAILURES_PER_IP; n++) {
      const response = await failedLogin(env, `10.0.0.${n}, 5.6.7.${n}`, n);
      expect(response.statusCode).toBe(401);
    }
    // Every header differed, but the real (socket) address is the same, so the caller is blocked.
    const blocked = await failedLogin(env, "10.9.9.9, 5.6.7.200", 99);
    expect(blocked.statusCode).toBe(429);
  });
});
