import {
  SEARCH_DEFAULT_WINDOW,
  SEARCH_MAX_BUFFER_MINUTES,
  SEARCH_MAX_DURATION_MINUTES,
  SEARCH_MAX_PERIOD_DAYS,
  type Person,
  type SearchRequest,
  type SearchResult,
  type SkippedPerson,
  type Slot,
  type Weekday,
} from "@lueckenfueller/shared";
import { defaultStorage } from "./session-storage";

// Everything the search page decides without the screen: what the device remembers, which dates a range means,
// the request sent to the server and the lines shown for the answer. All dates are German calendar days.

export const SEARCH_SETTINGS_KEY = "lueckenfueller.search";
const TIME_ZONE = "Europe/Berlin";
const DAY_MS = 86_400_000;

export type RangePreset = "30" | "90" | "half" | "year" | "months";

export interface SearchSettings {
  /** Other people's ids (the searcher is always part of the search and never listed here). */
  people: number[];
  kind: "hours" | "days";
  weekdays: Weekday[];
  durationMinutes: number;
  windowStart: string;
  windowEnd: string;
  bufferMinutes: number;
  days: number;
  /** Null = any weekday. */
  startWeekday: Weekday | null;
  range: RangePreset;
  /** "YYYY-MM", used with the range `months`. */
  fromMonth: string;
  toMonth: string;
}

export const WEEKDAY_LABELS: Record<Weekday, string> = { 1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa", 7: "So" };
const WEEKDAY_NAMES: Record<Weekday, string> = {
  1: "Montag",
  2: "Dienstag",
  3: "Mittwoch",
  4: "Donnerstag",
  5: "Freitag",
  6: "Samstag",
  7: "Sonntag",
};
export const ALL_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
export const RANGE_LABELS: Record<RangePreset, string> = {
  "30": "30 Tage",
  "90": "90 Tage",
  half: "Halbes Jahr",
  year: "1 Jahr",
  months: "Monate",
};
/** Days from today on (today included); the server allows a start today and an end at most 365 days ahead. */
const RANGE_DAYS: Record<Exclude<RangePreset, "months">, number> = { "30": 30, "90": 90, half: 182, year: 365 };
/** The last day a search may end on, counted from today. */
const MAX_DAYS_AHEAD = 365;

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
const MONTH_SHORT = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];

// ---------- dates ----------

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "YYYY-MM-DD" of the German calendar day this instant lies on. */
export function berlinToday(now: Date = new Date()): string {
  return dateFormat.format(now);
}

const pad = (n: number): string => String(n).padStart(2, "0");
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function dayNumber(date: string): number {
  const m = DATE_PATTERN.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : NaN;
}

function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `date` moved by whole days. */
export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: string): Weekday {
  const day = new Date(dayNumber(date) * DAY_MS).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

/** "Sa 12.12." */
export function formatDay(date: string): string {
  const m = DATE_PATTERN.exec(date);
  if (!m) return date;
  return `${WEEKDAY_LABELS[weekdayOf(date)]} ${Number(m[3])}.${Number(m[2])}.`;
}

/** "Sa 1. Aug." (used for start days of a stretch) */
function formatDayLong(date: string): string {
  const m = DATE_PATTERN.exec(date);
  if (!m) return date;
  return `${WEEKDAY_LABELS[weekdayOf(date)]} ${Number(m[3])}. ${MONTH_SHORT[Number(m[2]) - 1]}`;
}

/** "14.–28. Feb." / "28. Aug.–3. Sept." / "5. Mai" / with another year "30. Dez. 2026–2. Jan. 2027". */
export function formatStretch(first: string, last: string): string {
  const a = DATE_PATTERN.exec(first);
  const b = DATE_PATTERN.exec(last);
  if (!a || !b) return `${first}–${last}`;
  const [ay, am, ad] = [Number(a[1]), Number(a[2]), Number(a[3])];
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  if (first === last) return `${ad}. ${MONTH_SHORT[am - 1]}`;
  if (ay !== by) return `${ad}. ${MONTH_SHORT[am - 1]} ${ay}–${bd}. ${MONTH_SHORT[bm - 1]} ${by}`;
  if (am === bm) return `${ad}.–${bd}. ${MONTH_SHORT[bm - 1]}`;
  return `${ad}. ${MONTH_SHORT[am - 1]}–${bd}. ${MONTH_SHORT[bm - 1]}`;
}

/** "18:00" in German time. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

/** "18:00–23:00" */
export function formatSlot(slot: Slot): string {
  return `${formatClock(slot.start)}–${formatClock(slot.end)}`;
}

// ---------- months ----------

/** The months that can be chosen for a range: the current one and the twelve after it. */
export function monthOptions(today: string): { value: string; label: string }[] {
  const m = DATE_PATTERN.exec(today);
  if (!m) return [];
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i <= 12; i++) {
    const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + i;
    const year = Math.floor(total / 12);
    const month = total % 12;
    out.push({ value: `${year}-${pad(month + 1)}`, label: `${MONTH_NAMES[month]} ${year}` });
  }
  return out;
}

