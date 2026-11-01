import { describe, expect, it } from "vitest";
import { CALENDAR_CACHE_MS, CalendarCache, type CalendarRead } from "../src/calendars/cache.js";
import type { ParsedCalendar } from "../src/calendars/ics.js";
import { TestClock } from "./helpers.js";

const parsed = (name: string): ParsedCalendar => ({ name, events: [], truncated: false });
const good = (name: string): CalendarRead => ({ ok: true, calendar: parsed(name) });
const bad: CalendarRead = { ok: false, problem: "unreachable" };

function setup() {
  const clock = new TestClock();
  const cache = new CalendarCache(clock.now);
  let loads = 0;
  const loader = (result: CalendarRead) => async () => {
    loads++;
    return result;
  };
  return { clock, cache, loader, loads: () => loads };
}

describe("CalendarCache", () => {
  it("serves a fresh entry from memory and loads again after 15 minutes", async () => {
    const { clock, cache, loader, loads } = setup();
    await cache.read(1, "link-a", loader(good("one")));
    await cache.read(1, "link-a", loader(good("one")));
    expect(loads()).toBe(1);
    clock.advance(CALENDAR_CACHE_MS - 1);
    await cache.read(1, "link-a", loader(good("one")));
    expect(loads()).toBe(1);
    clock.advance(1);
    await cache.read(1, "link-a", loader(good("one")));
    expect(loads()).toBe(2);
  });

  it("never serves the contents of one link for another link of the same calendar", async () => {
    const { cache, loader, loads } = setup();
    expect(await cache.read(1, "link-a", loader(good("old")))).toEqual(good("old"));
    expect(await cache.read(1, "link-b", loader(good("new")))).toEqual(good("new"));
    expect(loads()).toBe(2);
  });

  it("keeps calendars apart", async () => {
    const { cache, loader, loads } = setup();
    await cache.read(1, "same", loader(good("one")));
    expect(await cache.read(2, "same", loader(good("two")))).toEqual(good("two"));
    expect(loads()).toBe(2);
  });

  it("does not keep failures", async () => {
    const { cache, loader, loads } = setup();
    expect(await cache.read(1, "a", loader(bad))).toEqual(bad);
    expect(cache.size()).toBe(0);
    expect(await cache.read(1, "a", loader(good("ok")))).toEqual(good("ok"));
    expect(loads()).toBe(2);
  });

  it("lets concurrent reads share one load, also a failing one, and does not keep the failure", async () => {
    const { cache, loader, loads } = setup();
    let count = 0;
    let release!: (result: CalendarRead) => void;
    const slow = () => {
      count++;
      return new Promise<CalendarRead>((resolve) => {
        release = resolve;
      });
    };
    const first = cache.read(1, "a", slow);
    const second = cache.read(1, "a", slow);
    release(bad);
    expect(await first).toEqual(bad);
    expect(await second).toEqual(bad);
    expect(count).toBe(1);
    // The failure was not kept: the next read loads again.
    expect(await cache.read(1, "a", loader(good("x")))).toEqual(good("x"));
    expect(loads()).toBe(1);
  });

  it("treats a loader that fails as unreachable and keeps nothing", async () => {
    const { cache } = setup();
    expect(
      await cache.read(1, "a", () => {
        throw new Error("boom");
      }),
    ).toEqual(bad);
    expect(await cache.read(2, "a", () => Promise.reject(new Error("boom")))).toEqual(bad);
    expect(cache.size()).toBe(0);
  });

  it("forgets a calendar on drop, and a load under way does not bring it back", async () => {
    const { cache, loader, loads } = setup();
    await cache.read(1, "a", loader(good("one")));
    await cache.read(1, "b", loader(good("two")));
    cache.drop(1);
    expect(cache.size()).toBe(0);

    let release!: (result: CalendarRead) => void;
    const pending = cache.read(
      3,
      "a",
      () =>
        new Promise<CalendarRead>((resolve) => {
          release = resolve;
        }),
    );
    cache.drop(3);
    release(good("late"));
    await pending;
    expect(cache.size()).toBe(0);
    await cache.read(3, "a", loader(good("fresh")));
    expect(loads()).toBe(3);
  });

  it("removes expired entries", async () => {
    const { clock, cache, loader } = setup();
    await cache.read(1, "a", loader(good("one")));
    expect(cache.size()).toBe(1);
    clock.advanceMinutes(16);
    expect(cache.size()).toBe(0);
  });
});
