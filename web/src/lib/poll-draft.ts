import {
  POLL_MAX_DAYS,
  POLL_MAX_DAYS_AHEAD,
  POLL_MAX_PROPOSALS,
  POLL_MAX_TIMED_MINUTES,
  POLL_NOTE_MAX_LENGTH,
  POLL_TITLE_MAX_LENGTH,
  type CreatePollRequest,
  type Slot,
} from "@lueckenfueller/shared";
import { addDays, berlinToday, formatClock, formatDay, type PollPick } from "./gap-search";

// Everything the screens for creating a poll decide without the screen: which free times are chosen, the exact
// start and end of each proposal, the deadline in German time and the request for the server.

const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const TIME_ZONE = "Europe/Berlin";

// ---------- German wall time → instant ----------

const zoneFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** German time minus UTC at this instant, in milliseconds (1 or 2 hours). */
function berlinOffsetMs(at: number): number {
  const parts = Object.fromEntries(zoneFormat.formatToParts(new Date(at)).map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts["year"]!, parts["month"]! - 1, parts["day"]!, parts["hour"]!, parts["minute"]!, parts["second"]!);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant at which German clocks show this day and time ("YYYY-MM-DD", "HH:MM"), or null for text that is
 * not a date and time. A time that does not exist (spring change) moves one hour on; one that exists twice
 * (autumn change) is the earlier one.
 */
export function berlinWallToInstant(date: string, clock: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).getUTCMonth() !== month - 1) return null; // 31 February and the like
  // The earlier of the two readings is right when the time exists twice; a gap is bridged by the later offset.
  const candidates = [wall - berlinOffsetMs(wall - 2 * 3_600_000), wall - berlinOffsetMs(wall + 2 * 3_600_000)].sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (candidate + berlinOffsetMs(candidate) === wall) return new Date(candidate);
  }
  return new Date(candidates[1]!);
}

/** "YYYY-MM-DD" and "HH:MM" of an instant in German time (for filling the deadline fields). */
export function berlinParts(iso: string): { date: string; time: string } {
  return { date: berlinToday(new Date(iso)), time: formatClock(iso) };
}

// ---------- the chosen free times ----------

/** The most free times that can be chosen: one proposal each. */
export const MAX_PICKS = POLL_MAX_PROPOSALS;

/** Chooses or drops a free time. A full list stays as it is. */
export function togglePick(selected: readonly PollPick[], pick: PollPick): PollPick[] {
  if (selected.some((p) => p.id === pick.id)) return selected.filter((p) => p.id !== pick.id);
  return selected.length >= MAX_PICKS ? [...selected] : [...selected, pick];
}

/** "1 Termin gewählt" / "3 Termine gewählt" */
export function selectionLabel(count: number): string {
  return count === 1 ? "1 Termin gewählt" : `${count} Termine gewählt`;
}

/** What the search page hands over to the page that creates the poll. */
export interface PollSource {
  picks: PollPick[];
  /** The searched duration (hours search): the suggestion for the length of each proposal. */
  durationMinutes: number;
  /** The searched number of days (days search). */
  periodDays: number;
  /** The other people of the search. */
  participants: number[];
  /** One line that says what was searched. */
  summary: string;
}

let handedOver: PollSource | null = null;

/** The search page leaves its choice here and goes to the page for the poll (a reload forgets it). */
export const pollSource = {
  set(source: PollSource): void {
    handedOver = source;
  },
  get(): PollSource | null {
    return handedOver;
  },
  clear(): void {
    handedOver = null;
  },
};

// ---------- one proposal while it is being edited ----------

export type DraftItem =
  | { kind: "timed"; id: string; label: string; gap: Slot; start: string; end: string }
  | { kind: "days"; id: string; label: string; gapFirst: string; gapLast: string; first: string; last: string };

/**
 * Every half hour inside a gap, as instants (`toISOString()`), plus the start and the end of the gap themselves
 * (rounded in to a quarter hour), so a gap that begins at 14:15 can be used completely.
 */
export function timeInstants(gap: Slot): string[] {
  const first = Math.ceil(Date.parse(gap.start) / QUARTER_MS) * QUARTER_MS;
  const last = Math.floor(Date.parse(gap.end) / QUARTER_MS) * QUARTER_MS;
  const times = new Set<number>([first, last]);
  for (let t = Math.ceil(first / HALF_HOUR_MS) * HALF_HOUR_MS; t <= last && times.size < 200; t += HALF_HOUR_MS) times.add(t);
  return [...times].filter((t) => t >= first && t <= last).sort((x, y) => x - y).map((t) => new Date(t).toISOString());
}

