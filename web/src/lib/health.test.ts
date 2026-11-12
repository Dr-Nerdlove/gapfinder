import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth, hasFeature, parseFeatures, serverFreshness } from "./health";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("checkHealth", () => {
  it("reports the server as online with its version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "ok", version: "sha-abc1234", time: "2026-10-31T10:00:00Z" }));
    const result = await checkHealth("http://api.test/", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ kind: "online", version: "sha-abc1234", features: [] });
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/health", expect.anything());
  });

  it("reports an HTTP error as offline", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 502));
    const result = await checkHealth("http://api.test", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ kind: "offline", reason: "http" });
  });

  it("reports an unexpected answer as offline", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ hello: "world" }));
    const result = await checkHealth("http://api.test", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ kind: "offline", reason: "invalid" });
  });

  it("reports a network error as offline", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await checkHealth("http://api.test", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ kind: "offline", reason: "network" });
  });

  it("gives up after the timeout and aborts the request", async () => {
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
    const pending = checkHealth("http://api.test", { timeoutMs: 5000, fetchImpl: fetchImpl as unknown as typeof fetch });

    await vi.advanceTimersByTimeAsync(4999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    await expect(pending).resolves.toEqual({ kind: "offline", reason: "timeout" });
  });
});

describe("serverFreshness", () => {
  it("is current when server and app come from the same commit", () => {
    expect(serverFreshness("sha-abc1234", "sha-abc1234")).toBe("current");
  });

  it("is updating when the commits differ", () => {
    expect(serverFreshness("sha-abc1234", "sha-def5678")).toBe("updating");
    expect(serverFreshness("sha-def5678", "sha-abc1234")).toBe("updating");
  });

  it("is unknown without a commit on either side", () => {
    expect(serverFreshness("dev", "sha-abc1234")).toBe("unknown");
    expect(serverFreshness("sha-abc1234", "dev")).toBe("unknown");
    expect(serverFreshness("", "")).toBe("unknown");
  });
});

describe("server features", () => {
  const ask = async (body: unknown) =>
    checkHealth("http://api.test", { fetchImpl: (vi.fn(async () => jsonResponse(body))) as unknown as typeof fetch });

  it("reads the listed features", async () => {
    const result = await ask({ status: "ok", version: "v", time: "t", features: ["hidden_votes"] });
    expect(result).toEqual({ kind: "online", version: "v", features: ["hidden_votes"] });
  });

  it("treats a missing or malformed list as none", async () => {
    expect(parseFeatures(undefined)).toEqual([]);
    expect(parseFeatures("hidden_votes")).toEqual([]);
    expect(parseFeatures({ 0: "hidden_votes" })).toEqual([]);
    expect(parseFeatures(["hidden_votes", 3, null])).toEqual(["hidden_votes"]);
    const result = await ask({ status: "ok", version: "v", time: "t" });
    expect(result.kind === "online" && result.features).toEqual([]);
  });

  it("offers a feature only when it is listed", () => {
    expect(hasFeature(["hidden_votes"], "hidden_votes")).toBe(true);
    expect(hasFeature([], "hidden_votes")).toBe(false);
  });
});