function monthStart(month: string): string | null {
  return MONTH_PATTERN.test(month) ? `${month}-01` : null;
}

function monthEnd(month: string): string | null {
  const m = MONTH_PATTERN.exec(month);
  if (!m) return null;
  return addDays(`${addMonth(month)}-01`, -1);
}

function addMonth(month: string): string {
  const m = MONTH_PATTERN.exec(month)!;
  const total = Number(m[1]) * 12 + Number(m[2]);
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/**
 * The first and last day a range means, or null when it lies outside what can be searched (a past month, an end
 * before the start). A start in the past moves to today and an end beyond a year ahead is cut off.
 */
export function rangeDates(settings: Pick<SearchSettings, "range" | "fromMonth" | "toMonth">, today: string): { from: string; to: string } | null {
  const limit = addDays(today, MAX_DAYS_AHEAD);
  if (settings.range !== "months") {
    return { from: today, to: addDays(today, RANGE_DAYS[settings.range] - 1) };
  }
  const start = monthStart(settings.fromMonth);
  const end = monthEnd(settings.toMonth);
  if (start === null || end === null) return null;
  const from = start < today ? today : start;
  const to = end > limit ? limit : end;
  if (to < from) return null;
  return { from, to };
}

// ---------- the request ----------

export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":");
  return Number(h) * 60 + Number(m);
}

/** Minutes between the start and the end of a window; an end at or before the start is on the next day. */
export function windowMinutes(start: string, end: string): number {
  const s = clockToMinutes(start);
  const e = clockToMinutes(end);
  return e > s ? e - s : 1440 - s + e;
}

export type RequestProblem =
  | "no_people"
  | "no_weekdays"
  | "window_empty"
  | "too_long_for_window"
  | "no_range";

export const REQUEST_PROBLEM_TEXTS: Record<RequestProblem, string> = {
  no_people: "Wähle mindestens eine Person aus, mit der du suchst.",
  no_weekdays: "Wähle mindestens einen Wochentag aus.",
  window_empty: "Beginn und Ende des Zeitfensters dürfen nicht gleich sein.",
  too_long_for_window: "So lange Zeit passt nicht in das Zeitfenster. Wähle ein größeres Fenster oder eine kürzere Dauer.",
  no_range: "Der gewählte Zeitraum liegt nicht in der Zukunft oder das Ende liegt vor dem Anfang.",
};

/** The request for the server, or the first thing that is wrong with the settings. */
export function buildRequest(settings: SearchSettings, today: string): { ok: true; request: SearchRequest } | { ok: false; problem: RequestProblem } {
  if (settings.people.length === 0) return { ok: false, problem: "no_people" };
  const range = rangeDates(settings, today);
  if (range === null) return { ok: false, problem: "no_range" };
  const base = { people: [...settings.people], from: range.from, to: range.to };
  if (settings.kind === "days") {
    return {
      ok: true,
      request: {
        mode: "days",
        ...base,
        days: settings.days,
        ...(settings.startWeekday !== null ? { startWeekday: settings.startWeekday } : {}),
      },
    };
  }
  if (settings.weekdays.length === 0) return { ok: false, problem: "no_weekdays" };
  if (settings.windowStart === settings.windowEnd) return { ok: false, problem: "window_empty" };
  if (settings.durationMinutes > windowMinutes(settings.windowStart, settings.windowEnd)) {
    return { ok: false, problem: "too_long_for_window" };
  }
  return {
    ok: true,
    request: {
      mode: "hours",
      ...base,
      weekdays: [...settings.weekdays],
      durationMinutes: settings.durationMinutes,
      window: { start: settings.windowStart, end: settings.windowEnd },
      bufferMinutes: settings.bufferMinutes,
    },
  };
}

// ---------- what the device remembers ----------

export function defaultSettings(today: string): SearchSettings {
  const month = today.slice(0, 7);
  return {
    people: [],
    kind: "hours",
    weekdays: [6, 7],
    durationMinutes: 180,
    windowStart: SEARCH_DEFAULT_WINDOW.start,
    windowEnd: SEARCH_DEFAULT_WINDOW.end,
    bufferMinutes: 0,
    days: 7,
    startWeekday: null,
    range: "90",
    fromMonth: month,
    toMonth: month,
  };
}