/** The instants a proposal can start at: all but the last time of the gap. */
export function startOptions(gap: Slot): string[] {
  return timeInstants(gap).slice(0, -1);
}

/** The instants a proposal that starts at `start` can end at: after the start, at most 24 hours long. */
export function endOptions(gap: Slot, start: string): string[] {
  const begin = Date.parse(start);
  return timeInstants(gap).filter((t) => Date.parse(t) > begin && Date.parse(t) - begin <= POLL_MAX_TIMED_MINUTES * MINUTE_MS);
}

/** The end after `minutes` from the start, or the last possible end when the gap is shorter. */
export function suggestedEnd(gap: Slot, start: string, minutes: number): string {
  const options = endOptions(gap, start);
  const wanted = Date.parse(start) + minutes * MINUTE_MS;
  const fitting = options.filter((t) => Date.parse(t) <= wanted);
  return fitting[fitting.length - 1] ?? options[0] ?? start;
}

/** A new start for a timed proposal; the length stays the same where the gap is long enough. */
export function withStart(item: Extract<DraftItem, { kind: "timed" }>, start: string): DraftItem {
  const minutes = Math.round((Date.parse(item.end) - Date.parse(item.start)) / MINUTE_MS);
  return { ...item, start, end: suggestedEnd(item.gap, start, minutes) };
}

/** "14:00", and with the day when it is not the day the gap starts on: "01:00 (So 13.12.)". */
export function instantLabel(iso: string, gapStart: string): string {
  const day = berlinToday(new Date(iso));
  return day === berlinToday(new Date(gapStart)) ? formatClock(iso) : `${formatClock(iso)} (${formatDay(day)})`;
}

/**
 * The editable proposals for the chosen free times. A proposal at the same time twice (a near miss that overlaps
 * a result for everyone) is kept once. Timed: starts at the start of the gap and is as long as was searched.
 * Days: starts on the first possible day (tomorrow at the earliest) and is as long as was searched.
 */
export function draftFromSource(source: PollSource, today: string): DraftItem[] {
  const items: DraftItem[] = [];
  const seen = new Set<string>();
  for (const pick of source.picks) {
    if (pick.kind === "timed") {
      const start = startOptions(pick.slot)[0];
      if (start === undefined) continue;
      const end = suggestedEnd(pick.slot, start, source.durationMinutes);
      const key = `${start}|${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "timed", id: pick.id, label: pick.label, gap: pick.slot, start, end });
    } else {
      const tomorrow = addDays(today, 1);
      const earliest = pick.starts.find((day) => day >= tomorrow) ?? (pick.first < tomorrow ? tomorrow : pick.first);
      const first = earliest > pick.last ? pick.last : earliest;
      const lastWanted = addDays(first, Math.min(source.periodDays, POLL_MAX_DAYS) - 1);
      const last = lastWanted > pick.last ? pick.last : lastWanted;
      const key = `${first}|${last}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "days", id: pick.id, label: pick.label, gapFirst: pick.first, gapLast: pick.last, first, last });
    }
  }
  return items;
}

// ---------- checking the poll ----------

export type DraftProblem =
  | "title_empty"
  | "title_long"
  | "note_long"
  | "no_items"
  | "too_many"
  | "item_order"
  | "item_long"
  | "item_past"
  | "item_outside"
  | "item_duplicate"
  | "deadline_incomplete"
  | "deadline_past"
  | "deadline_far";

export const DRAFT_PROBLEM_TEXTS: Record<DraftProblem, string> = {
  title_empty: "Gib der Abstimmung einen Titel.",
  title_long: `Der Titel darf höchstens ${POLL_TITLE_MAX_LENGTH} Zeichen lang sein.`,
  note_long: `Die Notiz darf höchstens ${POLL_NOTE_MAX_LENGTH} Zeichen lang sein.`,
  no_items: "Wähle mindestens einen Termin aus.",
  too_many: `Eine Abstimmung kann höchstens ${POLL_MAX_PROPOSALS} Termine haben.`,
  item_order: "Bei einem Termin liegt das Ende nicht nach dem Beginn.",
  item_long: `Ein Termin darf höchstens ${POLL_MAX_TIMED_MINUTES / 60} Stunden oder ${POLL_MAX_DAYS} Tage lang sein.`,
  item_past: "Ein Termin liegt nicht mehr in der Zukunft. Suche bitte neu.",
  item_outside: "Ein Termin liegt nicht innerhalb der gefundenen Lücke.",
  item_duplicate: "Zwei Termine sind gleich.",
  deadline_incomplete: "Für die Frist brauchst du Tag und Uhrzeit, oder lass beides leer.",
  deadline_past: "Die Frist muss in der Zukunft liegen.",
  deadline_far: `Die Frist darf höchstens ${POLL_MAX_DAYS_AHEAD} Tage entfernt sein.`,
};

