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
  /** The showing's name at this cinema; it differs between cinemas for the same film, so never match films by it. */
  film: string;
  /** cineamo's content id: the same for a film in every cinema and every language version. Group films by it. */
  contentId?: number;
  /** cineamo's movie id, for `GET /api/admin/movies/:id`; missing for some events. */
  movieId?: number;
  /** Language code of the film's original version (e.g. `eng`); missing when unknown. */
  originalLanguage?: string;
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

/** `GET /api/admin/movies/:id` (admin only, feature `cinema_film_choice`): the film's length in minutes, missing when cineamo does not know it. */
export interface CinemaMovieResponse {
  runtime?: number;
}
