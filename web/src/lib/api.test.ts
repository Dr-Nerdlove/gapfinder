import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { isSessionExpired, parseErrorBody, request } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit) => handler(url, init));
}

const asFetch = (fn: unknown): typeof fetch => fn as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
});

describe("request", () => {
  it("returns the parsed body on success", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ id: 1, username: "Anna K." }));
    const result = await request("/api/me", { baseUrl: "http://api.test/", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: true, data: { id: 1, username: "Anna K." } });
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/me", expect.objectContaining({ method: "GET" }));
  });

  it("returns undefined data for 204", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 204 }));
    const result = await request("/api/auth/logout", { method: "POST", baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("sends the bearer token when given", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    await request("/api/me", { token: "abc123", baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    const init = fetchImpl.mock.calls[0]![1];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer abc123");
  });

  it("sends no Authorization header without a token", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    await request("/api/health", { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("sends JSON with a content type only when there is a body", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    await request("/api/auth/login", { method: "POST", body: { a: 1 }, baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    await request("/api/auth/logout", { method: "POST", baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    const [withBody, withoutBody] = fetchImpl.mock.calls.map((call) => call[1]);
    expect(withBody!.body).toBe('{"a":1}');
    expect((withBody!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(withoutBody!.body).toBeUndefined();
    expect(withoutBody!.headers).not.toHaveProperty("Content-Type");
  });

  it("parses an error body", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ statusCode: 429, error: "Too Many Requests", code: "rate_limited", retryAfterSeconds: 120 }, 429),
    );
    const result = await request("/api/auth/login", { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: false, kind: "error", status: 429, code: "rate_limited", retryAfterSeconds: 120 });
  });

  it("keeps the field of a validation error", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ statusCode: 400, error: "Bad Request", code: "validation", field: "username" }, 400));
    const result = await request("/api/me", { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: false, kind: "error", status: 400, code: "validation", field: "username" });
  });

  it("turns an unknown or missing error body into the generic code", async () => {
    for (const response of [
      () => new Response("<html>Bad gateway</html>", { status: 502 }),
      () => jsonResponse({ hello: "world" }, 500),
      () => jsonResponse({ code: "from_the_future" }, 400),
      () => jsonResponse(null, 500),
    ]) {
      const result = await request("/api/me", { baseUrl: "http://api.test", fetchImpl: asFetch(mockFetch(response)) });
      expect(result).toMatchObject({ ok: false, kind: "error", code: "error" });
    }
  });

  it("treats a success without readable JSON as an error", async () => {
    const fetchImpl = mockFetch(() => new Response("not json", { status: 200 }));
    const result = await request("/api/me", { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toMatchObject({ ok: false, kind: "error", status: 200, code: "error" });
  });

  it("reports a network error as offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await request("/api/me", { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: false, kind: "offline" });
  });

  it("gives up after the timeout, aborts the request and reports offline", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const pending = request("/api/me", { timeoutMs: 3000, baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    await vi.advanceTimersByTimeAsync(2999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    await expect(pending).resolves.toEqual({ ok: false, kind: "offline" });
  });
});

describe("parseErrorBody", () => {
  it("ignores a retryAfterSeconds that is not a number", () => {
    expect(parseErrorBody(429, { code: "rate_limited", retryAfterSeconds: "soon" })).toEqual({
      ok: false,
      kind: "error",
      status: 429,
      code: "rate_limited",
    });
  });
});

describe("isSessionExpired", () => {
  const error = (status: number, code: Parameters<typeof parseErrorBody>[1]) => parseErrorBody(status, { code });

  it("is true for an unauthorized answer", () => {
    expect(isSessionExpired(error(401, "unauthorized"))).toBe(true);
  });

  it("is true for a bare 401 without a known body", () => {
    expect(isSessionExpired(parseErrorBody(401, null))).toBe(true);
  });

  it("is false for wrong passwords, even when they come as 401", () => {
    expect(isSessionExpired(error(401, "invalid_credentials"))).toBe(false);
    expect(isSessionExpired(error(401, "wrong_password"))).toBe(false);
  });

  it("is false for other errors, offline and success", () => {
    expect(isSessionExpired(error(403, "forbidden"))).toBe(false);
    expect(isSessionExpired({ ok: false, kind: "offline" })).toBe(false);
    expect(isSessionExpired({ ok: true, data: 1 })).toBe(false);
  });
});

describe("typed endpoints", () => {
  async function call(fn: (o: api.CallOptions) => Promise<unknown>) {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    await fn({ baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl), token: "t" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    return { url, method: init.method, body: init.body };
  }

  it("uses the paths and methods of the contract", async () => {
    expect(await call((o) => api.login({ username: "a", password: "b" }, o))).toMatchObject({ url: "http://api.test/api/auth/login", method: "POST" });
    expect(await call((o) => api.logout(o))).toMatchObject({ url: "http://api.test/api/auth/logout", method: "POST" });
    expect(await call((o) => api.getMe(o))).toMatchObject({ url: "http://api.test/api/me", method: "GET" });
    expect(await call((o) => api.updateMe({ seedColor: null }, o))).toMatchObject({ method: "PATCH", body: '{"seedColor":null}' });
    expect(await call((o) => api.changePassword({ currentPassword: "a", newPassword: "b" }, o))).toMatchObject({ url: "http://api.test/api/me/password", method: "POST" });
    expect(await call((o) => api.getInvite("tok-1", o))).toMatchObject({ url: "http://api.test/api/invites/tok-1" });
    expect(await call((o) => api.acceptInvite("tok-1", { username: "a", password: "b" }, o))).toMatchObject({ url: "http://api.test/api/invites/tok-1/accept", method: "POST" });
    expect(await call((o) => api.getPasswordReset("tok_2", o))).toMatchObject({ url: "http://api.test/api/password-resets/tok_2" });
    expect(await call((o) => api.completePasswordReset("tok_2", { password: "x" }, o))).toMatchObject({ url: "http://api.test/api/password-resets/tok_2", method: "POST" });
    expect(await call((o) => api.listUsers(o))).toMatchObject({ url: "http://api.test/api/admin/users" });
    expect(await call((o) => api.renameUser(7, { username: "Neu" }, o))).toMatchObject({ url: "http://api.test/api/admin/users/7", method: "PATCH" });
    expect(await call((o) => api.deleteUser(7, o))).toMatchObject({ url: "http://api.test/api/admin/users/7", method: "DELETE" });
    expect(await call((o) => api.createPasswordReset(7, o))).toMatchObject({ url: "http://api.test/api/admin/users/7/password-reset", method: "POST" });
    expect(await call((o) => api.listInvites(o))).toMatchObject({ url: "http://api.test/api/admin/invites" });
    expect(await call((o) => api.createInvite({ name: "Anna K" }, o))).toMatchObject({ url: "http://api.test/api/admin/invites", method: "POST" });
    expect(await call((o) => api.deleteInvite(3, o))).toMatchObject({ url: "http://api.test/api/admin/invites/3", method: "DELETE" });
  });
});

describe("calendar endpoints", () => {
  async function call(fn: (o: api.CallOptions) => Promise<unknown>) {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    await fn({ baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl), token: "t" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    return { url, method: init.method, body: init.body };
  }

  it("uses the paths and methods of the contract", async () => {
    expect(await call((o) => api.listCalendars(o))).toMatchObject({ url: "http://api.test/api/calendars", method: "GET" });
    expect(await call((o) => api.addCalendar({ link: "https://x.test/a.ics", name: "Arbeit" }, o))).toMatchObject({
      url: "http://api.test/api/calendars",
      method: "POST",
      body: '{"link":"https://x.test/a.ics","name":"Arbeit"}',
    });
    expect(await call((o) => api.updateCalendar(5, { countsAsBusy: false }, o))).toMatchObject({
      url: "http://api.test/api/calendars/5",
      method: "PATCH",
      body: '{"countsAsBusy":false}',
    });
    expect(await call((o) => api.deleteCalendar(5, o))).toMatchObject({ url: "http://api.test/api/calendars/5", method: "DELETE" });
    expect(await call((o) => api.getCalendarPreview(o))).toMatchObject({ url: "http://api.test/api/calendars/preview", method: "GET" });
  });

  it("does not mistake the preview for a calendar id", async () => {
    const { url } = await call((o) => api.getCalendarPreview(o));
    expect(url).not.toMatch(/calendars\/\d/);
  });

  it("waits longer than usual for the calls that fetch calendars from outside", async () => {
    vi.useFakeTimers();
    for (const start of [
      (o: api.CallOptions) => api.addCalendar({ link: "https://x.test/a.ics" }, o),
      (o: api.CallOptions) => api.updateCalendar(1, { link: "https://x.test/a.ics" }, o),
      (o: api.CallOptions) => api.getCalendarPreview(o),
    ]) {
      let aborted = false;
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
      const pending = start({ baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
      await vi.advanceTimersByTimeAsync(api.REQUEST_TIMEOUT_MS + 5000);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(api.CALENDAR_REQUEST_TIMEOUT_MS);
      expect(aborted).toBe(true);
      await expect(pending).resolves.toEqual({ ok: false, kind: "offline" });
    }
    expect(api.CALENDAR_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
  });

  it("keeps the normal timeout for listing and removing", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const pending = api.listCalendars({ baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    await vi.advanceTimersByTimeAsync(api.REQUEST_TIMEOUT_MS);
    expect(aborted).toBe(true);
    await pending;
  });

  it("returns the calendar list", async () => {
    const list = { state: "ready", calendars: [] };
    const result = await api.listCalendars({ baseUrl: "http://api.test", fetchImpl: asFetch(mockFetch(() => jsonResponse(list))) });
    expect(result).toEqual({ ok: true, data: list });
  });

  it("returns 204 for a removed calendar", async () => {
    const result = await api.deleteCalendar(1, { baseUrl: "http://api.test", fetchImpl: asFetch(mockFetch(() => new Response(null, { status: 204 }))) });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it.each([
    ["calendar_link_invalid", 400],
    ["calendar_link_blocked", 400],
    ["calendar_gone", 422],
    ["calendar_unreachable", 502],
    ["calendar_not_ics", 422],
    ["calendar_too_large", 422],
    ["calendar_limit", 409],
    ["calendars_unavailable", 503],
  ] as const)("understands the error code %s", async (code, status) => {
    const fetchImpl = mockFetch(() => jsonResponse({ statusCode: status, error: "x", code }, status));
    const result = await api.addCalendar({ link: "https://x.test/a.ics" }, { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: false, kind: "error", status, code });
  });

  it("keeps the field of a link problem", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ statusCode: 400, error: "x", code: "validation", field: "link" }, 400));
    const result = await api.addCalendar({ link: "" }, { baseUrl: "http://api.test", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ ok: false, kind: "error", status: 400, code: "validation", field: "link" });
  });
});