const isClock = (v: unknown): v is string => typeof v === "string" && /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(v);
const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH_PATTERN.test(v) && Number(v.slice(5)) >= 1 && Number(v.slice(5)) <= 12;
const isWeekday = (v: unknown): v is Weekday => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7;
const inRange = (v: unknown, min: number, max: number, step: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max && v % step === 0;

/** Takes what was saved (anything at all) and keeps every value that is still valid; the rest is the default. */
export function sanitizeSettings(raw: unknown, today: string): SearchSettings {
  const settings = defaultSettings(today);
  if (typeof raw !== "object" || raw === null) return settings;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r["people"])) {
    settings.people = [...new Set(r["people"].filter((id): id is number => typeof id === "number" && Number.isInteger(id)))];
  }
  if (r["kind"] === "hours" || r["kind"] === "days") settings.kind = r["kind"];
  if (Array.isArray(r["weekdays"])) settings.weekdays = ALL_WEEKDAYS.filter((day) => (r["weekdays"] as unknown[]).includes(day));
  // Older saved searches may hold half hours: round them up to the next full hour.
  if (inRange(r["durationMinutes"], 30, SEARCH_MAX_DURATION_MINUTES, 30)) settings.durationMinutes = Math.ceil(r["durationMinutes"] / 60) * 60;
  if (isClock(r["windowStart"])) settings.windowStart = r["windowStart"];
  if (isClock(r["windowEnd"])) settings.windowEnd = r["windowEnd"];
  if (settings.windowStart === settings.windowEnd) {
    settings.windowStart = SEARCH_DEFAULT_WINDOW.start;
    settings.windowEnd = SEARCH_DEFAULT_WINDOW.end;
  }
  if (inRange(r["bufferMinutes"], 0, SEARCH_MAX_BUFFER_MINUTES, 15)) settings.bufferMinutes = r["bufferMinutes"];
  if (inRange(r["days"], 1, SEARCH_MAX_PERIOD_DAYS, 1)) settings.days = r["days"];
  if (r["startWeekday"] === null || isWeekday(r["startWeekday"])) settings.startWeekday = r["startWeekday"] as Weekday | null;
  if (typeof r["range"] === "string" && Object.prototype.hasOwnProperty.call(RANGE_LABELS, r["range"])) {
    settings.range = r["range"] as RangePreset;
  }
  // A month that has passed would give no range; start again from this month.
  if (isMonth(r["fromMonth"]) && r["fromMonth"] >= today.slice(0, 7)) settings.fromMonth = r["fromMonth"];
  if (isMonth(r["toMonth"]) && r["toMonth"] >= settings.fromMonth) settings.toMonth = r["toMonth"];
  else settings.toMonth = settings.fromMonth;
  return settings;
}

/** The saved settings; every access to the storage is guarded (blocked site data must not break the page). */
export function loadSettings(today: string, storage: Storage | null = defaultStorage()): SearchSettings {
  try {
    const raw = storage?.getItem(SEARCH_SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null, today);
  } catch {
    return defaultSettings(today);
  }
}

export function saveSettings(settings: SearchSettings, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(SEARCH_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Without storage the settings last until the page is closed.
  }
}

/** Only people who still have an account stay chosen. The searcher is never in the list. */
export function keepKnownPeople(ids: readonly number[], people: readonly Person[], selfId: number): number[] {
  const known = new Set(people.map((p) => p.id));
  return ids.filter((id) => id !== selfId && known.has(id));
}

// ---------- the answer ----------

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Minuten`;
  const hours = minutes / 60;
  const text = Number.isInteger(hours) ? String(hours) : String(hours).replace(".", ",");
  return hours === 1 ? "1 Stunde" : `${text} Stunden`;
}

/** The weekdays in a short form: "Sa, So" or "Mo–Fr" for a run of three or more. */
export function weekdaysLabel(weekdays: readonly Weekday[]): string {
  const sorted = ALL_WEEKDAYS.filter((day) => weekdays.includes(day));
  if (sorted.length === 7) return "jeden Tag";
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]! === sorted[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${WEEKDAY_LABELS[sorted[i]!]}–${WEEKDAY_LABELS[sorted[j]!]}`);
    else for (let k = i; k <= j; k++) parts.push(WEEKDAY_LABELS[sorted[k]!]);
    i = j + 1;
  }
  return parts.join(", ");
}

