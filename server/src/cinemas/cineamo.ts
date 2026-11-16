// Cinema showtimes from cineamo (phase 10d, admin-only test). The parser is pure; the service adds a small
// in-memory cache so a click on "fetch" never hits cineamo twice for the same cinema and day. Never throws.
import type { CinemaShowing } from "@lueckenfueller/shared";
import type { FastifyBaseLogger } from "fastify";
import { ownCopy } from "../calendars/ics.js";
import type { FetchResult } from "../calendars/fetch.js";

export const CINEAMO_USER_AGENT = "Lueckenfueller/1.0 (private friends app; showtimes)";
export const CINEAMO_MAX_BYTES = 2 * 1024 * 1024;
export const CINEAMO_TIMEOUT_MS = 10_000;
const CINEAMO_ORIGIN = "https://api.cineamo.com";

export const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
export const FAILURE_TTL_MS = 5 * 60 * 1000;
export const MAX_CACHE_ENTRIES = 400;
const MAX_FILM_LENGTH = 200;
const MAX_TICKET_URL_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ticketUrlOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_TICKET_URL_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  if (url.href.length > MAX_TICKET_URL_LENGTH) return undefined;
  return ownCopy(url.href);
}

/** The showings and the page count of cineamo's answer, or null when it is not the expected JSON. */
export function parseShowingsPage(text: string): { showings: CinemaShowing[]; pageCount: number } | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json) || !isRecord(json._embedded) || !Array.isArray(json._embedded.showings)) return null;
  const showings: CinemaShowing[] = [];
  for (const entry of json._embedded.showings as unknown[]) {
    if (!isRecord(entry)) continue;
    if (typeof entry.state === "string" && entry.state !== "scheduled") continue;
    if (typeof entry.name !== "string") continue;
    const film = entry.name.trim().slice(0, MAX_FILM_LENGTH).trim();
    if (film === "") continue;
    if (typeof entry.startDatetime !== "string") continue;
    const startMs = Date.parse(entry.startDatetime);
    if (Number.isNaN(startMs)) continue;
    const showing: CinemaShowing = { film: ownCopy(film), start: new Date(startMs).toISOString() };
    if (typeof entry.language === "string" && /^[a-z]{2,3}$/.test(entry.language)) {
      showing.language = ownCopy(entry.language);
    }
    const ticketUrl = ticketUrlOf(entry.onlineTicketUrl);
    if (ticketUrl !== undefined) showing.ticketUrl = ticketUrl;
    showings.push(showing);
  }
  showings.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.film < b.film ? -1 : a.film > b.film ? 1 : 0));
  const pageCount = typeof json._page_count === "number" ? json._page_count : 1;
  return { showings, pageCount };
}

/** The showings in cineamo's answer, sorted by start and film; null when it is not the expected JSON. */
export function parseShowings(text: string): CinemaShowing[] | null {
  return parseShowingsPage(text)?.showings ?? null;
}

export interface CinemaService {
  /** The showings of one cinema on one day (`YYYY-MM-DD`), or null when they could not be fetched or read. */
  showings(cinemaId: number, date: string): Promise<CinemaShowing[] | null>;
}

interface CacheEntry {
  expiresAt: number;
  value: CinemaShowing[] | null;
}

export function createCinemaService(deps: {
  fetchText: (url: URL) => Promise<FetchResult>;
  now: () => Date;
  log: FastifyBaseLogger;
}): CinemaService {
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<CinemaShowing[] | null>>();

  function remember(key: string, value: CinemaShowing[] | null): void {
    const nowMs = deps.now().getTime();
    cache.delete(key);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      for (const [other, entry] of cache) if (entry.expiresAt <= nowMs) cache.delete(other);
      // Maps keep insertion order: the first keys are the oldest.
      for (const other of cache.keys()) {
        if (cache.size < MAX_CACHE_ENTRIES) break;
        cache.delete(other);
      }
    }
    cache.set(key, { expiresAt: nowMs + (value === null ? FAILURE_TTL_MS : SUCCESS_TTL_MS), value });
  }

  async function load(cinemaId: number, date: string): Promise<CinemaShowing[] | null> {
    try {
      const url = new URL("/showings", CINEAMO_ORIGIN);
      url.searchParams.set("cinemaId", String(cinemaId));
      url.searchParams.set("date", date);
      url.searchParams.set("per_page", "100");
      const result = await deps.fetchText(url);
      if (!result.ok) {
        deps.log.warn(`Cinema showtimes fetch failed: ${result.reason}`);
        return null;
      }
      const page = parseShowingsPage(result.text);
      if (page === null) {
        deps.log.warn("Cinema showtimes fetch failed: unexpected answer");
        return null;
      }
      if (page.pageCount > 1) deps.log.warn("Cinema showtimes have more than one page; only the first is used");
      deps.log.info(`Cinema showtimes fetched: ok, ${page.showings.length} showings`);
      return page.showings;
    } catch {
      deps.log.warn("Cinema showtimes fetch failed: error");
      return null;
    }
  }

  return {
    showings(cinemaId, date) {
      const key = `${cinemaId}|${date}`;
      const cached = cache.get(key);
      if (cached !== undefined) {
        if (cached.expiresAt > deps.now().getTime()) return Promise.resolve(cached.value);
        cache.delete(key);
      }
      const running = inflight.get(key);
      if (running !== undefined) return running;
      const started = load(cinemaId, date).then((value) => {
        remember(key, value);
        return value;
      });
      inflight.set(key, started);
      void started.finally(() => inflight.delete(key));
      return started;
    },
  };
}
