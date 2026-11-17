import type { CinemaShowing } from "@lueckenfueller/shared";
import { addDays, clockToMinutes } from "./gap-search";
import { ADVERT_MINUTES_DEFAULT, FILM_MINUTES_DEFAULT, checkShowings, hoursMinutesLabel, type CheckedShowing } from "./cinema";
import { berlinParts, type CinemaSource } from "./poll-draft";

// Choosing a film from the showings of several cinemas (phase 10d, variant B). No DOM here.

/** The most requests to cineamo (through the server) in flight at once. */
export const FETCH_PARALLEL = 3;

/** A clock before this belongs to the night after the chosen day. */
const NIGHT_END_MINUTES = 5 * 60;

/** The searched days with a free time for everyone: the only days whose showings are fetched. */
export function daysToFetch(source: CinemaSource): string[] {
  return source.days.filter((d) => d.slots.length > 0).map((d) => d.date).sort();
}

/** Runs the jobs with at most `limit` at a time; the results are in the order of the jobs. A job must not throw. */
export async function runLimited<T>(jobs: readonly (() => Promise<T>)[], limit: number = FETCH_PARALLEL): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), jobs.length) }, worker));
  return results;
}

/** One showing in one of the ticked cinemas, with the evening it belongs to. */
export interface FilmShowing {
  cinemaId: number;
  cinemaName: string;
  /** "YYYY-MM-DD", the day the evening belongs to */
  day: string;
  /** "HH:MM" Berlin time */
  clock: string;
  showing: CinemaShowing;
}

/** The showings of the evening of `day` (Berlin time; before 05:00 belongs to the evening before) at one cinema. */
export function eveningShowings(cinema: { id: number; name: string }, day: string, showings: readonly CinemaShowing[]): FilmShowing[] {
  const nextDay = addDays(day, 1);
  const result: FilmShowing[] = [];
  for (const showing of showings) {
    if (Number.isNaN(Date.parse(showing.start))) continue;
    const { date, time } = berlinParts(showing.start);
    const minutes = clockToMinutes(time);
    if ((date === day && minutes >= NIGHT_END_MINUTES) || (date === nextDay && minutes < NIGHT_END_MINUTES)) {
      result.push({ cinemaId: cinema.id, cinemaName: cinema.name, day, clock: time, showing });
    }
  }
  return result;
}

// ---------- languages ----------

const LANGUAGE_NAMES: Record<string, string> = {
  deu: "Deutsch",
  eng: "Englisch",
  fra: "Französisch",
  spa: "Spanisch",
  ita: "Italienisch",
  jpn: "Japanisch",
  kor: "Koreanisch",
  tur: "Türkisch",
  por: "Portugiesisch",
  rus: "Russisch",
  pol: "Polnisch",
  nld: "Niederländisch",
  swe: "Schwedisch",
  dan: "Dänisch",
  nor: "Norwegisch",
  fin: "Finnisch",
  hin: "Hindi",
  zho: "Chinesisch",
};

const LANGUAGE_SHORT: Record<string, string> = { deu: "DE", eng: "EN", fra: "FR", spa: "ES", ita: "IT", jpn: "JA", kor: "KO", tur: "TR", por: "PT", rus: "RU", pol: "PL", nld: "NL", swe: "SV", dan: "DA", nor: "NO", fin: "FI", hin: "HI", zho: "ZH" };

const norm = (code: string | undefined): string => (code ?? "").trim().toLowerCase();

/** Whether the showing is in the film's original language; false when either is unknown. */
export function isOriginalVersion(language: string | undefined, originalLanguage: string | undefined): boolean {
  const l = norm(language);
  return l !== "" && l === norm(originalLanguage);
}

/** "Deutsch", "OV Englisch" (original version), "Englisch" (another language); null when the language is unknown. A German original is just "Deutsch". */
export function versionLabel(language: string | undefined, originalLanguage: string | undefined): string | null {
  const l = norm(language);
  if (l === "") return null;
  const name = LANGUAGE_NAMES[l] ?? l.toUpperCase();
  return isOriginalVersion(language, originalLanguage) && l !== "deu" ? `OV ${name}` : name;
}

/** The short chip of a showing: "DE", "OV EN", "EN"; null when the language is unknown. */
export function versionShort(language: string | undefined, originalLanguage: string | undefined): string | null {
  const l = norm(language);
  if (l === "") return null;
  const short = LANGUAGE_SHORT[l] ?? l.toUpperCase();
  return isOriginalVersion(language, originalLanguage) && l !== "deu" ? `OV ${short}` : short;
}

// ---------- films ----------

export interface Film {
  /** `c:<contentId>`, or `n:<cinema id>|<name>` for a showing without a content id (never merged across cinemas). */
  key: string;
  /** The most frequent name of its showings (tie: the shortest, then alphabetical). */
  title: string;
  names: string[];
  movieId?: number;
  /** Distinct version labels, "Deutsch" first. */
  versions: string[];
  /** The ticked cinemas that show it. */
  cinemaIds: number[];
  showings: FilmShowing[];
}

