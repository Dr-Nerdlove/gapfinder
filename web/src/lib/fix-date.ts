import type { FixCheck, PollPerson, PollView, Proposal } from "@lueckenfueller/shared";
import type { ApiResult } from "./api";
import { addDays } from "./gap-search";
import { errorMessage } from "./messages";

// Phase 5b: everything the "date is fixed" screens decide without the screen: which proposal is fixed, the
// "add to calendar" links, and what the check before fixing says.
//
// The app goes live at once, the server up to an hour later. A server without phase 5a sends no
// `fixedProposalId` at all: the types say `number | null`, so every read goes through `fixedIdOf`.

type FixedFields = { fixedProposalId?: number | null | undefined };

/** The fixed proposal's id, or null. `undefined` (an older server) counts as "no date fixed". */
export function fixedIdOf(poll: FixedFields): number | null {
  return typeof poll.fixedProposalId === "number" ? poll.fixedProposalId : null;
}

/** Whether the server knows about fixing dates at all (it sends the field). Only then are the buttons shown. */
export function serverCanFix(poll: FixedFields): boolean {
  return poll.fixedProposalId !== undefined;
}

/** The fixed proposal, or null while there is none (or the id matches no proposal). */
export function fixedProposal(poll: Pick<PollView, "proposals"> & FixedFields): Proposal | null {
  const id = fixedIdOf(poll);
  return id === null ? null : (poll.proposals.find((p) => p.id === id) ?? null);
}

// ---------- links for Google Calendar and Outlook ----------

/** What the "add to calendar" links need to know. Days: both ends included, like the proposal. */
export type CalendarEvent = { title: string; note: string } & (
  | { kind: "timed"; start: string; end: string }
  | { kind: "days"; first: string; last: string }
);

export function eventOf(poll: Pick<PollView, "title" | "note">, proposal: Proposal): CalendarEvent {
  const base = { title: poll.title, note: poll.note };
  return "first" in proposal
    ? { ...base, kind: "days", first: proposal.first, last: proposal.last }
    : { ...base, kind: "timed", start: proposal.start, end: proposal.end };
}

const enc = encodeURIComponent;

/** "20261212T130000Z" (Google wants this form for a timed event in UTC). */
function googleStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** "20261212" */
const googleDay = (day: string): string => day.replace(/-/g, "");

/**
 * Google Calendar's "create event" page. Format checked at the source (the maintained add-to-calendar notes,
 * https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/master/services/google.md):
 * `dates=START/END`, timed events as UTC `YYYYMMDDTHHmmssZ` on both sides, whole days as `YYYYMMDD` where the
 * end is the day after the last day (exclusive).
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const dates =
    event.kind === "timed"
      ? `${googleStamp(event.start)}/${googleStamp(event.end)}`
      : `${googleDay(event.first)}/${googleDay(addDays(event.last, 1))}`;
  const parts = [`action=TEMPLATE`, `text=${enc(event.title)}`, `dates=${dates}`];
  if (event.note !== "") parts.push(`details=${enc(event.note)}`);
  return `https://calendar.google.com/calendar/render?${parts.join("&")}`;
}

/** "2026-12-12T13:00:00Z" (Outlook's form for a timed event in UTC). */
function outlookStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Outlook on the web (private accounts, outlook.live.com), "new event" with the fields filled in. There is no
 * official Microsoft description; the format is taken from the maintained add-to-calendar notes
 * (https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/master/services/outlook-web.md,
 * last checked there 2026-08-19): `path`, `rru=addevent`, `subject`, `startdt`, `enddt`, optional `body`,
 * `allday=true` with plain dates. Whether `enddt` of an all-day event is exclusive is not documented anywhere;
 * it is sent exclusive (the day after the last day) like in Google Calendar and in the `.ics` file, and has to be
 * tried once with a real account.
 */
export function outlookCalendarUrl(event: CalendarEvent): string {
  const when =
    event.kind === "timed"
      ? [`startdt=${enc(outlookStamp(event.start))}`, `enddt=${enc(outlookStamp(event.end))}`]
      : [`startdt=${event.first}`, `enddt=${addDays(event.last, 1)}`, `allday=true`];
  const parts = [`path=${enc("/calendar/action/compose")}`, `rru=addevent`, `subject=${enc(event.title)}`, ...when];
  if (event.note !== "") parts.push(`body=${enc(event.note)}`);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${parts.join("&")}`;
}

// ---------- the check before fixing ----------

export type CheckReview =
  /** The calendars were read. `clear`: nobody is busy, unreadable or without a calendar. */
  | { kind: "checked"; check: FixCheck; clear: boolean }
  /** The check could not be made. Fixing is still allowed; `text` says why in plain words. */
  | { kind: "unchecked"; text: string };

/** What the confirmation shows. The check is a warning only and never stops anyone from fixing. */
export function reviewCheck(result: ApiResult<FixCheck>): CheckReview {
  if (result.ok) {
    const { busy, unreadable, noCalendar } = result.data;
    return { kind: "checked", check: result.data, clear: busy.length + unreadable.length + noCalendar.length === 0 };
  }
  if (result.kind === "error" && result.code === "calendars_unavailable") {
    return { kind: "unchecked", text: "Die Kalender-Prüfung ist auf dem Server noch nicht eingerichtet." };
  }
  return { kind: "unchecked", text: `Die Kalender konnten gerade nicht geprüft werden. ${errorMessage(result)}` };
}

const names = (people: readonly PollPerson[]): string => people.map((p) => p.username).join(", ");

/** The lines of the warning: only the groups that are not empty. */
export function warningLines(check: FixCheck): string[] {
  const lines: string[] = [];
  if (check.busy.length > 0) lines.push(`Laut Kalender nicht frei: ${names(check.busy)}`);
  if (check.unreadable.length > 0) lines.push(`Kalender nicht lesbar: ${names(check.unreadable)}`);
  if (check.noCalendar.length > 0) lines.push(`Kein Kalender verknüpft: ${names(check.noCalendar)}`);
  return lines;
}

/** The proposal the choice starts on: the fixed one, else the best one, else the first. */
export function startChoice(poll: Pick<PollView, "proposals"> & FixedFields, bestIds: readonly number[]): number | null {
  return fixedIdOf(poll) ?? bestIds[0] ?? poll.proposals[0]?.id ?? null;
}
