import type { Slot } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import type { PollPick } from "./gap-search";
import {
  MAX_PICKS,
  berlinParts,
  berlinWallToInstant,
  buildCreateRequest,
  deadlineOf,
  draftFromSource,
  endOptions,
  instantLabel,
  pollSource,
  quarterInstants,
  selectionLabel,
  startOptions,
  suggestedEnd,
  togglePick,
  withStart,
  type DraftItem,
  type PollDraft,
  type PollSource,
} from "./poll-draft";

const NOW = new Date("2026-11-02T10:00:00.000Z"); // Mon 2 Nov 2026, 11:00 in Berlin
const TODAY = "2026-11-02";
const gap: Slot = { start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T22:00:00.000Z" }; // 14:00–23:00 Berlin

const timedPick = (slot: Slot, id = `timed:${slot.start}`): PollPick => ({ id, kind: "timed", label: "x", slot });
const daysPick = (first: string, last: string, starts: string[] = [], id = `days:${first}`): PollPick => ({
  id,
  kind: "days",
  label: "x",
  first,
  last,
  days: 1,
  starts,
});
const source = (picks: PollPick[], extra: Partial<PollSource> = {}): PollSource => ({
  picks,
  durationMinutes: 180,
  periodDays: 3,
  participants: [2, 3],
  summary: "",
  ...extra,
});

describe("berlinWallToInstant", () => {
  it("handles winter and summer time", () => {
    expect(berlinWallToInstant("2026-12-02", "20:00")?.toISOString()).toBe("2026-12-02T19:00:00.000Z");
    expect(berlinWallToInstant("2026-07-01", "12:00")?.toISOString()).toBe("2026-07-01T10:00:00.000Z");
  });

  it("takes the earlier time when it happens twice in autumn", () => {
    // 25 Oct 2026: 03:00 CEST goes back to 02:00 CET, so 02:30 exists twice.
    expect(berlinWallToInstant("2026-10-25", "02:30")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("moves a time that does not exist in spring one hour on", () => {
    // 29 Mar 2026: 02:00 CET jumps to 03:00 CEST, so 02:30 does not exist.
    expect(berlinWallToInstant("2026-03-29", "02:30")?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(berlinWallToInstant("2026-03-29", "03:30")?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("rejects text that is no date or time", () => {
    expect(berlinWallToInstant("", "20:00")).toBeNull();
    expect(berlinWallToInstant("2026-02-31", "20:00")).toBeNull();
    expect(berlinWallToInstant("2026-12-02", "25:00")).toBeNull();
    expect(berlinWallToInstant("2026-12-02", "8:00")).toBeNull();
  });

  it("is the reverse of berlinParts", () => {
    expect(berlinParts("2026-12-02T19:00:00.000Z")).toEqual({ date: "2026-12-02", time: "20:00" });
    expect(berlinParts("2026-07-01T22:30:00.000Z")).toEqual({ date: "2026-07-02", time: "00:30" });
  });
});

describe("choosing free times", () => {
  const a = timedPick(gap, "a");
  const b = timedPick(gap, "b");

  it("chooses and drops a free time", () => {
    expect(togglePick([], a)).toEqual([a]);
    expect(togglePick([a], b)).toEqual([a, b]);
    expect(togglePick([a, b], a)).toEqual([b]);
  });

  it("does not take more than a poll can hold", () => {
    const full = Array.from({ length: MAX_PICKS }, (_, i) => timedPick(gap, `p${i}`));
    expect(togglePick(full, b)).toHaveLength(MAX_PICKS);
    expect(togglePick(full, full[0]!)).toHaveLength(MAX_PICKS - 1);
  });

  it("counts in German", () => {
    expect(selectionLabel(1)).toBe("1 Termin gewählt");
    expect(selectionLabel(2)).toBe("2 Termine gewählt");
  });

  it("hands the choice over to the next page", () => {
    pollSource.clear();
    expect(pollSource.get()).toBeNull();
    const s = source([a]);
    pollSource.set(s);
    expect(pollSource.get()).toBe(s);
    pollSource.clear();
    expect(pollSource.get()).toBeNull();
  });
});

describe("times inside a gap", () => {
  it("lists every quarter hour, the end included", () => {
    const options = quarterInstants({ start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T14:00:00.000Z" });
    expect(options).toEqual([
      "2026-12-12T13:00:00.000Z",
      "2026-12-12T13:15:00.000Z",
      "2026-12-12T13:30:00.000Z",
      "2026-12-12T13:45:00.000Z",
      "2026-12-12T14:00:00.000Z",
    ]);
  });

  it("starts at the first quarter after a gap that begins in between", () => {
    expect(quarterInstants({ start: "2026-12-12T13:07:00.000Z", end: "2026-12-12T13:40:00.000Z" })).toEqual([
      "2026-12-12T13:15:00.000Z",
      "2026-12-12T13:30:00.000Z",
    ]);
  });

  it("cannot start at the very end of the gap", () => {
    const starts = startOptions(gap);
    expect(starts[0]).toBe("2026-12-12T13:00:00.000Z");
    expect(starts[starts.length - 1]).toBe("2026-12-12T21:45:00.000Z");
  });

  it("ends after the start and at most 24 hours later", () => {
    const long: Slot = { start: "2026-12-12T00:00:00.000Z", end: "2026-12-14T00:00:00.000Z" };
    const ends = endOptions(long, "2026-12-12T00:00:00.000Z");
    expect(ends[0]).toBe("2026-12-12T00:15:00.000Z");
    expect(ends[ends.length - 1]).toBe("2026-12-13T00:00:00.000Z");
  });

  it("suggests the searched duration and shortens it for a short gap", () => {
    expect(suggestedEnd(gap, "2026-12-12T13:00:00.000Z", 180)).toBe("2026-12-12T16:00:00.000Z");
    expect(suggestedEnd(gap, "2026-12-12T20:00:00.000Z", 180)).toBe("2026-12-12T22:00:00.000Z");
  });

  it("keeps the length when the start moves", () => {
    const item: Extract<DraftItem, { kind: "timed" }> = {
      kind: "timed",
      id: "a",
      label: "x",
      gap,
      start: "2026-12-12T13:00:00.000Z",
      end: "2026-12-12T15:00:00.000Z",
    };
    const moved = withStart(item, "2026-12-12T16:00:00.000Z");
    expect(moved.kind === "timed" && moved.end).toBe("2026-12-12T18:00:00.000Z");
    const late = withStart(item, "2026-12-12T21:00:00.000Z");
    expect(late.kind === "timed" && late.end).toBe("2026-12-12T22:00:00.000Z");
  });

  it("names the day when a time is not on the day the gap starts", () => {
    const night: Slot = { start: "2026-12-12T19:00:00.000Z", end: "2026-12-13T01:00:00.000Z" };
    expect(instantLabel("2026-12-12T21:00:00.000Z", night.start)).toBe("22:00");
    expect(instantLabel("2026-12-13T00:00:00.000Z", night.start)).toBe("01:00 (So 13.12.)");
  });
});

describe("draftFromSource", () => {
  it("suggests the searched duration from the start of each gap", () => {
    const items = draftFromSource(source([timedPick(gap)]), TODAY);
    expect(items).toEqual([{ kind: "timed", id: `timed:${gap.start}`, label: "x", gap, start: gap.start, end: "2026-12-12T16:00:00.000Z" }]);
  });

  it("keeps a proposal at the same time only once", () => {
    const items = draftFromSource(source([timedPick(gap, "a"), timedPick(gap, "b")]), TODAY);
    expect(items).toHaveLength(1);
  });

  it("starts a run of days on the first possible start, as long as was searched", () => {
    const [item] = draftFromSource(source([daysPick("2026-12-01", "2026-12-20", ["2026-12-05", "2026-12-12"])]), TODAY);
    expect(item).toMatchObject({ kind: "days", first: "2026-12-05", last: "2026-12-07", gapFirst: "2026-12-01", gapLast: "2026-12-20" });
  });

  it("starts at the first day without a starting weekday and stays inside the stretch", () => {
    expect(draftFromSource(source([daysPick("2026-12-01", "2026-12-02")]), TODAY)[0]).toMatchObject({ first: "2026-12-01", last: "2026-12-02" });
  });

  it("never starts before tomorrow", () => {
    expect(draftFromSource(source([daysPick("2026-11-02", "2026-11-10")]), TODAY)[0]).toMatchObject({ first: "2026-11-03", last: "2026-11-05" });
  });
});

describe("deadlineOf", () => {
  it("means no deadline when both fields are empty", () => {
    expect(deadlineOf("", "", NOW)).toEqual({ ok: true, value: null });
  });

  it("turns German date and time into an instant", () => {
    expect(deadlineOf("2026-12-02", "20:00", NOW)).toEqual({ ok: true, value: "2026-12-02T19:00:00.000Z" });
  });

  it("needs both date and time", () => {
    expect(deadlineOf("2026-12-02", "", NOW)).toEqual({ ok: false, problem: "deadline_incomplete" });
    expect(deadlineOf("", "20:00", NOW)).toEqual({ ok: false, problem: "deadline_incomplete" });
  });

  it("must lie in the future and within a year", () => {
    expect(deadlineOf("2026-11-02", "10:00", NOW)).toEqual({ ok: false, problem: "deadline_past" });
    expect(deadlineOf("2027-11-03", "12:00", NOW)).toEqual({ ok: false, problem: "deadline_far" });
    expect(deadlineOf("2027-11-01", "12:00", NOW).ok).toBe(true);
  });
});

describe("buildCreateRequest", () => {
  const timedItem: DraftItem = { kind: "timed", id: "a", label: "x", gap, start: gap.start, end: "2026-12-12T16:00:00.000Z" };
  const draft = (extra: Partial<PollDraft> = {}): PollDraft => ({
    title: "  Spieleabend ",
    note: "",
    deadlineDate: "",
    deadlineTime: "",
    items: [timedItem],
    participants: [2, 3],
    ...extra,
  });

  it("builds a timed poll with the trimmed title", () => {
    expect(buildCreateRequest(draft({ note: " bei mir " }), NOW)).toEqual({
      ok: true,
      request: {
        title: "Spieleabend",
        note: "bei mir",
        participants: [2, 3],
        deadline: null,
        kind: "timed",
        proposals: [{ start: gap.start, end: "2026-12-12T16:00:00.000Z" }],
      },
    });
  });

  it("builds a poll of whole days", () => {
    const days: DraftItem = { kind: "days", id: "d", label: "x", gapFirst: "2026-12-01", gapLast: "2026-12-20", first: "2026-12-05", last: "2026-12-07" };
    const check = buildCreateRequest(draft({ items: [days], deadlineDate: "2026-12-02", deadlineTime: "20:00" }), NOW);
    expect(check).toMatchObject({
      ok: true,
      request: { kind: "days", proposals: [{ first: "2026-12-05", last: "2026-12-07" }], deadline: "2026-12-02T19:00:00.000Z" },
    });
  });

  it.each([
    [{ title: "   " }, "title_empty"],
    [{ title: "x".repeat(81) }, "title_long"],
    [{ note: "x".repeat(501) }, "note_long"],
    [{ items: [] }, "no_items"],
    [{ deadlineDate: "2026-12-02" }, "deadline_incomplete"],
    [{ deadlineDate: "2026-11-01", deadlineTime: "10:00" }, "deadline_past"],
  ] as [Partial<PollDraft>, string][])("names the first problem %#", (extra, problem) => {
    expect(buildCreateRequest(draft(extra), NOW)).toMatchObject({ ok: false, problem });
  });

  it("counts a title by characters, not by bytes", () => {
    expect(buildCreateRequest(draft({ title: "ä".repeat(80) }), NOW).ok).toBe(true);
  });

  it("names the proposal that is wrong", () => {
    const check = (item: DraftItem) => buildCreateRequest(draft({ items: [item] }), NOW);
    expect(check({ ...timedItem, end: timedItem.kind === "timed" ? timedItem.start : "" })).toEqual({ ok: false, problem: "item_order", itemId: "a" });
    const huge: Slot = { start: "2026-12-12T00:00:00.000Z", end: "2026-12-15T00:00:00.000Z" };
    expect(check({ ...timedItem, gap: huge, start: huge.start, end: huge.end })).toEqual({ ok: false, problem: "item_long", itemId: "a" });
    expect(check({ ...timedItem, gap: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-02T09:00:00.000Z" }, start: "2026-11-01T10:00:00.000Z", end: "2026-11-01T12:00:00.000Z" })).toEqual({
      ok: false,
      problem: "item_past",
      itemId: "a",
    });
    expect(check({ ...timedItem, end: "2026-12-12T23:00:00.000Z" })).toEqual({ ok: false, problem: "item_outside", itemId: "a" });
  });

  it("checks runs of days", () => {
    const days = (first: string, last: string): DraftItem => ({ kind: "days", id: "d", label: "x", gapFirst: "2026-12-01", gapLast: "2027-02-28", first, last });
    const check = (item: DraftItem) => buildCreateRequest(draft({ items: [item] }), NOW);
    expect(check(days("2026-12-07", "2026-12-05"))).toMatchObject({ problem: "item_order" });
    expect(check(days("2026-11-02", "2026-12-05"))).toMatchObject({ problem: "item_past" });
    expect(check(days("2026-11-30", "2026-12-05"))).toMatchObject({ problem: "item_outside" });
    expect(check(days("2026-12-01", "2027-01-01"))).toMatchObject({ problem: "item_long" });
    expect(check(days("2026-12-01", "2026-12-31")).ok).toBe(true);
  });

  it("refuses two equal proposals and too many", () => {
    expect(buildCreateRequest(draft({ items: [timedItem, { ...timedItem, id: "b" }] }), NOW)).toMatchObject({ problem: "item_duplicate", itemId: "b" });
    const many = Array.from({ length: 21 }, (_, i) => ({ ...timedItem, id: String(i) }));
    expect(buildCreateRequest(draft({ items: many }), NOW)).toMatchObject({ problem: "too_many" });
  });
});
