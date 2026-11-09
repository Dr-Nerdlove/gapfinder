import { describe, expect, it } from "vitest";
import { formatCalendarSize } from "./calendar-size";

const MB = 1024 * 1024;

describe("formatCalendarSize", () => {
  it("says 'unter 0,1 MB' for small calendars", () => {
    expect(formatCalendarSize(0)).toBe("unter 0,1 MB");
    expect(formatCalendarSize(50_000)).toBe("unter 0,1 MB");
  });

  it("uses one decimal with a comma under 100 MB", () => {
    expect(formatCalendarSize(0.1 * MB)).toBe("0,1 MB");
    expect(formatCalendarSize(5 * MB)).toBe("5,0 MB");
    expect(formatCalendarSize(6.2 * MB)).toBe("6,2 MB");
    expect(formatCalendarSize(99.94 * MB)).toBe("99,9 MB");
  });

  it("uses whole numbers from 100 MB", () => {
    expect(formatCalendarSize(99.96 * MB)).toBe("100 MB");
    expect(formatCalendarSize(100 * MB)).toBe("100 MB");
    expect(formatCalendarSize(311.6 * MB)).toBe("312 MB");
  });
});
