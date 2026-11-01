import type { ApiErrorBody } from "@lueckenfueller/shared";
import { afterEach, describe, expect, it } from "vitest";
import { call, createTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv | undefined;
afterEach(async () => {
  await env?.app.close();
  env = undefined;
});

async function setup(): Promise<TestEnv> {
  env = await createTestEnv();
  return env;
}

describe("error format", () => {
  it("answers unknown routes with not_found", async () => {
    const e = await setup();
    for (const [method, url] of [
      ["GET", "/api/nope"],
      ["POST", "/api/admin/nope"],
      ["GET", "/"],
    ] as const) {
      const response = await call(e, method, url);
      expect(response.statusCode).toBe(404);
      expect(response.json<ApiErrorBody>()).toEqual({ statusCode: 404, error: "Not Found", code: "not_found" });
    }
  });

  it("answers schema errors with validation and the field", async () => {
    const e = await setup();
    const missing = await call(e, "POST", "/api/auth/login", { body: { password: "x" } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<ApiErrorBody>()).toEqual({
      statusCode: 400,
      error: "Bad Request",
      code: "validation",
      field: "username",
    });

    const wrongType = await call(e, "POST", "/api/auth/login", { body: { username: 5, password: "x" } });
    expect(wrongType.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });

    const tooLong = await call(e, "POST", "/api/auth/login", { body: { username: "x".repeat(1001), password: "x" } });
    expect(tooLong.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });
  });

  it("answers broken JSON and an empty body with validation, not a server error", async () => {
    const e = await setup();
    const broken = await e.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json<ApiErrorBody>().code).toBe("validation");

    const empty = await e.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json<ApiErrorBody>()).toMatchObject({ code: "validation", field: "username" });
  });

  it("accepts a JSON content type without a body where no body is needed", async () => {
    const e = await setup();
    const response = await e.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("gives other client errors the generic code and no details", async () => {
    const e = await setup();
    const response = await e.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "x".repeat(70 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json<ApiErrorBody>()).toMatchObject({ statusCode: 413, code: "error" });
  });

  it("hides the details of server errors", async () => {
    const e = await setup();
    e.db.exec("DROP TABLE sessions");
    const response = await call(e, "GET", "/api/me", { token: "any" });
    expect(response.statusCode).toBe(500);
    expect(response.json<ApiErrorBody>()).toEqual({ statusCode: 500, error: "Internal Server Error", code: "error" });
  });
});
