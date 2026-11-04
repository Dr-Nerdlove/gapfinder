import { describe, expect, it } from "vitest";
import { MemoryStorage, brokenStorage } from "./test-storage";
import { TOUR_KEY, markTourSeen, tourSeen } from "./tour";

describe("tour seen on the device", () => {
  it("is not seen before it is marked, and seen afterwards", () => {
    const storage = new MemoryStorage();
    expect(tourSeen(1, storage)).toBe(false);
    markTourSeen(1, storage);
    expect(tourSeen(1, storage)).toBe(true);
  });

  it("does not count for another user", () => {
    const storage = new MemoryStorage();
    markTourSeen(1, storage);
    expect(tourSeen(2, storage)).toBe(false);
  });

  it("keeps several users and does not duplicate", () => {
    const storage = new MemoryStorage();
    markTourSeen(1, storage);
    markTourSeen(2, storage);
    markTourSeen(2, storage);
    expect(tourSeen(1, storage)).toBe(true);
    expect(tourSeen(2, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(TOUR_KEY) ?? "")).toEqual([1, 2]);
  });

  it.each(["not json", '{"a":1}', '"x"', '["a"]'])("treats garbage %j as seen", (raw) => {
    const storage = new MemoryStorage();
    storage.setItem(TOUR_KEY, raw);
    expect(tourSeen(1, storage)).toBe(true);
  });

  it("replaces garbage with a fresh list when marking", () => {
    const storage = new MemoryStorage();
    storage.setItem(TOUR_KEY, "not json");
    markTourSeen(3, storage);
    expect(JSON.parse(storage.getItem(TOUR_KEY) ?? "")).toEqual([3]);
  });

  it("counts as seen and never throws without working storage", () => {
    expect(tourSeen(1, brokenStorage)).toBe(true);
    expect(tourSeen(1, null)).toBe(true);
    expect(() => markTourSeen(1, brokenStorage)).not.toThrow();
    expect(() => markTourSeen(1, null)).not.toThrow();
  });
});
