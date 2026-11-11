import type { PollView } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "./gap-search";
import { applyReplan, replanFromPoll, replanHandover } from "./replan";

const person = (id: number) => ({ id, username: `p${id}`, seedColor: null });

function poll(overrides: Partial<PollView>): PollView {
  return {
    title: "Spieleabend",
    note: "Bei Anna",
    kind: "timed",
    proposals: [{ id: 1, start: "2026-12-12T17:00:00.000Z", end: "2026-12-12T21:30:00.000Z" }],
    participants: [person(1), person(2), person(3)],
    ...overrides,
  } as PollView;
}

describe("replanFromPoll", () => {
  it("takes title, note and the other people, not the planner", () => {
    const r = replanFromPoll(poll({}), 2);
    expect(r).toMatchObject({ title: "Spieleabend", note: "Bei Anna", people: [1, 3], kind: "hours" });
  });

  it("rounds the length of the first proposal up to a full hour", () => {
    expect(replanFromPoll(poll({}), 1).durationMinutes).toBe(300); // 4.5 h → 5 h
  });

  it("caps the length at the longest search", () => {
    const long = poll({ proposals: [{ id: 1, start: "2026-12-12T00:00:00.000Z", end: "2026-12-13T00:00:00.000Z" }] });
    expect(replanFromPoll(long, 1).durationMinutes).toBe(24 * 60);
  });

  it("makes a days search with the length in days for a days poll", () => {
    const days = poll({ kind: "days", proposals: [{ id: 1, first: "2026-12-12", last: "2026-12-18" }] });
    expect(replanFromPoll(days, 1)).toMatchObject({ kind: "days", days: 7, durationMinutes: null });
  });
});

describe("applyReplan", () => {
  it("replaces people, kind and length, and leaves the rest alone", () => {
    const base = { ...defaultSettings("2026-11-11"), people: [9], weekdays: [1] as never };
    const next = applyReplan(base, replanFromPoll(poll({}), 1));
    expect(next.people).toEqual([2, 3]);
    expect(next.durationMinutes).toBe(300);
    expect(next.weekdays).toEqual([1]);
  });
});

describe("replanHandover", () => {
  it("is used once", () => {
    replanHandover.set(replanFromPoll(poll({}), 1));
    expect(replanHandover.take()?.title).toBe("Spieleabend");
    expect(replanHandover.take()).toBeNull();
  });
});
