// The gap search: finding times when everyone chosen is free. Nothing is stored; a search is one request and
// one answer. All dates and times of the request are German time (Europe/Berlin), all instants in the answer
// are UTC. The server never sends titles or any other detail of a calendar, only times and person ids.

/** At most this many people per search, including the person searching. */
export const SEARCH_MAX_PEOPLE = 50;
/** `from` to `to` (both included) covers at most this many days. */
export const SEARCH_MAX_RANGE_DAYS = 366;
/** Longest free time that can be asked for in hours mode. */
export const SEARCH_MAX_DURATION_MINUTES = 24 * 60;
/** Longest buffer before and after an event (travel time). */
export const SEARCH_MAX_BUFFER_MINUTES = 120;
/** Longest multi-day period. */
export const SEARCH_MAX_PERIOD_DAYS = 31;
/** The time window of an hours search that names none. */
export const SEARCH_DEFAULT_WINDOW = { start: "09:00", end: "23:00" } as const;
/** Searches per person and 15 minutes (every search counts, not only failed ones). */
export const SEARCHES_PER_USER = 30;
/** Near misses are only looked for with at least this many readable people. */
export const NEAR_MISS_MIN_PEOPLE = 3;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One person with an account, as offered for choosing whom to search with. Nothing else about them. */
export interface Person {
  id: number;
  username: string;
  seedColor: string | null;
}

/** `GET /api/people`: everyone with an account, the caller included, sorted by username without regard to case. */
export interface PeopleList {
  people: Person[];
}

/** "HH:MM" with minutes 00, 15, 30 or 45 and hours 00–23. */
export interface TimeWindow {
  start: string;
  end: string;
}

interface SearchBase {
  /** Other people's ids. The caller is always searched too (their own id here is ignored); duplicates are ignored. */
  people: number[];
  /** First and last German calendar day of the range, "YYYY-MM-DD", both included. */
  from: string;
  to: string;
}

/** Free times of a given length on certain weekdays. */
export interface HoursSearchRequest extends SearchBase {
  mode: "hours";
  /** At least one; duplicates are ignored. */
  weekdays: Weekday[];
  /** A multiple of 30, from 30 to `SEARCH_MAX_DURATION_MINUTES`, and not longer than the window. */
  durationMinutes: number;
  /** Default `SEARCH_DEFAULT_WINDOW`. An end at or before the start means it ends the next day; start = end is invalid. */
  window?: TimeWindow;
  /** Kept free before and after every busy event. A multiple of 15, 0 to `SEARCH_MAX_BUFFER_MINUTES`; default 0. */
  bufferMinutes?: number;
}

/** Several free days in a row. A day is free when nobody has any busy event on it. */
export interface DaysSearchRequest extends SearchBase {
  mode: "days";
  /** Length of the period, 1 to `SEARCH_MAX_PERIOD_DAYS`. */
  days: number;
  /** The period has to start on this weekday. */
  startWeekday?: Weekday;
}

/** `POST /api/searches` → `SearchResult` (200). Nothing is stored. */
export type SearchRequest = HoursSearchRequest | DaysSearchRequest;

/** A free time: ISO 8601, UTC, end exclusive. */
export interface Slot {
  start: string;
  end: string;
}

/** Hours mode: one entry per German day (the day a window starts) that has free times. */
export interface HoursDay {
  /** "YYYY-MM-DD" */
  date: string;
  slots: Slot[];
}

/** Hours mode: free times for everyone but one person. */
export interface HoursNearMiss {
  date: string;
  missingPersonId: number;
  slots: Slot[];
}

/** Days mode: a run of consecutive free days, "YYYY-MM-DD", both ends included. */
export interface Stretch {
  first: string;
  last: string;
  /** `last` − `first` + 1 */
  days: number;
  /** Only with `startWeekday`: the days of this stretch on which a whole period can start, ascending. */
  starts?: string[];
}

/** Days mode: a stretch that is free for everyone but one person. */
export interface StretchNearMiss extends Stretch {
  missingPersonId: number;
}

/**
 * Why somebody was left out of the search: `no_calendar` (no calendar linked) or `unreadable` (a calendar is
 * broken, unreachable or was too large to be read completely). A person who is left out never counts as free.
 */
export type SkipReason = "no_calendar" | "unreadable";

export interface SkippedPerson {
  personId: number;
  reason: SkipReason;
}

/** The answer to a search; `skipped` lists everybody who was not taken into account. */
export type SearchResult =
  | { mode: "hours"; skipped: SkippedPerson[]; days: HoursDay[]; nearMisses: HoursNearMiss[] }
  | { mode: "days"; skipped: SkippedPerson[]; stretches: Stretch[]; nearMisses: StretchNearMiss[] };
