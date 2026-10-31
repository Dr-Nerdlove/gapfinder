import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/health", () => {
  it("returns 200 with status, version and an ISO time", async () => {
    app = await buildApp(testConfig({ appVersion: "1.2.3" }));
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    const body = response.json<{ status: string; version: string; time: string }>();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("1.2.3");
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });

  it("does not announce the framework", async () => {
    app = await buildApp(testConfig());
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("answers unknown routes with 404 and no stack trace", async () => {
    app = await buildApp(testConfig());
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("at ");
  });

  it("rejects bodies over the 64 KB limit", async () => {
    app = await buildApp(testConfig());
    const response = await app.inject({
      method: "POST",
      url: "/api/health",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ filler: "x".repeat(70 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
  });
});
