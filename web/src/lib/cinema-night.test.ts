import { describe, expect, it } from "vitest";
import {
  CINEMA_NIGHT_MAX_DAYS_AHEAD,
  PERIOD_PROBLEM_TEXTS,
  checkPeriod,
  cinemaNightRequest,
  defaultPeriod,
  fetchedDaysLine,
  nightChoice,
  nightSummary,
  periodDays,
  periodLabel,
  peopleLabel,
} from "./cinema-night";

const today = "2026-11-17";

describe("cinemaNightRequest", () => {
  it("searches the whole day, every weekday, 90 minutes, no buffer", () => {
    expect(cinemaNightRequest([2, 3], "2026-12-01", "2026-12-20")).toEqual({
      mode: "hours",
      people: [2, 3],
      from: "2026-12-01",
      to: "2026-12-20",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      durationMinutes: 90,
      window: { start: "05:00", end: "04:45" },
      bufferMinutes: 0,
    });
  });

  it("is a window the server accepts: the end is before the start (next day), not equal, duration a multiple of 30", () => {
    const request = cinemaNightRequest([2], "2026-12-01", "2026-12-02");
    if (request.mode !== "hours") throw new Error("hours expected");
    expect(request.window?.start).not.toBe(request.window?.end);
    expect(request.window!.end < request.window!.start).toBe(true);
    expect(request.durationMinutes % 30).toBe(0);
    // The server's CLOCK_PATTERN: quarter hours only ("04:59" was refused with "Bitte prüfe deine Eingaben").
    for (const clock of [request.window!.start, request.window!.end]) expect(clock).toMatch(/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/);
  });

  it("copies the people", () => {
    const people = [4];
    const request = cinemaNightRequest(people, "2026-12-01", "2026-12-02");
    people.push(5);
    expect(request.people).toEqual([4]);
  });
});

describe("checkPeriod", () => {
  it("accepts today and the last day 60 days ahead", () => {
    expect(checkPeriod(today, today, today)).toBeNull();
    expect(checkPeriod(today, "2027-01-16", today)).toBeNull();
    expect(CINEMA_NIGHT_MAX_DAYS_AHEAD).toBe(60);
  });

  it("refuses a start in the past", () => {
    expect(checkPeriod("2026-11-16", "2026-11-20", today)).toBe("in_the_past");
  });

  it("refuses an end before the start", () => {
    expect(checkPeriod("2026-11-20", "2026-11-19", today)).toBe("to_before_from");
  });

  it("refuses more than 60 days ahead", () => {
    expect(checkPeriod(today, "2027-01-17", today)).toBe("too_far_ahead");
  });

  it("refuses missing or impossible dates", () => {
    expect(checkPeriod("", "2026-11-20", today)).toBe("dates_missing");
    expect(checkPeriod("2026-11-20", "", today)).toBe("dates_missing");
    expect(checkPeriod("2026-11-20", "2026-02-31", today)).toBe("dates_missing");
  });

  it("has a German text for every problem", () => {
    for (const text of Object.values(PERIOD_PROBLEM_TEXTS)) expect(text.length).toBeGreaterThan(10);
  });
});

describe("defaultPeriod and periodDays", () => {
  it("is today to today plus 13 days (14 days)", () => {
    expect(defaultPeriod(today)).toEqual({ from: "2026-11-17", to: "2026-11-30" });
    expect(periodDays("2026-11-17", "2026-11-30")).toBe(14);
  });

  it("counts both ends, and nothing for a bad period", () => {
    expect(periodDays("2026-12-01", "2026-12-01")).toBe(1);
    expect(periodDays("2026-12-01", "2026-12-20")).toBe(20);
    expect(periodDays("2026-12-20", "2026-12-01")).toBe(0);
    expect(periodDays("x", "2026-12-01")).toBe(0);
  });
});

describe("texts", () => {
  it("writes the period short", () => {
    expect(periodLabel("2026-12-01", "2026-12-20")).toBe("1.–20.12.");
    expect(periodLabel("2026-11-28", "2026-12-05")).toBe("28.11.–5.12.");
    expect(periodLabel("2026-12-28", "2027-01-05")).toBe("28.12.2026–5.1.2027");
    expect(periodLabel("2026-12-05", "2026-12-05")).toBe("5.12.");
  });

  it("names the people with du first and und before the last", () => {
    expect(peopleLabel([])).toBe("du");
    expect(peopleLabel(["Lena"])).toBe("du und Lena");
    expect(peopleLabel(["Lena", "Emil", "Jonas"])).toBe("du, Lena, Emil und Jonas");
  });

  it("makes the summary line", () => {
    expect(nightSummary("2026-12-01", "2026-12-20", ["Lena", "Emil", "Jonas"])).toBe("1.–20.12. · du, Lena, Emil und Jonas");
  });

  it("tells how many days were fetched, with the right singular and plural", () => {
    expect(fetchedDaysLine(14, 20)).toBe("Spielzeiten für 14 von 20 Tagen geholt (an 6 Tagen haben nicht alle 1½ Stunden am Stück frei).");
    expect(fetchedDaysLine(19, 20)).toBe("Spielzeiten für 19 von 20 Tagen geholt (an 1 Tag haben nicht alle 1½ Stunden am Stück frei).");
    expect(fetchedDaysLine(1, 20)).toContain("für 1 von 20 Tagen geholt");
    expect(fetchedDaysLine(1, 1)).toBe("Spielzeiten für 1 von 1 Tag geholt.");
  });

  it("leaves the bracket out when every day counts", () => {
    expect(fetchedDaysLine(20, 20)).toBe("Spielzeiten für 20 von 20 Tagen geholt.");
  });
});

describe("nightChoice", () => {
  it("remembers the choices of step 1 as a copy", () => {
    nightChoice.clear();
    expect(nightChoice.get()).toBeNull();
    const people = [2];
    nightChoice.set({ people, from: "2026-12-01", to: "2026-12-05", cinemaIds: [7] });
    people.push(3);
    const got = nightChoice.get();
    expect(got).toEqual({ people: [2], from: "2026-12-01", to: "2026-12-05", cinemaIds: [7] });
    got!.cinemaIds.push(8);
    expect(nightChoice.get()!.cinemaIds).toEqual([7]);
    nightChoice.clear();
  });
});
