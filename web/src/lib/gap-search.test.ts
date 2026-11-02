import type { Person, SearchResult } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import {
  SEARCH_SETTINGS_KEY,
  berlinToday,
  buildRequest,
  defaultSettings,
  durationLabel,
  formatDay,
  formatSlot,
  formatStretch,
  keepKnownPeople,
  loadSettings,
  monthOptions,
  rangeDates,
  readablePeople,
  requestSummary,
  resultView,
  sanitizeSettings,
  saveSettings,
  skippedNotices,
  weekdayOf,
  weekdaysLabel,
  windowMinutes,
  type SearchSettings,
} from "./gap-search";
import { MemoryStorage, brokenStorage } from "./test-storage";

const TODAY = "2026-11-02"; // a Monday
const people: Person[] = [
  { id: 1, username: "Anna", seedColor: null },
  { id: 2, username: "Ben", seedColor: "#e57373" },
  { id: 3, username: "Clara", seedColor: null },
];

const settings = (change: Partial<SearchSettings> = {}): SearchSettings => ({ ...defaultSettings(TODAY), people: [2, 3], ...change });

describe("dates", () => {
  it("knows the German day, also shortly after midnight there", () => {
    expect(berlinToday(new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-03");
    expect(berlinToday(new Date("2026-07-02T21:59:00Z"))).toBe("2026-07-02");
    expect(berlinToday(new Date("2026-07-02T22:00:00Z"))).toBe("2026-07-03");
  });

  it("names weekdays and days", () => {
    expect(weekdayOf("2026-11-02")).toBe(1);
    expect(weekdayOf("2026-11-08")).toBe(7);
    expect(formatDay("2026-12-12")).toBe("Sa 12.12.");
    expect(formatDay("2027-01-03")).toBe("So 3.1.");
  });

  it("writes a stretch of days the short way", () => {
    expect(formatStretch("2026-08-03", "2026-08-16")).toBe("3.–16. Aug.");
    expect(formatStretch("2026-08-28", "2026-09-03")).toBe("28. Aug.–3. Sept.");
    expect(formatStretch("2026-08-05", "2026-08-05")).toBe("5. Aug.");
    expect(formatStretch("2026-12-30", "2027-01-02")).toBe("30. Dez. 2026–2. Jan. 2027");
  });

  it("writes slots in German time, also across the clock change", () => {
    expect(formatSlot({ start: "2026-12-12T17:00:00.000Z", end: "2026-12-12T22:00:00.000Z" })).toBe("18:00–23:00");
    expect(formatSlot({ start: "2026-07-11T16:00:00.000Z", end: "2026-07-11T21:00:00.000Z" })).toBe("18:00–23:00");
  });
});

describe("ranges", () => {
  it("counts the presets from today on", () => {
    expect(rangeDates({ range: "30", fromMonth: "", toMonth: "" }, TODAY)).toEqual({ from: "2026-11-02", to: "2026-12-01" });
    expect(rangeDates({ range: "90", fromMonth: "", toMonth: "" }, TODAY)).toEqual({ from: "2026-11-02", to: "2027-01-30" });
    expect(rangeDates({ range: "half", fromMonth: "", toMonth: "" }, TODAY)).toEqual({ from: "2026-11-02", to: "2027-05-02" });
    // The server allows an end 365 days ahead: 2027-11-02.
    expect(rangeDates({ range: "year", fromMonth: "", toMonth: "" }, TODAY)).toEqual({ from: "2026-11-02", to: "2027-11-01" });
  });

  it("covers whole months, but never the past", () => {
    expect(rangeDates({ range: "months", fromMonth: "2026-12", toMonth: "2027-02" }, TODAY)).toEqual({ from: "2026-12-01", to: "2027-02-28" });
    expect(rangeDates({ range: "months", fromMonth: "2026-11", toMonth: "2026-11" }, TODAY)).toEqual({ from: "2026-11-02", to: "2026-11-30" });
    expect(rangeDates({ range: "months", fromMonth: "2028-01", toMonth: "2028-02" }, TODAY)).toBeNull();
    expect(rangeDates({ range: "months", fromMonth: "2026-10", toMonth: "2026-10" }, TODAY)).toBeNull();
    expect(rangeDates({ range: "months", fromMonth: "2027-03", toMonth: "2027-02" }, TODAY)).toBeNull();
    expect(rangeDates({ range: "months", fromMonth: "kaputt", toMonth: "2027-02" }, TODAY)).toBeNull();
  });

  it("cuts a range off a year ahead and keeps leap days", () => {
    expect(rangeDates({ range: "months", fromMonth: "2027-10", toMonth: "2027-12" }, TODAY)).toEqual({ from: "2027-10-01", to: "2027-11-02" });
    expect(rangeDates({ range: "months", fromMonth: "2028-02", toMonth: "2028-02" }, "2028-01-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("offers this month and twelve more, across the new year", () => {
    const options = monthOptions(TODAY);
    expect(options).toHaveLength(13);
    expect(options[0]).toEqual({ value: "2026-11", label: "November 2026" });
    expect(options[2]).toEqual({ value: "2027-01", label: "Januar 2027" });
    expect(options[12]).toEqual({ value: "2027-11", label: "November 2027" });
  });
});

describe("buildRequest", () => {
  it("builds an hours search", () => {
    const built = buildRequest(settings({ weekdays: [6, 7], durationMinutes: 300, windowStart: "18:00", windowEnd: "23:00", bufferMinutes: 30 }), TODAY);
    expect(built).toEqual({
      ok: true,
      request: {
        mode: "hours",
        people: [2, 3],
        from: "2026-11-02",
        to: "2027-01-30",
        weekdays: [6, 7],
        durationMinutes: 300,
        window: { start: "18:00", end: "23:00" },
        bufferMinutes: 30,
      },
    });
  });

  it("builds a days search with and without a starting weekday", () => {
    const withDay = buildRequest(settings({ kind: "days", days: 7, startWeekday: 6 }), TODAY);
    expect(withDay.ok && withDay.request).toMatchObject({ mode: "days", days: 7, startWeekday: 6 });
    const without = buildRequest(settings({ kind: "days", days: 3 }), TODAY);
    expect(without.ok && without.request).toEqual({ mode: "days", people: [2, 3], from: "2026-11-02", to: "2027-01-30", days: 3 });
  });

  it("does not send hours settings in a days search", () => {
    const built = buildRequest(settings({ kind: "days" }), TODAY);
    expect(built.ok && Object.keys(built.request)).not.toContain("window");
    expect(built.ok && Object.keys(built.request)).not.toContain("weekdays");
  });

  it("names what is wrong", () => {
    expect(buildRequest(settings({ people: [] }), TODAY)).toEqual({ ok: false, problem: "no_people" });
    expect(buildRequest(settings({ weekdays: [] }), TODAY)).toEqual({ ok: false, problem: "no_weekdays" });
    expect(buildRequest(settings({ windowStart: "10:00", windowEnd: "10:00" }), TODAY)).toEqual({ ok: false, problem: "window_empty" });
    expect(buildRequest(settings({ windowStart: "18:00", windowEnd: "20:00", durationMinutes: 180 }), TODAY)).toEqual({ ok: false, problem: "too_long_for_window" });
    expect(buildRequest(settings({ range: "months", fromMonth: "2026-10", toMonth: "2026-10" }), TODAY)).toEqual({ ok: false, problem: "no_range" });
  });

  it("lets a window cross midnight and be exactly as long as the duration", () => {
    expect(windowMinutes("20:00", "02:00")).toBe(360);
    expect(buildRequest(settings({ windowStart: "20:00", windowEnd: "02:00", durationMinutes: 360 }), TODAY).ok).toBe(true);
    expect(buildRequest(settings({ windowStart: "20:00", windowEnd: "02:00", durationMinutes: 390 }), TODAY)).toEqual({ ok: false, problem: "too_long_for_window" });
  });

  it("ignores hours problems in a days search", () => {
    expect(buildRequest(settings({ kind: "days", weekdays: [], windowStart: "10:00", windowEnd: "10:00" }), TODAY).ok).toBe(true);
  });
});

describe("what the device remembers", () => {
  it("starts with Saturday and Sunday, 3 hours, 09:00-23:00, 90 days", () => {
    expect(defaultSettings(TODAY)).toMatchObject({
      people: [],
      kind: "hours",
      weekdays: [6, 7],
      durationMinutes: 180,
      windowStart: "09:00",
      windowEnd: "23:00",
      bufferMinutes: 0,
      range: "90",
    });
  });

  it("gives back what was saved", () => {
    const storage = new MemoryStorage();
    const mine = settings({ kind: "days", days: 10, startWeekday: 5, range: "months", fromMonth: "2026-12", toMonth: "2027-01", bufferMinutes: 45 });
    saveSettings(mine, storage);
    expect(loadSettings(TODAY, storage)).toEqual(mine);
  });

  it("uses the defaults without a saved value, with a broken one or without storage", () => {
    expect(loadSettings(TODAY, new MemoryStorage())).toEqual(defaultSettings(TODAY));
    const garbage = new MemoryStorage();
    garbage.setItem(SEARCH_SETTINGS_KEY, "{not json");
    expect(loadSettings(TODAY, garbage)).toEqual(defaultSettings(TODAY));
    expect(loadSettings(TODAY, null)).toEqual(defaultSettings(TODAY));
    expect(loadSettings(TODAY, brokenStorage)).toEqual(defaultSettings(TODAY));
    expect(() => saveSettings(settings(), brokenStorage)).not.toThrow();
  });

  it("keeps each valid value and replaces only the invalid ones", () => {
    const result = sanitizeSettings(
      {
        people: [2, "x", 2, 3.5, 4],
        kind: "days",
        weekdays: [7, 7, 9, 1],
        durationMinutes: 45,
        windowStart: "25:00",
        windowEnd: "22:30",
        bufferMinutes: 200,
        days: 12,
        startWeekday: 9,
        range: "decade",
      },
      TODAY,
    );
    expect(result).toMatchObject({
      people: [2, 4],
      kind: "days",
      weekdays: [1, 7],
      durationMinutes: 180,
      windowStart: "09:00",
      windowEnd: "22:30",
      bufferMinutes: 0,
      days: 12,
      startWeekday: null,
      range: "90",
    });
  });

  it("never keeps an empty window or a month that has passed", () => {
    expect(sanitizeSettings({ windowStart: "10:00", windowEnd: "10:00" }, TODAY)).toMatchObject({ windowStart: "09:00", windowEnd: "23:00" });
    const old = sanitizeSettings({ range: "months", fromMonth: "2026-03", toMonth: "2026-05" }, TODAY);
    expect(old).toMatchObject({ fromMonth: "2026-11", toMonth: "2026-11" });
    expect(sanitizeSettings({ fromMonth: "2026-12", toMonth: "2026-11" }, TODAY)).toMatchObject({ fromMonth: "2026-12", toMonth: "2026-12" });
  });

  it("copes with anything saved", () => {
    for (const raw of [null, 5, "text", [], { people: "all" }, { weekdays: {} }]) {
      expect(sanitizeSettings(raw, TODAY)).toMatchObject({ kind: "hours", range: "90" });
    }
  });

  it("drops people who have no account any more and never keeps the searcher", () => {
    expect(keepKnownPeople([1, 2, 3, 9], people, 1)).toEqual([2, 3]);
    expect(keepKnownPeople([], people, 1)).toEqual([]);
  });
});

describe("labels", () => {
  it("writes durations", () => {
    expect([30, 60, 90, 120, 300, 1440].map(durationLabel)).toEqual(["30 Minuten", "1 Stunde", "1,5 Stunden", "2 Stunden", "5 Stunden", "24 Stunden"]);
  });

  it("shortens weekdays", () => {
    expect(weekdaysLabel([6, 7])).toBe("Sa, So");
    expect(weekdaysLabel([5, 1, 3, 2, 4])).toBe("Mo–Fr");
    expect(weekdaysLabel([1, 3, 4, 5, 7])).toBe("Mo, Mi–Fr, So");
    expect(weekdaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe("jeden Tag");
  });

  it("sums up a search", () => {
    const hours = buildRequest(settings({ weekdays: [6], durationMinutes: 300, windowStart: "18:00", windowEnd: "23:00" }), TODAY);
    expect(hours.ok && requestSummary(hours.request)).toBe("Sa, mind. 5 Stunden, 18:00–23:00 Uhr · 2. Nov. 2026–30. Jan. 2027");
    const days = buildRequest(settings({ kind: "days", days: 7, startWeekday: 6 }), TODAY);
    expect(days.ok && requestSummary(days.request)).toBe("7 Tage am Stück, Start am Samstag · 2. Nov. 2026–30. Jan. 2027");
    const one = buildRequest(settings({ kind: "days", days: 1 }), TODAY);
    expect(one.ok && requestSummary(one.request)).toBe("1 Tag am Stück · 2. Nov. 2026–30. Jan. 2027");
    const short = buildRequest(settings({ range: "30" }), TODAY);
    expect(short.ok && requestSummary(short.request)).toContain("· 2. Nov.–1. Dez.");
  });
});

describe("the answer", () => {
  const hours: SearchResult = {
    mode: "hours",
    skipped: [],
    days: [
      { date: "2026-12-12", slots: [{ start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T22:00:00.000Z" }] },
      {
        date: "2026-12-19",
        slots: [
          { start: "2026-12-19T09:00:00.000Z", end: "2026-12-19T11:00:00.000Z" },
          { start: "2026-12-19T17:00:00.000Z", end: "2026-12-19T22:00:00.000Z" },
        ],
      },
    ],
    nearMisses: [
      { date: "2026-12-26", missingPersonId: 3, slots: [{ start: "2026-12-26T17:00:00.000Z", end: "2026-12-26T22:00:00.000Z" }] },
      { date: "2026-12-26", missingPersonId: 1, slots: [{ start: "2026-12-26T09:00:00.000Z", end: "2026-12-26T11:00:00.000Z" }] },
    ],
  };

  it("shows one line per day with all its free times", () => {
    const view = resultView(hours, people, 1);
    expect(view.everyone).toEqual([
      { key: "2026-12-12", heading: "Sa 12.12.", detail: "14:00–23:00" },
      { key: "2026-12-19", heading: "Sa 19.12.", detail: "10:00–12:00, 18:00–23:00" },
    ]);
  });

  it("says who is missing, and 'dir' for the searcher", () => {
    const view = resultView(hours, people, 1);
    expect(view.nearMisses.map((r) => [r.heading, r.missing, r.detail])).toEqual([
      ["Sa 26.12.", "alle außer Clara", "18:00–23:00"],
      ["Sa 26.12.", "alle außer dir", "10:00–12:00"],
    ]);
    expect(new Set(view.nearMisses.map((r) => r.key)).size).toBe(2);
  });

  it("does not break on a person who is not in the list", () => {
    const view = resultView({ ...hours, nearMisses: [{ ...hours.nearMisses[0]!, missingPersonId: 99 }] }, people, 1);
    expect(view.nearMisses[0]!.missing).toBe("alle außer jemandem");
  });

  it("merges stretches into one line and tells where a period can start", () => {
    const days: SearchResult = {
      mode: "days",
      skipped: [],
      stretches: [
        { first: "2026-08-03", last: "2026-08-16", days: 14, starts: ["2026-08-03", "2026-08-10"] },
        { first: "2026-10-05", last: "2026-10-05", days: 1 },
      ],
      nearMisses: [{ first: "2027-02-14", last: "2027-02-28", days: 15, missingPersonId: 2 }],
    };
    const view = resultView(days, people, 1);
    expect(view.everyone).toEqual([
      { key: "2026-08-03", heading: "3.–16. Aug.", detail: "14 Tage", extra: "Start möglich: Mo 3. Aug., Mo 10. Aug." },
      { key: "2026-10-05", heading: "5. Okt.", detail: "1 Tag" },
    ]);
    expect(view.nearMisses).toEqual([{ key: "2027-02-14:2", heading: "14.–28. Feb.", detail: "15 Tage", missing: "alle außer Ben" }]);
  });

  it("names everyone who was left out and why", () => {
    expect(
      skippedNotices(
        [
          { personId: 2, reason: "unreadable" },
          { personId: 3, reason: "no_calendar" },
          { personId: 1, reason: "unreadable" },
          { personId: 99, reason: "no_calendar" },
        ],
        people,
        1,
      ),
    ).toEqual([
      "Ben: Kalender nicht lesbar – nicht berücksichtigt",
      "Clara: kein Kalender verknüpft – nicht berücksichtigt",
      "Du: Kalender nicht lesbar – nicht berücksichtigt",
      "Jemand: kein Kalender verknüpft – nicht berücksichtigt",
    ]);
    expect(skippedNotices([], people, 1)).toEqual([]);
  });

  it("counts the readable people for the near-miss rule", () => {
    // Others chosen + the searcher − everybody left out.
    expect(readablePeople(3, [])).toBe(4);
    expect(readablePeople(3, [{ personId: 2, reason: "unreadable" }])).toBe(3);
    expect(readablePeople(2, [{ personId: 2, reason: "no_calendar" }])).toBe(2);
  });
});
