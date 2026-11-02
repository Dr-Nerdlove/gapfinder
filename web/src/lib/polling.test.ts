import { afterEach, describe, expect, it, vi } from "vitest";
import { POLL_REFRESH_MS, startPolling } from "./polling";

afterEach(() => vi.useRealTimers());

describe("startPolling", () => {
  it("asks again every 30 seconds, not at once", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const stop = startPolling(refresh, { isHidden: () => false });
    expect(POLL_REFRESH_MS).toBe(30_000);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops for good", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    const stop = startPolling(refresh, { isHidden: () => false });
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not stack calls while an answer is slow", async () => {
    vi.useFakeTimers();
    let running = 0;
    let most = 0;
    const refresh = async (): Promise<void> => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 100_000));
      running--;
    };
    const stop = startPolling(refresh, { isHidden: () => false });
    await vi.advanceTimersByTimeAsync(400_000);
    expect(most).toBe(1);
    stop();
  });

  it("skips a hidden page and goes on later", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {});
    let hidden = true;
    const stop = startPolling(refresh, { isHidden: () => hidden });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("goes on after a refresh that throws", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => {
      throw new Error("boom");
    });
    const stop = startPolling(refresh, { isHidden: () => false });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });
});