/** One line that says what was searched, shown above the result. */
export function requestSummary(request: SearchRequest): string {
  const range = `${formatStretch(request.from, request.to)}`;
  if (request.mode === "days") {
    const start = request.startWeekday !== undefined ? `, Start am ${WEEKDAY_NAMES[request.startWeekday]}` : "";
    return `${request.days === 1 ? "1 Tag" : `${request.days} Tage`} am Stück${start} · ${range}`;
  }
  const window = request.window ?? SEARCH_DEFAULT_WINDOW;
  return `${weekdaysLabel(request.weekdays)}, mind. ${durationLabel(request.durationMinutes)}, ${window.start}–${window.end} Uhr · ${range}`;
}

/** A free time the person can turn into a proposal of a poll. */
export type PollPick =
  | { id: string; kind: "timed"; label: string; slot: Slot }
  | { id: string; kind: "days"; label: string; first: string; last: string; days: number; starts: string[] };

export interface Row {
  key: string;
  /** "Sa 12.12." or "3.–16. Aug." */
  heading: string;
  /** The free times of a day, or the length of a stretch. */
  detail: string;
  /** Only with a starting weekday: "Start möglich: Sa 1. Aug., Sa 8. Aug." */
  extra?: string;
  /** Only for near misses: "alle außer Max". */
  missing?: string;
  /** What can be chosen for a poll: one entry per free time of a day, or the stretch. */
  picks: PollPick[];
}

export interface ResultView {
  everyone: Row[];
  nearMisses: Row[];
}

type NameOf = (personId: number) => string;

/** How a person is called in the result: "dir" for the searcher. */
export function makeNameOf(people: readonly Person[], selfId: number): { name: NameOf; except: NameOf } {
  const names = new Map(people.map((p) => [p.id, p.username]));
  return {
    name: (id) => (id === selfId ? "Du" : (names.get(id) ?? "Jemand")),
    except: (id) => `alle außer ${id === selfId ? "dir" : (names.get(id) ?? "jemandem")}`,
  };
}

const timedPicks = (slots: readonly Slot[], missingPersonId?: number): PollPick[] =>
  slots.map((slot) => ({
    id: `timed:${slot.start}:${slot.end}:${missingPersonId ?? ""}`,
    kind: "timed" as const,
    label: formatSlot(slot),
    slot,
  }));

const daysText = (n: number): string => (n === 1 ? "1 Tag" : `${n} Tage`);

/** Turns the server's answer into lines. Near misses are sorted by day (hours) or start (days). */
export function resultView(result: SearchResult, people: readonly Person[], selfId: number): ResultView {
  const { except } = makeNameOf(people, selfId);
  if (result.mode === "hours") {
    return {
      everyone: result.days.map((d) => ({ key: d.date, heading: formatDay(d.date), detail: d.slots.map(formatSlot).join(", "), picks: timedPicks(d.slots) })),
      nearMisses: result.nearMisses.map((n) => ({
        key: `${n.date}:${n.missingPersonId}`,
        heading: formatDay(n.date),
        detail: n.slots.map(formatSlot).join(", "),
        missing: except(n.missingPersonId),
        picks: timedPicks(n.slots, n.missingPersonId),
      })),
    };
  }
  const stretchRow = (s: { first: string; last: string; days: number; starts?: string[] }, key: string, missingPersonId?: number): Row => ({
    key,
    picks: [
      {
        id: `days:${s.first}:${s.last}:${missingPersonId ?? ""}`,
        kind: "days",
        label: daysText(s.days),
        first: s.first,
        last: s.last,
        days: s.days,
        starts: s.starts ?? [],
      },
    ],
    heading: formatStretch(s.first, s.last),
    detail: daysText(s.days),
    ...(s.starts !== undefined && s.starts.length > 0 ? { extra: `Start möglich: ${s.starts.map(formatDayLong).join(", ")}` } : {}),
  });
  return {
    everyone: result.stretches.map((s) => stretchRow(s, s.first)),
    nearMisses: result.nearMisses.map((n) => ({ ...stretchRow(n, `${n.first}:${n.missingPersonId}`, n.missingPersonId), missing: except(n.missingPersonId) })),
  };
}

/** One line per person who was left out: "Max: Kalender nicht lesbar – nicht berücksichtigt". */
export function skippedNotices(skipped: readonly SkippedPerson[], people: readonly Person[], selfId: number): string[] {
  const { name } = makeNameOf(people, selfId);
  return skipped.map((s) => {
    const why = s.reason === "no_calendar" ? "kein Kalender verknüpft" : "Kalender nicht lesbar";
    return `${name(s.personId)}: ${why} – nicht berücksichtigt`;
  });
}

/** How many people could really be searched; near misses need at least three. */
export function readablePeople(requestedOthers: number, skipped: readonly SkippedPerson[]): number {
  return requestedOthers + 1 - skipped.length;
}
