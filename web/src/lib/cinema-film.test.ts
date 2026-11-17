import type { CinemaShowing } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { chooseTitle, daysToFetch, eveningShowings, groupFilms, rankFilms, runLimited, versionLabel, versionShort, type FilmShowing } from "./cinema-film";
import type { CinemaSource } from "./poll-draft";

// December is winter time: 18:00 in Berlin is 17:00 UTC.
const slot = (day: string, from: string, to: string) => ({ start: `${day}T${from}:00.000Z`, end: `${day}T${to}:00.000Z` });

const source: CinemaSource = {
  days: [
    { date: "2026-12-11", slots: [slot("2026-12-11", "17:00", "22:30")] },
    { date: "2026-12-12", slots: [] },
    { date: "2026-12-13", slots: [slot("2026-12-13", "13:00", "22:00")] },
  ],
  partial: [],
  window: { start: "17:00", end: "23:00" },
  from: "2026-12-11",
  to: "2026-12-13",
  durationMinutes: 120,
  names: { 1: "Lena" },
};
const now = new Date("2026-12-01T10:00:00Z");

let n = 0;
function fs(cinemaId: number, cinemaName: string, film: string, utc: string, extra: Partial<CinemaShowing> = {}): FilmShowing {
  n++;
  const day = utc.slice(0, 10);
  const clock = `${String(Number(utc.slice(11, 13)) + 1).padStart(2, "0")}:${utc.slice(14, 16)}`;
  return { cinemaId, cinemaName, day, clock, showing: { film, start: `${utc}:00.000Z`, ...extra } };
}

describe("daysToFetch", () => {
  it("lists only the days with free times, in order", () => {
    expect(daysToFetch(source)).toEqual(["2026-12-11", "2026-12-13"]);
  });
});

