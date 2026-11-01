import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/auth/rate-limit.js";
import { TestClock } from "./helpers.js";

const MINUTE = 60 * 1000;

describe("RateLimiter", () => {
  it("blocks only after the limit of failures and says how long to wait", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock.now);
    for (let i = 0; i < 2; i++) limiter.recordFailure("k");
    expect(limiter.blockedFor("k", 3)).toBeNull();
    limiter.recordFailure("k");
    expect(limiter.blockedFor("k", 3)).toBe(15 * 60);
    clock.advance(5 * MINUTE);
    expect(limiter.blockedFor("k", 3)).toBe(10 * 60);
  });

  it("frees up when the failures leave the window", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock.now);
    for (let i = 0; i < 3; i++) limiter.recordFailure("k");
    clock.advance(15 * MINUTE + 1);
    expect(limiter.blockedFor("k", 3)).toBeNull();
  });

  it("keeps keys apart and resets one key", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock.now);
    for (let i = 0; i < 3; i++) limiter.recordFailure("a");
    expect(limiter.blockedFor("b", 3)).toBeNull();
    limiter.reset("a");
    expect(limiter.blockedFor("a", 3)).toBeNull();
  });

  it("returns the longest wait over several checks", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock.now);
    limiter.recordFailure("a");
    clock.advance(10 * MINUTE);
    limiter.recordFailure("b");
    expect(
      limiter.blockedForAny([
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]),
    ).toBe(15 * 60);
    expect(limiter.blockedForAny([["c", 1]])).toBeNull();
  });
});
