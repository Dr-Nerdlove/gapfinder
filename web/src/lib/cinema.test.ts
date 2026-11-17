import type { SearchResult } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import {
  ADVERT_MINUTES_OPTIONS,
  CINEMA_PROBLEM_TEXTS,
  FILM_MINUTES_OPTIONS,
  checkShowings,
  cinemaRequest,
  cinemaSourceOf,
  cinemaSubmitLabel,
  defaultCinemaDay,
  filmsOfEvening,
  languageLabel,
  freeTimeSummary,
  groupShowings,
  hoursMinutesLabel,
  minutesLabel,
  parseShowtimes,
  shortSearchHint,
  showingStart,
  summaryLines,
  type CheckContext,
  type ShowingInput,
} from "./cinema";
import { pollSource, type CinemaSource } from "./poll-draft";

// December is winter time: 18:00 in Berlin is 17:00 UTC.
const slot = (day: string, from: string, to: string) => ({ start: `${day}T${from}:00.000Z`, end: `${day}T${to}:00.000Z` });

const source: CinemaSource = {
  days: [
    { date: "2026-12-11", slots: [slot("2026-12-11", "17:00", "20:00")] },
    { date: "2026-12-12", slots: [slot("2026-12-12", "17:00", "22:00")] },
    { date: "2026-12-14", slots: [slot("2026-12-14", "18:00", "20:00"), slot("2026-12-14", "21:00", "22:00")] },
  ],
  partial: [
    { date: "2026-12-13", missingPersonIds: [2], slots: [slot("2026-12-13", "17:00", "22:00")] },
    { date: "2026-12-15", missingPersonIds: [2, 3], slots: [slot("2026-12-15", "17:00", "22:00")] },
    { date: "2026-12-16", missingPersonIds: [2, 3, 4], slots: [slot("2026-12-16", "17:00", "22:00")] },
    { date: "2026-12-17", missingPersonIds: [99], slots: [slot("2026-12-17", "17:00", "22:00")] },
    { date: "2026-12-19", missingPersonIds: [2], slots: [slot("2026-12-19", "17:00", "19:00")] },
  ],
  window: { start: "18:00", end: "23:00" },
  from: "2026-12-10",
  to: "2026-12-20",
  durationMinutes: 180,
  names: { 2: "Lena", 3: "Emil", 4: "Jonas" },
};

const context: CheckContext = { source, filmMinutes: 130, advertMinutes: 20, now: new Date("2026-12-01T10:00:00Z") };
const check = (day: string, clock: string, place = "Kino am Markt", ctx: Partial<CheckContext> = {}) =>
  checkShowings([{ place, day, clock }], { ...context, ...ctx })[0]!;

describe("parseShowtimes", () => {
  it("finds times with colon, dot, one-digit hours and 'Uhr', separated by anything", () => {
    expect(parseShowtimes("17:30 20:15, 22:45; 9:05\n20.15 Uhr und 11.00")).toEqual(["09:05", "11:00", "17:30", "20:15", "22:45"]);
  });
  it("ignores impossible times and dates and keeps each time once", () => {
    expect(parseShowtimes("24:00 12:60 25:10 am 12.12.2026 um 19:30 19:30 19.30")).toEqual(["19:30"]);
  });
  it("sorts times before 05:00 after the others", () => {
    expect(parseShowtimes("00:30 22:45 04:59 05:00 17:00")).toEqual(["05:00", "17:00", "22:45", "00:30", "04:59"]);
  });
  it("returns nothing for text without a time", () => {
    expect(parseShowtimes("")).toEqual([]);
    expect(parseShowtimes("hallo 2026")).toEqual([]);
  });
});

