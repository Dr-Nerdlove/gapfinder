import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";

describe("formatDate", () => {
  it("formats in German style", () => {
    expect(formatDate("2026-11-15T12:00:00.000Z")).toBe("15.11.2026");
  });

  it("uses German time for the day change", () => {
    // 23:30 UTC in winter is already the next day in Berlin (UTC+1).
    expect(formatDate("2026-11-15T23:30:00.000Z")).toBe("16.11.2026");
    // 22:30 UTC in summer is already the next day in Berlin (UTC+2).
    expect(formatDate("2026-07-15T22:30:00.000Z")).toBe("16.07.2026");
  });

  it("gives an empty text for a broken date", () => {
    expect(formatDate("kaputt")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("formats date and time in German time", () => {
    expect(formatDateTime("2026-11-15T17:30:00.000Z")).toBe("15.11.2026, 18:30");
    expect(formatDateTime("2026-07-15T22:30:00.000Z")).toBe("16.07.2026, 00:30");
  });

  it("gives an empty text for a broken date", () => {
    expect(formatDateTime("kaputt")).toBe("");
  });
});
