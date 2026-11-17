import type { CinemaShowing, CreatePollRequest, Person, SearchResult, Slot } from "@lueckenfueller/shared";
import { addDays, clockToMinutes, formatClock, formatDay, formatSlot } from "./gap-search";
import { DRAFT_PROBLEM_TEXTS, berlinParts, berlinWallToInstant, buildCreateRequest, type CinemaSource, type DraftProblem } from "./poll-draft";

// The cinema entry of a poll (phase 10d): showings typed in by hand are checked against the free times of an
// hours search. No DOM here.

const MINUTE_MS = 60_000;
/** A clock before this belongs to the night after the chosen day. */
const NIGHT_END_MINUTES = 5 * 60;

export const FILM_MINUTES_DEFAULT = 120;
export const ADVERT_MINUTES_DEFAULT = 20;

const range = (from: number, to: number, step: number): number[] => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
/** 60 to 240 minutes in steps of 5. */
export const FILM_MINUTES_OPTIONS = range(60, 240, 5);
/** 0 to 45 minutes in steps of 5. */
export const ADVERT_MINUTES_OPTIONS = range(0, 45, 5);

const pad = (n: number): string => String(n).padStart(2, "0");

// ---------- showtimes from text ----------

/**
 * The times in a text ("17:30", "9:05", "20.15", "20:15 Uhr"), separated by anything; impossible ones (24:00, 12:60)
 * and parts of longer numbers or dates ("12.12.2026") are ignored. Unique "HH:MM", in the order of an evening:
 * times before 05:00 come after all others.
 */
export function parseShowtimes(text: string): string[] {
  const found = new Map<string, number>();
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,2})[:.](\d{2})(?![\d]|[:.]\d)/g)) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) continue;
    found.set(`${pad(hour)}:${pad(minute)}`, hour * 60 + minute);
  }
  const key = (minutes: number): number => (minutes < NIGHT_END_MINUTES ? minutes + 1440 : minutes);
  return [...found.entries()].sort((a, b) => key(a[1]) - key(b[1])).map(([clock]) => clock);
}

// ---------- showings fetched from the server (admin-only test) ----------

export interface FetchedFilm {
  /** Film name and language code. */
  key: string;
  film: string;
  /** null for German or unknown; "Englisch" for `eng`; otherwise the code in capitals. */
  languageLabel: string | null;
  /** "HH:MM" in the order of an evening (times before 05:00 last). */
  clocks: string[];
}

export function languageLabel(code: string | undefined): string | null {
  const c = (code ?? "").trim().toLowerCase();
  if (c === "" || c === "deu") return null;
  return c === "eng" ? "Englisch" : c.toUpperCase();
}

/** The films shown on the evening of `day` (Berlin time; the night before 05:00 belongs to the evening before), by film and language.
 * With `room`, only showings in that screen are kept (compared trimmed and ignoring case); showings without a screen name are dropped. */
