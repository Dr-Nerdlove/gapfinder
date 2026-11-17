// Fetching cinema showtimes (phase 10d, admin-only test). The server asks cineamo for one cinema and one day.

/** A cinema the server is configured for (`CINEMAS`). `id` is the cineamo id. */
export interface CinemaInfo {
  id: number;
  name: string;
  /** Preferred screen (`CINEMAS`: `<id>=<name>|<screen>`), as cineamo names it; the app shows only its showings. */
  room?: string;
}

/** `GET /api/admin/cinemas` (admin only): the configured cinemas. */
export interface CinemaListResponse {
  cinemas: CinemaInfo[];
}

/** One showing of a film. */
export interface CinemaShowing {
  film: string;
  /** Start as an ISO 8601 instant in UTC (e.g. `2026-11-17T14:00:00.000Z`). */
  start: string;
  /** Language code of the version (e.g. `deu`, `eng`); missing when unknown. */
  language?: string;
  /** The screen's name as cineamo gives it; missing when cineamo does not name the screen of this showing. */
  room?: string;
  /** True when cineamo marks the showing as IMAX; missing otherwise. */
  imax?: true;
  /** `https://` address where tickets can be bought; missing when there is none. */
  ticketUrl?: string;
}

/** `GET /api/admin/cinemas/:id/showings?date=YYYY-MM-DD` (admin only): the showings of that day, sorted by start. */
export interface CinemaShowingsResponse {
  showings: CinemaShowing[];
}
