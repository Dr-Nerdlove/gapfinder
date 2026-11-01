import { describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { createSession, type SessionState } from "./session-core";
import { loadSeed, loadSession, saveSession } from "./session-storage";
import { brokenStorage, MemoryStorage } from "./test-storage";

const anna = { id: 2, username: "Anna K.", isAdmin: false, seedColor: "#2e7d32" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, stored = true) {
  const storage = new MemoryStorage();
  if (stored) saveSession({ token: "old-token", user: anna }, storage);
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  const changes: SessionState[] = [];
  const users: unknown[] = [];
  const session = createSession({
    storage,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    baseUrl: "http://api.test",
    onChange: (s) => changes.push(s),
    onUser: (u) => users.push(u),
  });
  return { storage, fetchImpl, session, changes, users };
}

describe("session", () => {
  it("shows the cached user straight away", () => {
    const { session } = setup(() => jsonResponse({}));
    expect(session.state).toEqual({ token: "old-token", user: anna, offline: false });
  });

  it("starts logged out without a saved login and asks the server nothing", async () => {
    const { session, fetchImpl } = setup(() => jsonResponse({}), false);
    await session.start();
    expect(session.state.user).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes the cached user from the server on start, with the token", async () => {
    const fresh = { ...anna, username: "Anna Karenina", seedColor: null };
    const { session, storage, fetchImpl } = setup(() => jsonResponse(fresh));
    await session.start();
    expect(session.state.user).toEqual(fresh);
    expect(loadSession(storage)?.user).toEqual(fresh);
    const init = fetchImpl.mock.calls[0]![1];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer old-token");
  });

  it("keeps the cached user when the server is offline", async () => {
    const { session, storage } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    await session.start();
    expect(session.state).toEqual({ token: "old-token", user: anna, offline: true });
    expect(loadSession(storage)?.token).toBe("old-token");
  });

  it("clears the login when the server answers 401", async () => {
    const { session, storage, users } = setup(() => jsonResponse({ code: "unauthorized" }, 401));
    await session.start();
    expect(session.state.token).toBeNull();
    expect(session.state.user).toBeNull();
    expect(loadSession(storage)).toBeNull();
    expect(loadSeed(storage)).toBeNull();
    expect(users.at(-1)).toBeNull();
  });

  it("clears the login when any later call gets a 401", async () => {
    const { session, storage } = setup(() => jsonResponse({ statusCode: 401, error: "Unauthorized", code: "unauthorized" }, 401));
    const result = await session.run((o) => api.getMe(o));
    expect(result.ok).toBe(false);
    expect(session.state.user).toBeNull();
    expect(loadSession(storage)).toBeNull();
  });

  it("keeps the login on other errors", async () => {
    const { session } = setup(() => jsonResponse({ code: "forbidden" }, 403));
    await session.start();
    expect(session.state.user).toEqual(anna);
  });

  it("keeps the login when the current password is wrong", async () => {
    const { session } = setup(() => jsonResponse({ code: "wrong_password" }, 401));
    await session.updateMe({ username: "X" });
    expect(session.state.user).toEqual(anna);
  });

  it("logs in: saves token and user, applies the user", async () => {
    const { session, storage, users, fetchImpl } = setup(() => jsonResponse({ token: "new-token", user: anna }), false);
    const result = await session.login("Anna K.", "geheim123");
    expect(result.ok).toBe(true);
    expect(session.state).toEqual({ token: "new-token", user: anna, offline: false });
    expect(loadSession(storage)).toEqual({ token: "new-token", user: anna });
    expect(loadSeed(storage)).toBe("#2e7d32");
    expect(users.at(-1)).toEqual(anna);
    expect(fetchImpl.mock.calls[0]![1].body).toBe('{"username":"Anna K.","password":"geheim123"}');
  });

  it("does not send the old token when logging in", async () => {
    const { session, fetchImpl } = setup(() => jsonResponse({ token: "n", user: anna }));
    await session.login("Anna K.", "geheim123");
    expect(fetchImpl.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");
  });

  it("stays logged out after wrong login data", async () => {
    const { session } = setup(() => jsonResponse({ code: "invalid_credentials" }, 401), false);
    const result = await session.login("Anna K.", "falsch");
    expect(result).toMatchObject({ ok: false, kind: "error", code: "invalid_credentials" });
    expect(session.state.user).toBeNull();
  });

  it("accepts an invite and a password reset as a new login", async () => {
    const { session } = setup(() => jsonResponse({ token: "t2", user: anna }, 201), false);
    expect((await session.acceptInvite("inv", "Anna K.", "geheim123")).ok).toBe(true);
    expect(session.state.token).toBe("t2");
    const second = setup(() => jsonResponse({ token: "t3", user: anna }), false);
    expect((await second.session.completePasswordReset("res", "geheim123")).ok).toBe(true);
    expect(second.session.state.token).toBe("t3");
  });

  it("updates the user after a profile change", async () => {
    const changed = { ...anna, seedColor: null };
    const { session, storage, users } = setup(() => jsonResponse(changed));
    await session.updateMe({ seedColor: null });
    expect(session.state.user).toEqual(changed);
    expect(loadSession(storage)?.user).toEqual(changed);
    expect(loadSeed(storage)).toBeNull();
    expect(users.at(-1)).toEqual(changed);
  });

  it("logs out on this device even when the server is offline", async () => {
    const { session, storage } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    await session.logout();
    expect(session.state.token).toBeNull();
    expect(session.state.user).toBeNull();
    expect(loadSession(storage)).toBeNull();
  });

  it("tells the server about the logout", async () => {
    const { session, fetchImpl } = setup(() => new Response(null, { status: 204 }));
    await session.logout();
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api.test/api/auth/logout");
    expect(fetchImpl.mock.calls[0]![1].method).toBe("POST");
  });

  it("notes when the server is asleep and when it is back", async () => {
    let asleep = true;
    const { session } = setup(() => {
      if (asleep) throw new TypeError("Failed to fetch");
      return jsonResponse({ status: "ok", version: "x", time: "t" });
    });
    expect((await session.checkConnection())).toBe(false);
    expect(session.state.offline).toBe(true);
    asleep = false;
    expect(await session.checkConnection()).toBe(true);
    expect(session.state.offline).toBe(false);
  });

  it("works with a storage that throws", async () => {
    const session = createSession({
      storage: brokenStorage,
      fetchImpl: (async () => jsonResponse({ token: "t", user: anna })) as unknown as typeof fetch,
      baseUrl: "http://api.test",
    });
    expect(session.state.user).toBeNull();
    expect((await session.login("Anna K.", "geheim123")).ok).toBe(true);
    expect(session.state.user).toEqual(anna);
  });
});
