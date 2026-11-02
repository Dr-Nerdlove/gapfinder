import { describe, expect, it } from "vitest";
import { isServerNight } from "./server-night";

const at = (h: number, m = 0): Date => new Date(2026, 10, 3, h, m);

describe("isServerNight", () => {
  it("knows the night of the sleeping server", () => {
    expect(isServerNight(at(0, 59))).toBe(false);
    expect(isServerNight(at(1))).toBe(true);
    expect(isServerNight(at(6, 59))).toBe(true);
    expect(isServerNight(at(7))).toBe(false);
  });
});