describe("showing times", () => {
  it("the end includes the advert buffer", () => {
    const r = check("2026-12-12", "20:10", "Kino", { filmMinutes: 130, advertMinutes: 20 });
    expect(r.start).toBe("2026-12-12T19:10:00.000Z");
    expect(r.end).toBe("2026-12-12T21:40:00.000Z"); // 22:40 in Berlin
  });
  it("a clock before 05:00 belongs to the night after the chosen day", () => {
    expect(showingStart("2026-12-12", "00:30")?.toISOString()).toBe("2026-12-12T23:30:00.000Z");
    expect(showingStart("2026-12-12", "05:00")?.toISOString()).toBe("2026-12-12T04:00:00.000Z");
    expect(showingStart("2026-12-31", "01:00")?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("counts real minutes over the change to winter time", () => {
    const r = check("2026-10-24", "02:30", "Kino", { filmMinutes: 120, advertMinutes: 30, now: new Date("2026-10-01T00:00:00Z") });
    expect(r.start).toBe("2026-10-25T00:30:00.000Z"); // the earlier 02:30
    expect(r.end).toBe("2026-10-25T03:00:00.000Z"); // 04:00 on the clock
  });
  it("skips a clock that is no time", () => {
    expect(checkShowings([{ place: "K", day: "2026-12-12", clock: "25:00" }], context)).toEqual([]);
  });
});

describe("checkShowings reasons", () => {
  it("a) past", () => {
    const r = check("2026-12-12", "20:00", "K", { now: new Date("2026-12-12T19:30:00Z") });
    expect(r).toMatchObject({ fits: false, reason: "liegt in der Vergangenheit" });
  });
  it("b) outside the period", () => {
    expect(check("2026-12-25", "20:00")).toMatchObject({ fits: false, reason: "Tag liegt nicht im Suchzeitraum" });
    expect(check("2026-12-09", "20:00")).toMatchObject({ fits: false, reason: "Tag liegt nicht im Suchzeitraum" });
  });
  it("c) fits inside an all-free slot, also exactly at its edges", () => {
    expect(check("2026-12-12", "20:10")).toMatchObject({ fits: true, reason: "alle haben Zeit" });
    expect(check("2026-12-12", "20:30", "K", { filmMinutes: 120, advertMinutes: 30 }).fits).toBe(true); // ends 23:00 sharp
    expect(check("2026-12-12", "20:31", "K", { filmMinutes: 120, advertMinutes: 30 }).fits).toBe(false);
    expect(check("2026-12-12", "18:00", "K", { filmMinutes: 120, advertMinutes: 30 }).fits).toBe(true); // starts sharp
  });
  it("d) before or after the searched window", () => {
    expect(check("2026-12-12", "17:30")).toMatchObject({ fits: false, reason: "beginnt vor 18:00 Uhr" });
    expect(check("2026-12-12", "22:45")).toMatchObject({ fits: false, reason: "endet nach 23:00 Uhr" });
    expect(check("2026-12-12", "00:30")).toMatchObject({ fits: false, reason: "endet nach 23:00 Uhr" });
  });
  it("d) respects a window that runs past midnight", () => {
    const night: CinemaSource = {
      ...source,
      days: [{ date: "2026-12-12", slots: [{ start: "2026-12-12T17:00:00.000Z", end: "2026-12-13T01:00:00.000Z" }] }],
      partial: [],
      window: { start: "18:00", end: "02:00" },
    };
    const ctx = { source: night };
    expect(check("2026-12-12", "22:00", "K", ctx).fits).toBe(true);
    expect(check("2026-12-12", "00:30", "K", { ...ctx, filmMinutes: 90, advertMinutes: 0 }).fits).toBe(true); // 00:30 next day, ends 02:00 sharp
    expect(check("2026-12-12", "00:30", "K", ctx)).toMatchObject({ fits: false, reason: "endet nach 02:00 Uhr" });
    const none = { source: { ...night, days: [] } };
    expect(check("2026-12-12", "23:30", "K", { ...none, filmMinutes: 100 })).toMatchObject({ fits: false, reason: "an dem Tag haben nicht alle Zeit" }); // 01:30 is inside the window
  });
  it("e) partial: names of the missing people", () => {
    expect(check("2026-12-13", "19:00")).toMatchObject({ fits: false, reason: "Lena hat da keine Zeit" });
    expect(check("2026-12-15", "19:00").reason).toBe("Lena und Emil haben da keine Zeit");
    expect(check("2026-12-16", "19:00").reason).toBe("Lena, Emil und Jonas haben da keine Zeit");
    expect(check("2026-12-17", "19:00").reason).toBe("jemand hat da keine Zeit");
  });
  it("f) all-free time begins later or ends earlier", () => {
    expect(check("2026-12-14", "18:30")).toMatchObject({ fits: false, reason: "alle frei erst ab 19:00 Uhr" });
    expect(check("2026-12-11", "19:30")).toMatchObject({ fits: false, reason: "alle frei nur bis 21:00 Uhr" });
  });
  it("g) otherwise", () => {
    expect(check("2026-12-18", "19:00")).toMatchObject({ fits: false, reason: "an dem Tag haben nicht alle Zeit" });
  });
  it("a showing not inside one partial slot is not blamed on people", () => {
    expect(check("2026-12-19", "18:30").reason).toBe("an dem Tag haben nicht alle Zeit"); // ends 20:50, the slot 18:00-20:00 is too short
  });
  it("a place is trimmed and duplicates appear once", () => {
    const list: ShowingInput[] = [
      { place: "Kino", day: "2026-12-12", clock: "20:10" },
      { place: " kino ", day: "2026-12-12", clock: "20:10" },
      { place: "Anderes", day: "2026-12-12", clock: "20:10" },
      { place: "Kino", day: "2026-12-12", clock: "20:15" },
    ];
    const result = checkShowings(list, context);
    expect(result.map((r) => `${r.place}@${r.clock}`)).toEqual(["Kino@20:10", "Anderes@20:10", "Kino@20:15"]);
  });
});

describe("summaries and groups", () => {
  it("one slot, several slots, none", () => {
    expect(freeTimeSummary(source, "2026-12-12")).toBe("Sa 12.12., alle frei 18:00–23:00 Uhr");
    expect(freeTimeSummary(source, "2026-12-14")).toBe("Mo 14.12., alle frei 19:00–21:00 und 22:00–23:00 Uhr");
    expect(freeTimeSummary(source, "2026-12-18")).toBe("Fr 18.12.: keine Zeit, in der alle frei sind");
  });
  it("one line per day, in order", () => {
    expect(summaryLines(source, ["2026-12-12", "2026-12-11", "2026-12-12"])).toEqual([
      "Fr 11.12., alle frei 18:00–21:00 Uhr",
      "Sa 12.12., alle frei 18:00–23:00 Uhr",
    ]);
  });
  it("groups by day and place, items by start", () => {
    const list = checkShowings(
      [
        { place: "B", day: "2026-12-12", clock: "21:00" },
        { place: "A", day: "2026-12-11", clock: "19:00" },
        { place: "B", day: "2026-12-12", clock: "18:00" },
        { place: "C", day: "2026-12-12", clock: "18:00" },
      ],
      context,
    );
    const groups = groupShowings(list);
    expect(groups.map((g) => `${g.day} ${g.place} ${g.items.map((i) => i.clock).join(",")}`)).toEqual([
      "2026-12-11 A 19:00",
      "2026-12-12 B 18:00,21:00",
      "2026-12-12 C 18:00",
    ]);
  });
  it("default day is the first day with free time, else the first day", () => {
    expect(defaultCinemaDay(source)).toBe("2026-12-11");
    expect(defaultCinemaDay({ ...source, days: [] })).toBe("2026-12-10");
    expect(defaultCinemaDay({ ...source, days: [{ date: "2026-12-12", slots: [] }, { date: "2026-12-13", slots: [slot("2026-12-13", "17:00", "20:00")] }] })).toBe("2026-12-13");
  });
});

describe("texts and options", () => {
  it("labels", () => {
    expect(minutesLabel(130)).toBe("130 Min.");
    expect(hoursMinutesLabel(180)).toBe("3 Std.");
    expect(hoursMinutesLabel(150)).toBe("2 Std. 30 Min.");
    expect(hoursMinutesLabel(45)).toBe("45 Min.");
    expect(cinemaSubmitLabel(1)).toBe("Abstimmung mit 1 Termin erstellen");
    expect(cinemaSubmitLabel(2)).toBe("Abstimmung mit 2 Terminen erstellen");
    expect(cinemaSubmitLabel(0)).toBe("Abstimmung mit 0 Terminen erstellen");
  });
  it("hint only when the search was longer than film plus advert", () => {
    expect(shortSearchHint(180, 120, 30)).toBe(
      "Ihr habt nach freien Zeiten ab 3 Std. gesucht. Kürzere Lücken, in die der Film passt (2 Std. 30 Min.), fehlen deshalb. Such dafür mit kürzerer Dauer.",
    );
    expect(shortSearchHint(150, 120, 30)).toBeNull();
    expect(shortSearchHint(120, 120, 30)).toBeNull();
  });
  it("select options", () => {
    expect(FILM_MINUTES_OPTIONS[0]).toBe(60);
    expect(FILM_MINUTES_OPTIONS.at(-1)).toBe(240);
    expect(FILM_MINUTES_OPTIONS).toHaveLength(37);
    expect(ADVERT_MINUTES_OPTIONS).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
  });
});

describe("cinemaRequest", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  const showings = checkShowings(
    [
      { place: "Kino am Markt", day: "2026-12-12", clock: "20:10" },
      { place: "Kino am Markt", day: "2026-12-12", clock: "20:15" },
    ],
    context,
  );
  const base = { title: " Kinoabend ", note: "", deadlineDate: "", deadlineTime: "", participants: [2, 3], showings };

  it("builds a timed poll with places and minute times", () => {
    const r = cinemaRequest({ ...base, hidden: true }, now);
    expect(r).toEqual({
      ok: true,
      request: {
        title: "Kinoabend",
        participants: [2, 3],
        deadline: null,
        hidden: true,
        kind: "timed",
        proposals: [
          { start: "2026-12-12T19:10:00.000Z", end: "2026-12-12T21:40:00.000Z", place: "Kino am Markt" },
          { start: "2026-12-12T19:15:00.000Z", end: "2026-12-12T21:45:00.000Z", place: "Kino am Markt" },
        ],
      },
    });
  });
  it("needs a place", () => {
    const r = cinemaRequest({ ...base, showings: showings.map((s) => ({ ...s, place: " " })) }, now);
    expect(r).toMatchObject({ ok: false, problem: "place_missing" });
    expect(CINEMA_PROBLEM_TEXTS.place_missing).toBe("Bitte gib das Kino an.");
  });
  it("keeps the checks of the normal poll", () => {
    expect(cinemaRequest({ ...base, title: " " }, now)).toMatchObject({ ok: false, problem: "title_empty" });
    expect(cinemaRequest({ ...base, showings: [] }, now)).toMatchObject({ ok: false, problem: "no_items" });
    expect(cinemaRequest({ ...base, deadlineDate: "2026-12-12" }, now)).toMatchObject({ ok: false, problem: "deadline_incomplete" });
  });
  it("allows 20 showings, not 21", () => {
    const many = (n: number) => ({
      ...showings[0]!,
      key: `k${n}`,
      start: new Date(Date.parse("2026-12-12T17:00:00Z") + n * 60_000).toISOString(),
      end: new Date(Date.parse("2026-12-12T19:30:00Z") + n * 60_000).toISOString(),
    });
    expect(cinemaRequest({ ...base, showings: Array.from({ length: 20 }, (_, i) => many(i)) }, now).ok).toBe(true);
    expect(cinemaRequest({ ...base, showings: Array.from({ length: 21 }, (_, i) => many(i)) }, now)).toMatchObject({ ok: false, problem: "too_many" });
  });
  it("the same time at two cinemas is two proposals", () => {
    const two = checkShowings(
      [
        { place: "A", day: "2026-12-12", clock: "20:10" },
        { place: "B", day: "2026-12-12", clock: "20:10" },
      ],
      context,
    );
    const r = cinemaRequest({ ...base, showings: two }, now);
    expect(r.ok && r.request.proposals).toHaveLength(2);
  });
});

describe("cinemaSourceOf", () => {
  const result: SearchResult = {
    mode: "hours",
    skipped: [],
    days: [{ date: "2026-12-12", slots: [slot("2026-12-12", "17:00", "22:00")] }],
    nearMisses: [],
    partial: [{ date: "2026-12-13", missingPersonIds: [2], slots: [slot("2026-12-13", "17:00", "22:00")] }],
  };
  const searched = { from: "2026-12-10", to: "2026-12-20", window: { start: "18:00", end: "23:00" }, durationMinutes: 180 };
  const people = [
    { id: 1, username: "Vincent" },
    { id: 2, username: "Lena" },
  ];
  it("takes the whole result, the search and the names", () => {
    const s = cinemaSourceOf(result, searched, people);
    expect(s).toEqual({ days: result.days, partial: (result as { partial: unknown }).partial, ...searched, names: { 1: "Vincent", 2: "Lena" } });
  });
  it("turns old near misses into partial and ignores days searches", () => {
    const old: SearchResult = { mode: "hours", skipped: [], days: [], nearMisses: [{ date: "2026-12-13", missingPersonId: 2, slots: [slot("2026-12-13", "17:00", "22:00")] }] };
    expect(cinemaSourceOf(old, searched, people)?.partial).toEqual([{ date: "2026-12-13", missingPersonIds: [2], slots: [slot("2026-12-13", "17:00", "22:00")] }]);
    expect(cinemaSourceOf({ mode: "days", skipped: [], stretches: [], nearMisses: [] }, searched, people)).toBeNull();
  });
  it("is handed over through pollSource", () => {
    const cinema = cinemaSourceOf(result, searched, people)!;
    pollSource.set({ picks: [], durationMinutes: 180, periodDays: 1, participants: [2], summary: "s", cinema });
    expect(pollSource.get()?.cinema).toBe(cinema);
    expect(pollSource.get()?.picks).toEqual([]);
    pollSource.clear();
    expect(pollSource.get()).toBeNull();
  });
});

describe("filmsOfEvening", () => {
  const show = (film: string, start: string, language?: string) => ({ film, start, ...(language ? { language } : {}) });

  it("converts UTC to Berlin time in winter (UTC+1) and summer (UTC+2)", () => {
    const winter = filmsOfEvening([show("A", "2026-12-11T19:15:00.000Z")], "2026-12-11");
    expect(winter[0]?.clocks).toEqual(["20:15"]);
    const summer = filmsOfEvening([show("A", "2026-07-11T18:15:00.000Z")], "2026-07-11");
    expect(summer[0]?.clocks).toEqual(["20:15"]);
  });

  it("uses the Berlin date, not the UTC date", () => {
    // 23:30 UTC in winter is 00:30 on the next Berlin day: night after 2026-12-11.
    expect(filmsOfEvening([show("A", "2026-12-11T23:30:00.000Z")], "2026-12-11")[0]?.clocks).toEqual(["00:30"]);
    expect(filmsOfEvening([show("A", "2026-12-11T23:30:00.000Z")], "2026-12-12")).toEqual([]);
  });

  it("applies the night rule on both sides of 05:00", () => {
    const list = [
      show("Nacht", "2026-12-12T03:59:00.000Z"), // 04:59 on the 12th: night of the 11th
      show("Morgen", "2026-12-12T04:00:00.000Z"), // 05:00 on the 12th: morning of the 12th, not the 11th
      show("Vornacht", "2026-12-11T03:59:00.000Z"), // 04:59 on the 11th: night of the 10th
      show("Abend", "2026-12-11T04:00:00.000Z"), // 05:00 on the 11th: evening of the 11th
    ];
    expect(filmsOfEvening(list, "2026-12-11").map((f) => [f.film, f.clocks])).toEqual([
      ["Abend", ["05:00"]],
      ["Nacht", ["04:59"]],
    ]);
    expect(filmsOfEvening(list, "2026-12-12").map((f) => f.film)).toEqual(["Morgen"]);
  });

  it("puts the night after the evening times", () => {
    const list = [show("A", "2026-12-11T23:15:00.000Z"), show("A", "2026-12-11T16:00:00.000Z")];
    expect(filmsOfEvening(list, "2026-12-11")[0]?.clocks).toEqual(["17:00", "00:15"]);
  });

  it("keeps only the asked screen (trimmed, ignoring case) and drops showings without a screen name", () => {
    const inRoom = (film: string, start: string, room?: string) => ({ film, start, ...(room ? { room } : {}) });
    const list = [
      inRoom("Imax-Film", "2026-12-11T19:00:00.000Z", "IMAX"),
      inRoom("Klein", "2026-12-11T19:00:00.000Z", "Kino 2"),
      inRoom("Ohne", "2026-12-11T19:00:00.000Z"),
      inRoom("Imax-Film", "2026-12-11T21:00:00.000Z", " imax "),
    ];
    expect(filmsOfEvening(list, "2026-12-11", "imax").map((f) => [f.film, f.clocks])).toEqual([["Imax-Film", ["20:00", "22:00"]]]);
    expect(filmsOfEvening(list, "2026-12-11", "Saal 9")).toEqual([]);
    expect(filmsOfEvening(list, "2026-12-11").map((f) => f.film)).toEqual(["Imax-Film", "Klein", "Ohne"]);
  });

  it("groups by film and language, lists a clock once and sorts", () => {
    const list = [
      show("Zebra", "2026-12-11T19:00:00.000Z", "deu"),
      show("Ärger", "2026-12-11T18:00:00.000Z", "eng"),
      show("Ärger", "2026-12-11T19:00:00.000Z"),
      show("Ärger", "2026-12-11T19:00:00.000Z", "deu"),
      show("Ärger", "2026-12-11T16:30:00.000Z", "eng"),
      show("Ärger", "2026-12-11T16:30:00.000Z", "eng"),
      show("Ärger", "2026-12-11T16:30:00.000Z", "fra"),
    ];
    const films = filmsOfEvening(list, "2026-12-11");
    expect(films.map((f) => [f.film, f.languageLabel, f.clocks])).toEqual([
      ["Ärger", null, ["20:00"]],
      ["Ärger", "Englisch", ["17:30", "19:00"]],
      ["Ärger", "FRA", ["17:30"]],
      ["Zebra", null, ["20:00"]],
    ]);
  });

  it("leaves out other days", () => {
    expect(filmsOfEvening([show("A", "2026-12-10T19:00:00.000Z"), show("B", "2026-12-13T19:00:00.000Z")], "2026-12-11")).toEqual([]);
  });

  it("labels languages", () => {
    expect([languageLabel(undefined), languageLabel("deu"), languageLabel("eng"), languageLabel("fra")]).toEqual([null, null, "Englisch", "FRA"]);
  });
});
