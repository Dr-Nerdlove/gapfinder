import type { SearchRequest, SearchResult } from "@lueckenfueller/shared";
import { SEARCH_DEFAULT_WINDOW } from "@lueckenfueller/shared";
import { addDays, clockToMinutes, formatClock, weekdayOf, type Row } from "./gap-search";

// The colour grid of the search result (phase 10c): a month grid in which every day of the search is coloured by
// the best number of people who can on that day, and a strip of hours for one day. Pure functions, no screen.

/** 4 = everybody, 3 = all but one, 2 = all but two, 1 = all but three or four, 0 = fewer. */
export type Shade = 0 | 1 | 2 | 3 | 4;

/** The shade of a number of people out of `readable`. */
export function shadeOf(count: number, readable: number): Shade {
  const missing = readable - count;
  if (missing <= 0) return 4;
  if (missing === 1) return 3;
  if (missing === 2) return 2;
  if (missing <= 4) return 1;
  return 0;
}

/** The best number of people who can, per day ("YYYY-MM-DD"); days without any entry have no free time worth showing. */
export function dayCounts(result: SearchResult, readable: number): Map<string, number> {
  const best = new Map<string, number>();
  const note = (date: string, count: number): void => {
    if (count > (best.get(date) ?? -1)) best.set(date, count);
  };
  if (result.mode === "hours") {
    for (const d of result.days) note(d.date, readable);
    const partial = result.partial ?? result.nearMisses.map((n) => ({ date: n.date, missingPersonIds: [n.missingPersonId] }));
    for (const p of partial) note(p.date, readable - p.missingPersonIds.length);
  } else {
    const spread = (first: string, last: string, count: number): void => {
      for (let day = first, guard = 0; day <= last && guard < 400; day = addDays(day, 1), guard++) note(day, count);
    };
    for (const s of result.stretches) spread(s.first, s.last, readable);
    const partial = result.partial ?? result.nearMisses.map((n) => ({ ...n, missingPersonIds: [n.missingPersonId] }));
    for (const p of partial) spread(p.first, p.last, readable - p.missingPersonIds.length);
  }
  return best;
}

/** The days a search looks at: from, to and (hours mode) the chosen weekdays. */
export interface SearchedDays {
  from: string;
  to: string;
  weekdays: readonly number[];
}

export function searchedDays(request: SearchRequest): SearchedDays {
  return { from: request.from, to: request.to, weekdays: request.mode === "hours" ? request.weekdays : [1, 2, 3, 4, 5, 6, 7] };
}

export interface GridCell {
  date: string;
  /** The day of the month. */
  day: number;
  /** False for days outside the search (grey, not tappable). */
  searched: boolean;
  /** Null when the day was searched but nothing was found. */
  count: number | null;
  shade: Shade;
}

/** "YYYY-MM" of every month the search touches, ascending. */
export function searchMonths(searched: Pick<SearchedDays, "from" | "to">): string[] {
  const months: string[] = [];
  for (let month = searched.from.slice(0, 7); month <= searched.to.slice(0, 7) && months.length < 40; month = nextMonth(month)) months.push(month);
  return months;
}

function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

