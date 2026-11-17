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
export const ROOMS_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CACHE_ENTRIES = 400;
export const SHOWINGS_PER_PAGE = 100;
export const MAX_SHOWINGS_PAGES = 5;
export const ROOMS_PER_PAGE = 50;
export const MAX_ROOMS_PAGES = 3;
const MAX_ROOM_LENGTH = 60;
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

/** One parsed showing and the id of its screen (null when cineamo gives none). */
export interface ParsedShowing {
  showing: CinemaShowing;
  roomId: number | null;
}

function byStartAndFilm(a: ParsedShowing, b: ParsedShowing): number {
  const x = a.showing;
  const y = b.showing;
  return x.start < y.start ? -1 : x.start > y.start ? 1 : x.film < y.film ? -1 : x.film > y.film ? 1 : 0;
}

function pageCountOf(json: Record<string, unknown>): number {
  return typeof json._page_count === "number" && Number.isFinite(json._page_count) ? json._page_count : 1;
}

/** The showings (with their screen ids) and the page count of cineamo's answer, or null when it is not the expected JSON. */
export function parseShowingsPage(text: string): { items: ParsedShowing[]; pageCount: number } | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json) || !isRecord(json._embedded) || !Array.isArray(json._embedded.showings)) return null;
  const items: ParsedShowing[] = [];
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
    if (entry.isImax === true) showing.imax = true;
    const ticketUrl = ticketUrlOf(entry.onlineTicketUrl);
    if (ticketUrl !== undefined) showing.ticketUrl = ticketUrl;
    const roomId = typeof entry.cinemaRoomId === "number" && Number.isSafeInteger(entry.cinemaRoomId) ? entry.cinemaRoomId : null;
    items.push({ showing, roomId });
  }
  items.sort(byStartAndFilm);
  return { items, pageCount: pageCountOf(json) };
}

/** The showings in cineamo's answer, sorted by start and film; null when it is not the expected JSON. */
export function parseShowings(text: string): CinemaShowing[] | null {
  return parseShowingsPage(text)?.items.map((item) => item.showing) ?? null;
}

/** The screens (id and name) of cineamo's answer and its page count; null when it is not the expected JSON. */
export function parseRoomsPage(text: string): { items: [number, string][]; pageCount: number } | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json) || !isRecord(json._embedded)) return null;
  // The key of the list is not documented: take the first list of objects.
  const list = Object.values(json._embedded).find(
    (value): value is unknown[] => Array.isArray(value) && value.length > 0 && value.every(isRecord),
  );
  const empty = Object.values(json._embedded).some((value) => Array.isArray(value) && value.length === 0);
  if (list === undefined && !empty) return null;
  const items: [number, string][] = [];
  for (const entry of list ?? []) {
    if (!isRecord(entry) || typeof entry.id !== "number" || !Number.isSafeInteger(entry.id)) continue;
    if (typeof entry.name !== "string") continue;
    const name = [...entry.name.trim()].slice(0, MAX_ROOM_LENGTH).join("").trim();
    if (name === "") continue;
    items.push([entry.id, ownCopy(name)]);
  }
  return { items, pageCount: pageCountOf(json) };
}

export interface CinemaService {
  /** The showings of one cinema on one day (`YYYY-MM-DD`), or null when they could not be fetched or read. */
  showings(cinemaId: number, date: string): Promise<CinemaShowing[] | null>;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T | null;
}

type RoomNames = Map<number, string>;