describe("runLimited", () => {
  it("never runs more than three jobs at once and keeps the order of the results", async () => {
    let running = 0;
    let peak = 0;
    const jobs = Array.from({ length: 10 }, (_, i) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return i;
    });
    expect(await runLimited(jobs, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
  });
});

describe("eveningShowings", () => {
  it("keeps the evening of the day and the night after it, drops the rest", () => {
    const list: CinemaShowing[] = [
      { film: "A", start: "2026-12-11T17:30:00.000Z" },
      { film: "B", start: "2026-12-11T23:30:00.000Z" }, // 00:30 next day, Berlin
      { film: "C", start: "2026-12-11T02:00:00.000Z" }, // 03:00, belongs to the evening before
    ];
    expect(eveningShowings({ id: 1, name: "X" }, "2026-12-11", list).map((s) => s.showing.film)).toEqual(["A", "B"]);
  });
});

describe("groupFilms", () => {
  it("merges one contentId across cinemas although the names differ", () => {
    const films = groupFilms([
      fs(1, "Kino A", "Der letzte Leuchtturm", "2026-12-11T17:30", { contentId: 5 }),
      fs(2, "Kino B", "Der letzte Leuchtturm (Imax)", "2026-12-11T18:00", { contentId: 5 }),
    ]);
    expect(films).toHaveLength(1);
    expect(films[0]!.cinemaIds).toEqual([1, 2]);
    expect(films[0]!.names).toHaveLength(2);
  });

  it("does not merge the same name with different content ids", () => {
    const films = groupFilms([
      fs(1, "Kino A", "Das Haus", "2026-12-11T17:30", { contentId: 5 }),
      fs(2, "Kino B", "Das Haus", "2026-12-11T18:00", { contentId: 6 }),
    ]);
    expect(films).toHaveLength(2);
  });

  it("does not merge showings without content id across cinemas, but within one cinema and name", () => {
    const films = groupFilms([
      fs(1, "Kino A", "Live-Event", "2026-12-11T17:30"),
      fs(1, "Kino A", "Live-Event", "2026-12-11T19:30"),
      fs(2, "Kino B", "Live-Event", "2026-12-11T18:00"),
    ]);
    expect(films).toHaveLength(2);
    expect(films.map((f) => f.cinemaIds.length)).toEqual([1, 1]);
  });

  it("lists the distinct versions, German first, and nothing for an unknown language", () => {
    const [film] = groupFilms([
      fs(1, "Kino A", "F", "2026-12-11T17:30", { contentId: 1, language: "eng", originalLanguage: "eng" }),
      fs(1, "Kino A", "F", "2026-12-11T19:30", { contentId: 1, language: "deu", originalLanguage: "eng" }),
      fs(2, "Kino B", "F", "2026-12-11T18:00", { contentId: 1, originalLanguage: "eng" }),
      fs(2, "Kino B", "F", "2026-12-11T20:00", { contentId: 1, language: "eng", originalLanguage: "eng" }),
    ]);
    expect(film!.versions).toEqual(["Deutsch", "OV Englisch"]);
  });
});

describe("chooseTitle", () => {
  it("takes the most frequent name", () => {
    expect(chooseTitle(["Lang Name", "Kurz", "Lang Name"])).toBe("Lang Name");
  });
  it("breaks a tie by length, then alphabet", () => {
    expect(chooseTitle(["Der Film (Imax)", "Der Film"])).toBe("Der Film");
    expect(chooseTitle(["Beta", "Alfa"])).toBe("Alfa");
  });
});

describe("versions", () => {
  it("marks the original version and leaves unknown languages out", () => {
    expect(versionLabel("eng", "eng")).toBe("OV Englisch");
    expect(versionLabel("deu", "eng")).toBe("Deutsch");
    expect(versionLabel("deu", "deu")).toBe("Deutsch");
    expect(versionLabel("fra", "eng")).toBe("Französisch");
    expect(versionLabel(undefined, "eng")).toBeNull();
    expect(versionShort("eng", "eng")).toBe("OV EN");
    expect(versionShort("deu", "eng")).toBe("DE");
    expect(versionShort(undefined, "eng")).toBeNull();
  });
});

describe("rankFilms", () => {
  // 120 min film + 20 min advert = 140 min; free 18:00-23:30 on the 11th (17:00-22:30 UTC), 14:00-23:00 on the 13th.
  const all = groupFilms([
    fs(1, "Kino A", "Beta Film", "2026-12-11T17:30", { contentId: 1 }), // 18:30 fits
    fs(1, "Kino A", "Beta Film", "2026-12-13T14:00", { contentId: 1 }), // fits
    fs(1, "Kino A", "Alfa Film", "2026-12-11T17:30", { contentId: 2 }), // fits
    fs(1, "Kino A", "Gamma Film", "2026-12-11T10:00", { contentId: 3, movieId: 30 }), // 11:00, too early
    fs(2, "Kino B", "Delta Film", "2026-12-11T14:00", { contentId: 4 }), // too early
    fs(2, "Kino B", "Zeta Film", "2026-12-11T21:00", { contentId: 6, movieId: 60 }), // 22:00 + 140 = too late with 120
  ]);
  const context = { source, runtimes: {}, now };

  it("puts films with fitting showings first by count, the others last by title", () => {
    const cards = rankFilms(all, context);
    expect(cards.map((c) => [c.film.title, c.fitting])).toEqual([
      ["Beta Film", 2],
      ["Alfa Film", 1],
      ["Delta Film", 0],
      ["Gamma Film", 0],
      ["Zeta Film", 0],
    ]);
  });

  it("uses the runtime of a film when known", () => {
    // Zeta: 22:00 + 20 + 30 = 22:50 is within 23:30.
    const cards = rankFilms(all, { ...context, runtimes: { 60: 30 } });
    expect(cards.find((c) => c.film.title === "Zeta Film")).toMatchObject({ fitting: 1, minutes: 30 });
    expect(cards[0]!.film.title).toBe("Beta Film");
  });

  it("filters case-insensitively on all names of a film", () => {
    const merged = groupFilms([
      fs(1, "Kino A", "Der letzte Leuchtturm", "2026-12-11T17:30", { contentId: 9 }),
      fs(2, "Kino B", "The Last Lighthouse", "2026-12-11T18:00", { contentId: 9 }),
      fs(2, "Kino B", "Anderes", "2026-12-11T18:00", { contentId: 10 }),
    ]);
    expect(rankFilms(merged, context, "LIGHTHOUSE").map((c) => c.film.key)).toEqual(["c:9"]);
    expect(rankFilms(merged, context, "leucht")).toHaveLength(1);
    expect(rankFilms(merged, context, "")).toHaveLength(2);
  });
});