/** The weeks of a month, Monday first; `null` fills the days before the 1st and after the last day. */
export function monthGrid(month: string, searched: SearchedDays, counts: ReadonlyMap<string, number>, readable: number): (GridCell | null)[][] {
  const first = `${month}-01`;
  const length = Number(addDays(`${nextMonth(month)}-01`, -1).slice(8));
  const cells: (GridCell | null)[] = Array<GridCell | null>(weekdayOf(first) - 1).fill(null);
  for (let day = 1; day <= length; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const inSearch = date >= searched.from && date <= searched.to && searched.weekdays.includes(weekdayOf(date));
    const count = inSearch ? (counts.get(date) ?? null) : null;
    cells.push({ date, day, searched: inSearch, count, shade: count === null ? 0 : shadeOf(count, readable) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (GridCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** What a square says: the number of people, "alle" for everybody, nothing when nobody was found. */
export function cellText(count: number | null, readable: number): string {
  if (count === null) return "";
  return count >= readable ? "alle" : String(count);
}

export interface HourCell {
  hour: number;
  count: number | null;
  shade: Shade;
  /** Inside the time window that was searched. */
  inWindow: boolean;
}

/**
 * The hours of one day, coloured by the most people who can in that hour. Only hours-mode results have slots;
 * the strip runs from one hour before the window to one hour after it, within the day.
 */
export function dayStrip(result: SearchResult, date: string, readable: number, window: { start: string; end: string } = SEARCH_DEFAULT_WINDOW): HourCell[] {
  if (result.mode !== "hours") return [];
  const entries: { count: number; slots: { start: string; end: string }[] }[] = [];
  for (const d of result.days) if (d.date === date) entries.push({ count: readable, slots: d.slots });
  const partial = result.partial ?? result.nearMisses.map((n) => ({ date: n.date, missingPersonIds: [n.missingPersonId], slots: n.slots }));
  for (const p of partial) if (p.date === date) entries.push({ count: readable - p.missingPersonIds.length, slots: p.slots });
  const startMin = clockToMinutes(window.start);
  const endMin = clockToMinutes(window.end);
  const winEnd = endMin > startMin ? endMin : 24 * 60; // a window past midnight is shown to the end of the day
  const firstHour = Math.max(0, Math.floor(startMin / 60) - 1);
  const lastHour = Math.min(24, Math.ceil(winEnd / 60) + 1);
  const best = new Map<number, number>();
  for (const entry of entries) {
    for (const slot of entry.slots) {
      let from = clockToMinutes(formatClock(slot.start));
      if (endMin <= startMin && from < startMin) from += 24 * 60; // after midnight: belongs to the next day, off the strip
      const to = from + (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000;
      for (let hour = Math.floor(from / 60); hour * 60 < to && hour < 24; hour++) {
        if (entry.count > (best.get(hour) ?? -1)) best.set(hour, entry.count);
      }
    }
  }
  const cells: HourCell[] = [];
  for (let hour = firstHour; hour < lastHour; hour++) {
    const count = best.get(hour) ?? null;
    cells.push({ hour, count, shade: count === null ? 0 : shadeOf(count, readable), inWindow: hour * 60 >= startMin && hour * 60 < winEnd });
  }
  return cells;
}

/** The lines of a result that belong to one day (hours: the day a window starts; days: a stretch covering it). */
export function rowsOfDay(rows: readonly Row[], date: string): Row[] {
  return rows.filter((row) => {
    const pick = row.picks[0];
    if (pick?.kind === "days") return pick.first <= date && date <= pick.last;
    return row.key.slice(0, 10) === date;
  });
}

/** What an hour square says: the number of people, nothing when everybody can (the darkest shade says "alle") or nobody was found. */
export function hourText(count: number | null, readable: number): string {
  return count === null || count >= readable ? "" : String(count);
}

/** "18" for "18:00", "18:30" for "18:30": the hour as the line under the strip says it. */
function clockHours(clock: string): string {
  const minutes = clockToMinutes(clock);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * The line under the hour strip that spans the searched window: the CSS grid lines it starts and ends at
 * (1-based, `grid-column: start / end`) and its text, e.g. "gesucht: 18–23 Uhr". Null when no hour of the strip is in the window.
 */
export function windowLine(strip: readonly HourCell[], window: { start: string; end: string }): { start: number; end: number; text: string } | null {
  const first = strip.findIndex((h) => h.inWindow);
  if (first < 0) return null;
  let last = first;
  while (strip[last + 1]?.inWindow) last++;
  return { start: first + 1, end: last + 2, text: `gesucht: ${clockHours(window.start)}–${clockHours(window.end)} Uhr` };
}