export function createCinemaService(deps: {
  fetchText: (url: URL) => Promise<FetchResult>;
  now: () => Date;
  log: FastifyBaseLogger;
}): CinemaService {
  const cache = new Map<string, CacheEntry<ParsedShowing[]>>();
  const inflight = new Map<string, Promise<ParsedShowing[] | null>>();
  const roomCache = new Map<number, CacheEntry<RoomNames>>();
  const roomInflight = new Map<number, Promise<RoomNames | null>>();

  function remember(key: string, value: ParsedShowing[] | null): void {
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

  /** All pages one after another (page 1 without a page parameter); null when any page fails or cannot be read. */
  async function fetchPages<T>(
    what: string,
    makeUrl: (page: number) => URL,
    parse: (text: string) => { items: T[]; pageCount: number } | null,
    maxPages: number,
  ): Promise<T[] | null> {
    const all: T[] = [];
    let pageCount = 1;
    for (let page = 1; page <= Math.min(pageCount, maxPages); page++) {
      const result = await deps.fetchText(makeUrl(page));
      if (!result.ok) {
        deps.log.warn(`${what} fetch failed: ${result.reason}`);
        return null;
      }
      const parsed = parse(result.text);
      if (parsed === null) {
        deps.log.warn(`${what} fetch failed: unexpected answer`);
        return null;
      }
      all.push(...parsed.items);
      if (page === 1) {
        pageCount = parsed.pageCount;
        if (pageCount > maxPages) deps.log.warn(`${what} have more than ${maxPages} pages; only the first ${maxPages} are used`);
      }
    }
    return all;
  }

  async function load(cinemaId: number, date: string): Promise<ParsedShowing[] | null> {
    try {
      const items = await fetchPages(
        "Cinema showtimes",
        (page) => {
          const url = new URL("/showings", CINEAMO_ORIGIN);
          url.searchParams.set("cinemaId", String(cinemaId));
          url.searchParams.set("date", date);
          url.searchParams.set("per_page", String(SHOWINGS_PER_PAGE));
          if (page > 1) url.searchParams.set("page", String(page));
          return url;
        },
        parseShowingsPage,
        MAX_SHOWINGS_PAGES,
      );
      if (items === null) return null;
      items.sort(byStartAndFilm);
      deps.log.info(`Cinema showtimes fetched: ok, ${items.length} showings`);
      return items;
    } catch {
      deps.log.warn("Cinema showtimes fetch failed: error");
      return null;
    }
  }

  async function loadRooms(cinemaId: number): Promise<RoomNames | null> {
    try {
      const items = await fetchPages(
        "Cinema screens",
        (page) => {
          const url = new URL("/cinema-rooms", CINEAMO_ORIGIN);
          url.searchParams.set("cinemaId", String(cinemaId));
          url.searchParams.set("perPage", String(ROOMS_PER_PAGE));
          if (page > 1) url.searchParams.set("page", String(page));
          return url;
        },
        parseRoomsPage,
        MAX_ROOMS_PAGES,
      );
      return items === null ? null : new Map(items);
    } catch {
      deps.log.warn("Cinema screens fetch failed: error");
      return null;
    }
  }

  function roomsOf(cinemaId: number): Promise<RoomNames | null> {
    const cached = roomCache.get(cinemaId);
    if (cached !== undefined) {
      if (cached.expiresAt > deps.now().getTime()) return Promise.resolve(cached.value);
      roomCache.delete(cinemaId);
    }
    const running = roomInflight.get(cinemaId);
    if (running !== undefined) return running;
    const started = loadRooms(cinemaId).then((value) => {
      roomCache.set(cinemaId, { expiresAt: deps.now().getTime() + (value === null ? FAILURE_TTL_MS : ROOMS_TTL_MS), value });
      return value;
    });
    roomInflight.set(cinemaId, started);
    void started.finally(() => roomInflight.delete(cinemaId));
    return started;
  }

  function parsedShowings(cinemaId: number, date: string): Promise<ParsedShowing[] | null> {
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
  }

  return {
    async showings(cinemaId, date) {
      const items = await parsedShowings(cinemaId, date);
      if (items === null) return null;
      if (!items.some((item) => item.roomId !== null)) return items.map((item) => item.showing);
      // Without the screens the showings are still useful, just without a name.
      const rooms = await roomsOf(cinemaId);
      return items.map(({ showing, roomId }) => {
        const room = roomId === null ? undefined : rooms?.get(roomId);
        return room === undefined ? showing : { ...showing, room };
      });
    },
  };
}
