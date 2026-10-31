import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

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
    expect(result).toEqual({ kind: "online", version: "sha-abc1234" });
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
