// Calendars linked through their subscription link (ICS). The link itself never leaves the server: the API
// only ever shows the provider and the name.

/** At most this many calendars per person. */
export const CALENDARS_PER_USER = 10;
/** Longest calendar name, in characters. */
export const CALENDAR_NAME_MAX_LENGTH = 60;
/** Longest subscription link the server accepts, in characters. */
export const CALENDAR_LINK_MAX_LENGTH = 2048;
/** The preview of one's own busy times covers this many days from today. */
export const CALENDAR_PREVIEW_DAYS = 28;

/** Who serves the calendar, told from the link's host name. */
export type CalendarProvider = "google" | "apple" | "outlook" | "other";

/**
 * - `ok`: the last fetch worked, or none was needed yet.
 * - `broken`: the provider said the calendar is gone (e.g. Google's secret address was reset). The person has
 *   to enter the link again; nothing is deleted on its own.
 */
export type CalendarStatus = "ok" | "broken";

/** One of the caller's own calendars (`GET /api/calendars`). */
export interface Calendar {
  id: number;
  name: string;
  provider: CalendarProvider;
  /** Events of this calendar count as busy (switched off e.g. for a birthday calendar). */
  countsAsBusy: boolean;
  /** Decides which "add to calendar" button the person sees first. Exactly one calendar is the default. */
  isDefault: boolean;
  status: CalendarStatus;
  createdAt: string;
}

/**
 * Whether calendars can be used at all on this server. `unavailable` when the server has no (or the wrong)
 * key for the stored links; the app then explains that the admin has to finish the setup.
 */
export type CalendarsState = "ready" | "unavailable";

/** `GET /api/calendars` */
export interface CalendarList {
  state: CalendarsState;
  calendars: Calendar[];
}

/** `POST /api/calendars` → `Calendar` (201). The link is tried at once and only stored when it works. */
export interface AddCalendarRequest {
  /** `https://…` or `webcal://…` */
  link: string;
  /** Optional; without it the calendar's own name from the feed is used, or the provider's name. */
  name?: string;
}

/** `PATCH /api/calendars/:id` → `Calendar`. Every field is optional. */
export interface UpdateCalendarRequest {
  name?: string;
  countsAsBusy?: boolean;
  /** Only `true` is accepted: another calendar becomes the default by being chosen. */
  isDefault?: true;
  /** A new link for the same calendar ("Link neu eintragen"); tried at once like a new one. */
  link?: string;
}

/** One event in the preview. Only the calendar's owner ever gets titles; they are never stored. */
export interface PreviewEvent {
  calendarId: number;
  title: string;
  /** ISO 8601, UTC. For all-day events: 00:00 German time of the first day. */
  start: string;
  /** ISO 8601, UTC, exclusive. For all-day events: 00:00 German time of the day after the last day. */
  end: string;
  allDay: boolean;
  /** False for events marked "free" and for every event of a calendar that does not count as busy. */
  countsAsBusy: boolean;
}

/** Why a calendar could not be read for the preview. */
export type CalendarReadProblem =
  /** The provider said the calendar is gone; the link must be entered again. */
  | "broken"
  /** The provider did not answer or sent something unreadable; the next try may work. */
  | "unreachable";

/** `GET /api/calendars/preview`: the caller's own events of the next `CALENDAR_PREVIEW_DAYS` days. */
export interface CalendarPreview {
  state: CalendarsState;
  /** ISO 8601, UTC: start and (exclusive) end of the range shown. */
  from: string;
  to: string;
  /** Sorted by start, then end. */
  events: PreviewEvent[];
  /** Calendars that could not be read this time (missing from `events`). */
  problems: { calendarId: number; problem: CalendarReadProblem }[];
}