export interface PollDraft {
  title: string;
  note: string;
  /** "YYYY-MM-DD" in German time, or empty */
  deadlineDate: string;
  /** "HH:MM" in German time, or empty */
  deadlineTime: string;
  items: DraftItem[];
  participants: number[];
}

const length = (text: string): number => [...text].length;

export type DraftCheck = { ok: true; request: CreatePollRequest } | { ok: false; problem: DraftProblem; itemId?: string };

/** The deadline as an instant, `null` when none is set, or the problem. */
export function deadlineOf(date: string, time: string, now: Date): { ok: true; value: string | null } | { ok: false; problem: DraftProblem } {
  if (date === "" && time === "") return { ok: true, value: null };
  const instant = date === "" || time === "" ? null : berlinWallToInstant(date, time);
  if (instant === null) return { ok: false, problem: "deadline_incomplete" };
  if (instant.getTime() <= now.getTime()) return { ok: false, problem: "deadline_past" };
  if (instant.getTime() > now.getTime() + POLL_MAX_DAYS_AHEAD * 86_400_000) return { ok: false, problem: "deadline_far" };
  return { ok: true, value: instant.toISOString() };
}

/** The request for the server, or the first thing that is wrong. The server checks all of it again. */
export function buildCreateRequest(draft: PollDraft, now: Date = new Date()): DraftCheck {
  const title = draft.title.trim();
  const note = draft.note.replace(/\r\n/g, "\n").trim();
  if (title === "") return { ok: false, problem: "title_empty" };
  if (length(title) > POLL_TITLE_MAX_LENGTH) return { ok: false, problem: "title_long" };
  if (length(note) > POLL_NOTE_MAX_LENGTH) return { ok: false, problem: "note_long" };
  if (draft.items.length === 0) return { ok: false, problem: "no_items" };
  if (draft.items.length > POLL_MAX_PROPOSALS) return { ok: false, problem: "too_many" };

  const today = berlinToday(now);
  const tomorrow = addDays(today, 1);
  const seen = new Set<string>();
  const timed: { start: string; end: string }[] = [];
  const days: { first: string; last: string }[] = [];
  for (const item of draft.items) {
    const fail = (problem: DraftProblem): DraftCheck => ({ ok: false, problem, itemId: item.id });
    if (item.kind === "timed") {
      const start = Date.parse(item.start);
      const end = Date.parse(item.end);
      if (!(end > start)) return fail("item_order");
      if ((end - start) / MINUTE_MS > POLL_MAX_TIMED_MINUTES) return fail("item_long");
      if (start <= now.getTime()) return fail("item_past");
      if (start < Date.parse(item.gap.start) || end > Date.parse(item.gap.end)) return fail("item_outside");
      const key = `${item.start}|${item.end}`;
      if (seen.has(key)) return fail("item_duplicate");
      seen.add(key);
      timed.push({ start: item.start, end: item.end });
    } else {
      if (item.last < item.first) return fail("item_order");
      if (item.first < tomorrow) return fail("item_past");
      if (item.first < item.gapFirst || item.last > item.gapLast) return fail("item_outside");
      if (item.last > addDays(item.first, POLL_MAX_DAYS - 1)) return fail("item_long");
      const key = `${item.first}|${item.last}`;
      if (seen.has(key)) return fail("item_duplicate");
      seen.add(key);
      days.push({ first: item.first, last: item.last });
    }
  }

  const deadline = deadlineOf(draft.deadlineDate, draft.deadlineTime, now);
  if (!deadline.ok) return { ok: false, problem: deadline.problem };
  const base = { title, ...(note !== "" ? { note } : {}), participants: [...draft.participants], deadline: deadline.value };
  return days.length > 0
    ? { ok: true, request: { ...base, kind: "days", proposals: days } }
    : { ok: true, request: { ...base, kind: "timed", proposals: timed } };
}