/** The most frequent name; a tie goes to the shortest, then to the alphabetically first. */
export function chooseTitle(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = raw.trim();
    if (name !== "") counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], "de"));
  return sorted[0]?.[0] ?? "";
}

const filmKeyOf = (s: FilmShowing): string => (s.showing.contentId !== undefined ? `c:${s.showing.contentId}` : `n:${s.cinemaId}|${s.showing.film.trim().toLowerCase()}`);

/** Groups showings into films by `contentId` only, never by name. A showing without one is its own film per cinema and name. */
export function groupFilms(showings: readonly FilmShowing[]): Film[] {
  const groups = new Map<string, FilmShowing[]>();
  for (const s of showings) {
    const key = filmKeyOf(s);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const names = [...new Set(list.map((s) => s.showing.film.trim()).filter((n) => n !== ""))].sort((a, b) => a.localeCompare(b, "de"));
    const versions = new Set<string>();
    for (const s of list) {
      const label = versionLabel(s.showing.language, s.showing.originalLanguage);
      if (label !== null) versions.add(label);
    }
    const movieId = list.find((s) => s.showing.movieId !== undefined)?.showing.movieId;
    return {
      key,
      title: chooseTitle(list.map((s) => s.showing.film)),
      names,
      ...(movieId !== undefined ? { movieId } : {}),
      versions: [...versions].sort((a, b) => Number(b === "Deutsch") - Number(a === "Deutsch") || a.localeCompare(b, "de")),
      cinemaIds: [...new Set(list.map((s) => s.cinemaId))],
      showings: list,
    };
  });
}

// ---------- the fitting count and the list ----------

export interface FitContext {
  source: CinemaSource;
  /** Minutes by cineamo movie id; a missing id (not loaded, failed, unknown) means the default length. */
  runtimes: Readonly<Record<number, number | undefined>>;
  advertMinutes?: number;
  now: Date;
}

/** The length used for a film in the list: cineamo's runtime, else the default. */
export function filmMinutesOf(film: Film, runtimes: FitContext["runtimes"]): number {
  const runtime = film.movieId !== undefined ? runtimes[film.movieId] : undefined;
  return runtime !== undefined && runtime > 0 ? runtime : FILM_MINUTES_DEFAULT;
}

/** The showings of a film checked against the free times, with the language chip and screen of each by key. */
export function checkFilm(film: Film, context: { source: CinemaSource; filmMinutes: number; advertMinutes: number; now: Date }): { checked: CheckedShowing[]; info: Map<string, { chip: string | null; room?: string }> } {
  const sorted = [...film.showings].sort((a, b) => Date.parse(a.showing.start) - Date.parse(b.showing.start));
  const checked = checkShowings(
    sorted.map((s) => ({ place: s.cinemaName, day: s.day, clock: s.clock })),
    context,
  );
  const info = new Map<string, { chip: string | null; room?: string }>();
  for (const s of sorted) {
    const found = checked.find((c) => c.place.toLowerCase() === s.cinemaName.trim().toLowerCase() && c.day === s.day && c.clock === s.clock);
    if (!found || info.has(found.key)) continue;
    const room = s.showing.room?.trim();
    info.set(found.key, { chip: versionShort(s.showing.language, s.showing.originalLanguage), ...(room ? { room } : {}) });
  }
  return { checked, info };
}

export interface FilmCard {
  film: Film;
  /** The length used for the count. */
  minutes: number;
  fitting: number;
  /** "läuft in 2 von 3 Kinos" */
  cinemaCount: number;
}

/** "2 Std. 39 Min." for a known runtime, else null. */
export function knownLength(film: Film, runtimes: FitContext["runtimes"]): string | null {
  const runtime = film.movieId !== undefined ? runtimes[film.movieId] : undefined;
  return runtime !== undefined && runtime > 0 ? hoursMinutesLabel(runtime) : null;
}

/** The films that match the search text (case-insensitive, any name of the film), the fitting ones first (most, then title), the rest by title. */
export function rankFilms(films: readonly Film[], context: FitContext, query = ""): FilmCard[] {
  const q = query.trim().toLowerCase();
  const advertMinutes = context.advertMinutes ?? ADVERT_MINUTES_DEFAULT;
  return films
    .filter((f) => q === "" || f.names.some((n) => n.toLowerCase().includes(q)))
    .map((film) => {
      const minutes = filmMinutesOf(film, context.runtimes);
      const fitting = checkFilm(film, { source: context.source, filmMinutes: minutes, advertMinutes, now: context.now }).checked.filter((c) => c.fits).length;
      return { film, minutes, fitting, cinemaCount: film.cinemaIds.length };
    })
    .sort((a, b) => Number(b.fitting > 0) - Number(a.fitting > 0) || b.fitting - a.fitting || a.film.title.localeCompare(b.film.title, "de"));
}

/** "5 passende Vorstellungen" / "1 passende Vorstellung". */
export const fittingLabel = (n: number): string => `${n} passende ${n === 1 ? "Vorstellung" : "Vorstellungen"}`;