export function filmsOfEvening(showings: readonly CinemaShowing[], day: string, room?: string): FetchedFilm[] {
  const nextDay = addDays(day, 1);
  const wanted = room?.trim().toLowerCase();
  const groups = new Map<string, { film: string; language: string; clocks: Set<string> }>();
  for (const showing of showings) {
    if (Number.isNaN(Date.parse(showing.start))) continue;
    if (wanted !== undefined && showing.room?.trim().toLowerCase() !== wanted) continue;
    const { date, time } = berlinParts(showing.start);
    const minutes = clockToMinutes(time);
    const inEvening = (date === day && minutes >= NIGHT_END_MINUTES) || (date === nextDay && minutes < NIGHT_END_MINUTES);
    if (!inEvening) continue;
    // German and unknown share a group: both read the same in the list.
    const language = languageLabel(showing.language) ?? "";
    const key = `${showing.film}|${language}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { film: showing.film, language, clocks: new Set() }));
    group.clocks.add(time);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, film: g.film, language: g.language, languageLabel: g.language === "" ? null : g.language, clocks: parseShowtimes([...g.clocks].join(" ")) }))
    .sort((a, b) => a.film.localeCompare(b.film, "de") || a.language.localeCompare(b.language))
    .map(({ key, film, languageLabel: label, clocks }) => ({ key, film, languageLabel: label, clocks }));
}

// ---------- checking showings ----------

export interface ShowingInput {
  place: string;
  /** "YYYY-MM-DD", the day the evening belongs to */
  day: string;
  /** "HH:MM"; before 05:00 it is the night after `day` */
  clock: string;
}

export interface CheckedShowing {
  /** Same place and start give the same key. */
  key: string;
  place: string;
  day: string;
  clock: string;
  /** Instants (`toISOString()`); the end includes the advert buffer. */
  start: string;
  end: string;
  fits: boolean;
  reason: string;
}

export interface CheckContext {
  source: CinemaSource;
  filmMinutes: number;
  advertMinutes: number;
  now: Date;
}

/** Start of a showing: a clock before 05:00 is on the calendar day after `day`. */
export function showingStart(day: string, clock: string): Date | null {
  const date = /^\d{2}:\d{2}$/.test(clock) && clockToMinutes(clock) < NIGHT_END_MINUTES ? addDays(day, 1) : day;
  return berlinWallToInstant(date, clock);
}

/** "Lena", "Lena und Emil", "Lena, Emil und Jonas"; unknown people are "jemand". */
function nameList(ids: readonly number[], names: Record<number, string>): { text: string; count: number } {
  const list = ids.flatMap((id) => names[id] ?? []);
  if (list.length < ids.length) list.push("jemand");
  const text = list.length <= 1 ? (list[0] ?? "jemand") : `${list.slice(0, -1).join(", ")} und ${list[list.length - 1]}`;
  return { text, count: list.length };
}

const toMs = (iso: string): number => Date.parse(iso);

/** Whether [start, end] lies within one of the slots. */
const within = (slots: readonly Slot[], start: number, end: number): boolean => slots.some((s) => start >= toMs(s.start) && end <= toMs(s.end));

/** The showings with start, end and whether they fit. Duplicates (same place and start) appear once. */
export function checkShowings(showings: readonly ShowingInput[], context: CheckContext): CheckedShowing[] {
  const { source, filmMinutes, advertMinutes, now } = context;
  const free = source.days.flatMap((d) => d.slots);
  const result: CheckedShowing[] = [];
  const seen = new Set<string>();
  const wraps = clockToMinutes(source.window.end) <= clockToMinutes(source.window.start);
  for (const input of showings) {
    const startDate = showingStart(input.day, input.clock);
    if (startDate === null) continue;
    const place = input.place.trim();
    const key = `${place.toLowerCase()}|${startDate.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = startDate.getTime();
    const end = start + (advertMinutes + filmMinutes) * MINUTE_MS;
    const make = (fits: boolean, reason: string): CheckedShowing => ({
      key,
      place,
      day: input.day,
      clock: input.clock,
      start: startDate.toISOString(),
      end: new Date(end).toISOString(),
      fits,
      reason,
    });
    if (start <= now.getTime()) {
      result.push(make(false, "liegt in der Vergangenheit"));
      continue;
    }
    if (input.day < source.from || input.day > source.to) {
      result.push(make(false, "Tag liegt nicht im Suchzeitraum"));
      continue;
    }
    if (within(free, start, end)) {
      result.push(make(true, "alle haben Zeit"));
      continue;
    }
    const windowStart = berlinWallToInstant(input.day, source.window.start)?.getTime();
    const windowEnd = berlinWallToInstant(wraps ? addDays(input.day, 1) : input.day, source.window.end)?.getTime();
    if (windowStart !== undefined && start < windowStart) {
      result.push(make(false, `beginnt vor ${source.window.start} Uhr`));
      continue;
    }
    if (windowEnd !== undefined && end > windowEnd) {
      result.push(make(false, `endet nach ${source.window.end} Uhr`));
      continue;
    }
    const partial = source.partial.find((p) => within(p.slots, start, end));
    if (partial) {
      const { text, count } = nameList(partial.missingPersonIds, source.names);
      result.push(make(false, `${text} ${count === 1 ? "hat" : "haben"} da keine Zeit`));
      continue;
    }
    const overlap = free.find((s) => toMs(s.start) < end && toMs(s.end) > start);
    if (overlap) {
      result.push(make(false, start < toMs(overlap.start) ? `alle frei erst ab ${formatClock(overlap.start)} Uhr` : `alle frei nur bis ${formatClock(overlap.end)} Uhr`));
      continue;
    }
    result.push(make(false, "an dem Tag haben nicht alle Zeit"));
  }
  return result;
}

/** "Sa 12.12., alle frei 18:00–23:00 Uhr" / "Sa 12.12.: keine Zeit, in der alle frei sind". */
export function freeTimeSummary(source: CinemaSource, day: string): string {
  const slots = source.days.filter((d) => d.date === day).flatMap((d) => d.slots);
  if (slots.length === 0) return `${formatDay(day)}: keine Zeit, in der alle frei sind`;
  return `${formatDay(day)}, alle frei ${slots.map(formatSlot).join(" und ")} Uhr`;
}

/** The days of the entered showings, once each, in order of the days. */
export function summaryLines(source: CinemaSource, days: readonly string[]): string[] {
  return [...new Set(days)].sort().map((day) => freeTimeSummary(source, day));
}

/** Showings grouped by day, then by place (first appearance); each group by start. */
export function groupShowings(showings: readonly CheckedShowing[]): { key: string; day: string; place: string; items: CheckedShowing[] }[] {
  const groups: { key: string; day: string; place: string; items: CheckedShowing[] }[] = [];
  for (const showing of showings) {
    const key = `${showing.day}|${showing.place.toLowerCase()}`;
    let group = groups.find((g) => g.key === key);
    if (!group) groups.push((group = { key, day: showing.day, place: showing.place, items: [] }));
    group.items.push(showing);
  }
  for (const group of groups) group.items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return groups.map((g, i) => ({ g, i })).sort((a, b) => (a.g.day < b.g.day ? -1 : a.g.day > b.g.day ? 1 : a.i - b.i)).map(({ g }) => g);
}

/**
 * The showings of the check list: by default only those that fit (they stay in their order, so "weggelassen" ones are
 * still listed); with `showAll` the ones that do not fit appear in their place. `notFitting` is how many do not fit.
 */
export function visibleShowings<T extends { fits: boolean }>(showings: readonly T[], showAll: boolean): { shown: T[]; fitting: number; notFitting: number } {
  const fitting = showings.filter((s) => s.fits).length;
  return { shown: showAll ? [...showings] : showings.filter((s) => s.fits), fitting, notFitting: showings.length - fitting };
}

/** The first searched day with a free time for everyone, or the first searched day. */
export function defaultCinemaDay(source: CinemaSource): string {
  const days = source.days.filter((d) => d.slots.length > 0).map((d) => d.date).sort();
  return days[0] ?? source.from;
}

// ---------- texts ----------

/** "130 Min." */
export const minutesLabel = (minutes: number): string => `${minutes} Min.`;

/** "3 Std.", "2 Std. 30 Min.", "45 Min." */
export function hoursMinutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

/** The hint for a search for longer free times than film plus advert, or null when the search was not too long. */
export function shortSearchHint(searchedMinutes: number, filmMinutes: number, advertMinutes: number): string | null {
  const needed = filmMinutes + advertMinutes;
  if (searchedMinutes <= needed) return null;
  return `Ihr habt nach freien Zeiten ab ${hoursMinutesLabel(searchedMinutes)} gesucht. Kürzere Lücken, in die der Film passt (${hoursMinutesLabel(needed)}), fehlen deshalb. Such dafür mit kürzerer Dauer.`;
}

/** The label of the submit button. */
export function cinemaSubmitLabel(count: number): string {
  return count === 1 ? "Abstimmung mit 1 Termin erstellen" : `Abstimmung mit ${count} Terminen erstellen`;
}

// ---------- the request ----------

export type CinemaProblem = DraftProblem | "place_missing";

export const CINEMA_PROBLEM_TEXTS: Record<CinemaProblem, string> = {
  ...DRAFT_PROBLEM_TEXTS,
  no_items: "Es ist keine passende Vorstellung ausgewählt. Gib Kino, Tag und Zeiten an.",
  place_missing: "Bitte gib das Kino an.",
};

export interface CinemaDraft {
  title: string;
  note: string;
  deadlineDate: string;
  deadlineTime: string;
  hidden?: boolean;
  participants: number[];
  /** The showings that become proposals (the screen passes the chosen, fitting ones). */
  showings: readonly CheckedShowing[];
}

export type CinemaCheck = { ok: true; request: CreatePollRequest } | { ok: false; problem: CinemaProblem; itemId?: string };

/** The request for the server: a timed poll with a place on every proposal. */
export function cinemaRequest(draft: CinemaDraft, now: Date = new Date()): CinemaCheck {
  const check = buildCreateRequest(
    {
      title: draft.title,
      note: draft.note,
      deadlineDate: draft.deadlineDate,
      deadlineTime: draft.deadlineTime,
      participants: draft.participants,
      ...(draft.hidden === true ? { hidden: true } : {}),
      items: draft.showings.map((s) => ({
        kind: "timed" as const,
        id: s.key,
        label: `${s.clock}`,
        gap: { start: s.start, end: s.end },
        start: s.start,
        end: s.end,
        place: s.place,
      })),
    },
    now,
  );
  if (!check.ok) return check;
  const missing = draft.showings.find((s) => s.place.trim() === "");
  if (missing) return { ok: false, problem: "place_missing", itemId: missing.key };
  return check;
}

// ---------- the handover from the search ----------

/** What the search hands over for the cinema entry: the whole hours result and what was searched. */
export function cinemaSourceOf(
  result: SearchResult,
  searched: { from: string; to: string; window: { start: string; end: string }; durationMinutes: number },
  people: readonly Pick<Person, "id" | "username">[],
): CinemaSource | null {
  if (result.mode !== "hours") return null;
  const partial =
    result.partial ?? result.nearMisses.map((n) => ({ date: n.date, missingPersonIds: [n.missingPersonId], slots: n.slots }));
  return {
    days: result.days.map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ start: s.start, end: s.end })) })),
    partial: partial.map((p) => ({ date: p.date, missingPersonIds: [...p.missingPersonIds], slots: p.slots.map((s) => ({ start: s.start, end: s.end })) })),
    window: { start: searched.window.start, end: searched.window.end },
    from: searched.from,
    to: searched.to,
    durationMinutes: searched.durationMinutes,
    names: Object.fromEntries(people.map((p) => [p.id, p.username])),
  };
}
