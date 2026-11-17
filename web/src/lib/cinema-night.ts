import type { SearchRequest } from "@lueckenfueller/shared";
import { addDays } from "./gap-search";

// The own cinema-night flow of admins (phase 10d): who, which period, which cinemas; then the free times of everybody
// are searched without a daily time window. No DOM here.

/** The showtimes interface of the server answers days up to this many days ahead (`SHOWTIMES_DAYS_AHEAD`). */
export const CINEMA_NIGHT_MAX_DAYS_AHEAD = 60;
/** The shortest free time a day needs to count: film plus adverts rarely fit in less. */
export const CINEMA_NIGHT_MIN_MINUTES = 90;
/** The whole day but its last quarter hour: a time before 05:00 belongs to the night before (as `NIGHT_END_MINUTES` in `cinema.ts`). The server takes only quarter hours and refuses start = end, so 04:45 is the latest end. */
export const CINEMA_NIGHT_WINDOW = { start: "05:00", end: "04:45" } as const;
/** The period offered at first: today and the 13 days after it. */
export const CINEMA_NIGHT_DEFAULT_DAYS = 14;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  const m = DATE.exec(date);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // A day that does not exist ("2026-02-31") rolls over into the next month: refuse it.
  return new Date(ms).toISOString().slice(0, 10) === date ? ms / DAY_MS : null;
}

/** How many days the period has, both ends included; 0 when a date is unreadable or the end is before the start. */
export function periodDays(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null || b < a ? 0 : b - a + 1;
}

export type PeriodProblem = "dates_missing" | "in_the_past" | "to_before_from" | "too_far_ahead";

export const PERIOD_PROBLEM_TEXTS: Record<PeriodProblem, string> = {
  dates_missing: "Wähle den Zeitraum mit „Von“ und „Bis“.",
  in_the_past: "Der Zeitraum darf nicht in der Vergangenheit beginnen.",
  to_before_from: "„Bis“ darf nicht vor „Von“ liegen.",
  too_far_ahead: `Die Spielzeiten reichen höchstens ${CINEMA_NIGHT_MAX_DAYS_AHEAD} Tage im Voraus. Wähle ein früheres „Bis“.`,
};

/** The first thing that is wrong with the period, or null. Today is allowed; so is the last day 60 days ahead. */
export function checkPeriod(from: string, to: string, today: string): PeriodProblem | null {
  if (dayNumber(from) === null || dayNumber(to) === null) return "dates_missing";
  if (from < today) return "in_the_past";
  if (to < from) return "to_before_from";
  if (to > addDays(today, CINEMA_NIGHT_MAX_DAYS_AHEAD)) return "too_far_ahead";
  return null;
}

/** Today up to 13 days later, but never beyond the showtimes limit. */
export function defaultPeriod(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, CINEMA_NIGHT_DEFAULT_DAYS - 1) };
}

/** The hours search of the flow: every weekday, the whole day, at least 90 minutes in a row, no buffer. */
export function cinemaNightRequest(people: readonly number[], from: string, to: string): SearchRequest {
  return {
    mode: "hours",
    people: [...people],
    from,
    to,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    durationMinutes: CINEMA_NIGHT_MIN_MINUTES,
    window: { ...CINEMA_NIGHT_WINDOW },
    bufferMinutes: 0,
  };
}

// ---------- texts ----------

/** "1.–20.12." / "28.11.–5.12." / "28.12.2026–5.1.2027" / "5.12." for one day. */
export function periodLabel(from: string, to: string): string {
  const a = DATE.exec(from);
  const b = DATE.exec(to);
  if (!a || !b) return `${from}–${to}`;
  const [ay, am, ad] = [Number(a[1]), Number(a[2]), Number(a[3])];
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  if (from === to) return `${ad}.${am}.`;
  if (ay !== by) return `${ad}.${am}.${ay}–${bd}.${bm}.${by}`;
  if (am === bm) return `${ad}.–${bd}.${bm}.`;
  return `${ad}.${am}.–${bd}.${bm}.`;
}

/** "du", "du und Lena", "du, Lena und Emil": the person themselves first. */
export function peopleLabel(otherNames: readonly string[]): string {
  const all = ["du", ...otherNames];
  return all.length === 1 ? "du" : `${all.slice(0, -1).join(", ")} und ${all[all.length - 1]}`;
}

/** The line of the summary card in the flow: "1.–20.12. · du, Lena, Emil und Jonas". */
export function nightSummary(from: string, to: string, otherNames: readonly string[]): string {
  return `${periodLabel(from, to)} · ${peopleLabel(otherNames)}`;
}

const daysWord = (n: number): string => (n === 1 ? "Tag" : "Tagen");

/** "Spielzeiten für 14 von 20 Tagen geholt (an 6 Tagen haben nicht alle 1½ Stunden am Stück frei)."; no bracket when all days count. */
export function fetchedDaysLine(fetched: number, total: number): string {
  const missing = total - fetched;
  const base = `Spielzeiten für ${fetched} von ${total} ${daysWord(total)} geholt`;
  return missing > 0 ? `${base} (an ${missing} ${daysWord(missing)} haben nicht alle 1½ Stunden am Stück frei).` : `${base}.`;
}

// ---------- what step 1 remembers ----------

/** The choices of step 1. */
export interface NightChoice {
  people: number[];
  from: string;
  to: string;
  cinemaIds: number[];
}

let remembered: NightChoice | null = null;

/** Keeps the choices while the person is in step 2 or 3, so "Andere Kinos wählen" finds them again (a reload forgets them). */
export const nightChoice = {
  get(): NightChoice | null {
    return remembered === null ? null : { ...remembered, people: [...remembered.people], cinemaIds: [...remembered.cinemaIds] };
  },
  set(choice: NightChoice): void {
    remembered = { ...choice, people: [...choice.people], cinemaIds: [...choice.cinemaIds] };
  },
  clear(): void {
    remembered = null;
  },
};
