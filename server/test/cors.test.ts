import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

const allowed = "https://friends.example.github.io";
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("CORS", () => {
  it("allows the configured origin", async () => {
    app = await buildApp(testConfig({ corsOrigins: [allowed, "http://localhost:5173"] }));
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { origin: allowed } });
    expect(response.headers["access-control-allow-origin"]).toBe(allowed);
  });

  it("answers the preflight for Authorization and Content-Type", async () => {
    app = await buildApp(testConfig());
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/health",
      headers: {
        origin: allowed,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(allowed);
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("content-type");
  });

  it("does not echo a foreign origin", async () => {
    app = await buildApp(testConfig());
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example.com" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
