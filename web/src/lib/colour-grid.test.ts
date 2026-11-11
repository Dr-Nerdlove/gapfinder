import type { SearchResult } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { cellText, dayCounts, dayStrip, monthGrid, rowsOfDay, searchMonths, shadeOf } from "./colour-grid";
import type { Row } from "./gap-search";

const slot = (start: string, end: string) => ({ start, end });
// December 2026 is winter time: Berlin = UTC + 1.
const hoursResult: SearchResult = {
  mode: "hours",
  skipped: [],
  days: [{ date: "2026-12-12", slots: [slot("2026-12-12T17:00:00.000Z", "2026-12-12T20:00:00.000Z")] }],
  nearMisses: [],
  partial: [
    { date: "2026-12-12", missingPersonIds: [3], slots: [slot("2026-12-12T09:00:00.000Z", "2026-12-12T12:00:00.000Z")] },
    { date: "2026-12-13", missingPersonIds: [2, 3], slots: [slot("2026-12-13T09:00:00.000Z", "2026-12-13T12:00:00.000Z")] },
  ],
};

describe("shadeOf", () => {
  it("steps from all down to fewer", () => {
    expect([12, 11, 10, 9, 8, 7, 2].map((n) => shadeOf(n, 12))).toEqual([4, 3, 2, 1, 1, 0, 0]);
  });
});

describe("dayCounts", () => {
  it("takes the best count of a day", () => {
    const c = dayCounts(hoursResult, 5);
    expect(c.get("2026-12-12")).toBe(5);
    expect(c.get("2026-12-13")).toBe(3);
    expect(c.has("2026-12-14")).toBe(false);
  });

  it("spreads a stretch over its days", () => {
    const c = dayCounts({ mode: "days", skipped: [], stretches: [{ first: "2026-12-01", last: "2026-12-03", days: 3 }], nearMisses: [], partial: [{ first: "2026-12-03", last: "2026-12-05", days: 3, missingPersonIds: [1] }] }, 4);
    expect([1, 2, 3, 4, 5].map((d) => c.get(`2026-12-0${d}`))).toEqual([4, 4, 4, 3, 3]);
  });
});

describe("monthGrid", () => {
  const searched = { from: "2026-12-10", to: "2026-12-20", weekdays: [1, 2, 3, 4, 5, 6, 7] };
  const weeks = monthGrid("2026-12", searched, dayCounts(hoursResult, 5), 5);

  it("starts on Monday and fills the last week", () => {
    expect(weeks[0]!.slice(0, 2)).toEqual([null, { date: "2026-12-01", day: 1, searched: false, count: null, shade: 0 }]); // 1 Dec 2026 is a Tuesday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((c) => c !== null)).toHaveLength(31);
  });

  it("marks days outside the search and colours the others", () => {
    const cells = weeks.flat().filter((c) => c !== null);
    expect(cells.find((c) => c.date === "2026-12-05")!.searched).toBe(false);
    expect(cells.find((c) => c.date === "2026-12-12")).toMatchObject({ searched: true, count: 5, shade: 4 });
    expect(cells.find((c) => c.date === "2026-12-13")).toMatchObject({ count: 3, shade: 2 });
    expect(cells.find((c) => c.date === "2026-12-15")).toMatchObject({ searched: true, count: null, shade: 0 });
  });

  it("leaves out weekdays that were not searched", () => {
    const sat = monthGrid("2026-12", { ...searched, weekdays: [6] }, new Map(), 5).flat().filter((c) => c?.searched);
    expect(sat.map((c) => c!.date)).toEqual(["2026-12-12", "2026-12-19"]);
  });
});

describe("searchMonths", () => {
  it("lists every month of the range", () => {
    expect(searchMonths({ from: "2026-11-20", to: "2027-01-05" })).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("cellText", () => {
  it("says alle, a number or nothing", () => {
    expect([cellText(5, 5), cellText(3, 5), cellText(null, 5)]).toEqual(["alle", "3", ""]);
  });
});

describe("dayStrip", () => {
  const strip = dayStrip(hoursResult, "2026-12-12", 5, { start: "09:00", end: "23:00" });

  it("covers the window and one hour either side", () => {
    expect(strip[0]!.hour).toBe(8);
    expect(strip.at(-1)!.hour).toBe(23);
    expect(strip.find((h) => h.hour === 8)!.inWindow).toBe(false);
    expect(strip.find((h) => h.hour === 9)!.inWindow).toBe(true);
  });

  it("colours the hours by the best count", () => {
    const at = (h: number) => strip.find((c) => c.hour === h)!;
    expect(at(10)).toMatchObject({ count: 4, shade: 3 }); // 10:00–13:00 Berlin: one missing
    expect(at(18)).toMatchObject({ count: 5, shade: 4 }); // 18:00–21:00 Berlin: all
    expect(at(15)).toMatchObject({ count: null, shade: 0 });
  });

  it("is empty in days mode", () => {
    expect(dayStrip({ mode: "days", skipped: [], stretches: [], nearMisses: [] }, "2026-12-12", 5)).toEqual([]);
  });
});

describe("rowsOfDay", () => {
  const timed = (key: string): Row => ({ key, heading: "", detail: "", picks: [{ id: key, kind: "timed", label: "", slot: slot("a", "b") }] });
  const stretch = (first: string, last: string): Row => ({ key: first, heading: "", detail: "", picks: [{ id: first, kind: "days", label: "", first, last, days: 3, starts: [] }] });

  it("finds the lines of an hours day, also with missing people in the key", () => {
    expect(rowsOfDay([timed("2026-12-12"), timed("2026-12-12:3"), timed("2026-12-13")], "2026-12-12")).toHaveLength(2);
  });

  it("finds the stretches that cover a day", () => {
    expect(rowsOfDay([stretch("2026-12-01", "2026-12-03"), stretch("2026-12-05", "2026-12-06")], "2026-12-02")).toHaveLength(1);
  });
});
