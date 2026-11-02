import {
  normalizeName,
  POLL_KEPT_DAYS_AFTER_LAST_PROPOSAL,
  POLL_MAX_DAYS,
  POLL_MAX_DAYS_AHEAD,
  POLL_MAX_PROPOSALS,
  POLL_MAX_TIMED_MINUTES,
  POLL_NOTE_MAX_LENGTH,
  POLL_TITLE_MAX_LENGTH,
  usernameKey,
  VOTE_NAME_MAX_LENGTH,
  type PollKind,
  type VoteAnswer,
} from "@lueckenfueller/shared";
import { validation } from "../errors.js";
import {
  addDays,
  berlinDateOf,
  berlinWallToUtc,
  dayNumber,
  formatDateParts,
  parseDateParts,
  type DateParts,
} from "../time.js";
import type { NewProposal } from "./store.js";

const MINUTE_MS = 60 * 1000;
/** `2026-11-07T18:00Z`, with optional `:00` or `:00.000`: the forms `toISOString()` and a date picker produce. */
const INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::00(?:\.000)?)?Z$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

/** What the JSON schema lets through for a new poll; every rule beyond the types is checked here. */
export interface RawCreatePoll {
  title: string;
  note?: string;
  kind: PollKind;
  proposals: { start?: string; end?: string; first?: string; last?: string }[];
  participants: number[];
  deadline?: string | null;
}

export interface CheckedPoll {
  title: string;
  note: string;
  kind: PollKind;
  proposals: NewProposal[];
  /** Each id once, the order of the request. Whether the accounts exist is checked by the caller. */
  participantIds: number[];
  deadline: string | null;
  expiresAt: Date;
}

const codePoints = (text: string): number => [...text].length;

export function checkedTitle(raw: string): string {
  const title = normalizeName(raw);
  const length = codePoints(title);
  if (length < 1 || length > POLL_TITLE_MAX_LENGTH || CONTROL_CHARACTER.test(title)) throw validation("title");
  return title;
}

/** Trimmed, line breaks kept (as `\n`), at most `POLL_NOTE_MAX_LENGTH` characters, empty allowed. */
export function checkedNote(raw: string): string {
  const note = raw.replace(/\r\n/g, "\n").normalize("NFC").trim();
  if (codePoints(note) > POLL_NOTE_MAX_LENGTH || CONTROL_CHARACTER.test(note.replace(/\n/g, ""))) {
    throw validation("note");
  }
  return note;
}

export function checkedGuestName(raw: string): { name: string; key: string } {
  const name = normalizeName(raw);
  const length = codePoints(name);
  if (length < 1 || length > VOTE_NAME_MAX_LENGTH || CONTROL_CHARACTER.test(name)) throw validation("name");
  return { name, key: usernameKey(name) };
}

/** A UTC instant in the accepted forms as a `Date`, or null (also for dates that do not exist). */
function parseInstant(text: unknown): Date | null {
  if (typeof text !== "string") return null;
  const match = INSTANT_PATTERN.exec(text);
  if (match === null) return null;
  const canonical = `${match[1]}:00.000Z`;
  const date = new Date(canonical);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== canonical) return null;
  return date;
}

/** A deadline in the future, at most `POLL_MAX_DAYS_AHEAD` days ahead; returned as `toISOString()`. */
export function checkedDeadline(raw: string, now: Date): string {
  const date = parseInstant(raw);
  if (date === null || date <= now || date > addDays(now, POLL_MAX_DAYS_AHEAD)) throw validation("deadline");
  return date.toISOString();
}

function timedProposals(raw: RawCreatePoll["proposals"], now: Date): NewProposal[] {
  const latest = addDays(now, POLL_MAX_DAYS_AHEAD);
  return raw.map((item) => {
    if (item.first !== undefined || item.last !== undefined) throw validation("proposals");
    const start = parseInstant(item.start);
    const end = parseInstant(item.end);
    if (start === null || end === null) throw validation("proposals");
    if (start.getUTCMinutes() % 15 !== 0 || end.getUTCMinutes() % 15 !== 0) throw validation("proposals");
    if (start <= now || start > latest || end <= start) throw validation("proposals");
    if ((end.getTime() - start.getTime()) / MINUTE_MS > POLL_MAX_TIMED_MINUTES) throw validation("proposals");
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), firstDate: null, lastDate: null };
  });
}

interface DaysRange {
  proposal: NewProposal;
  last: DateParts;
}

function daysProposals(raw: RawCreatePoll["proposals"], now: Date): DaysRange[] {
  const today = dayNumber(berlinDateOf(now));
  return raw.map((item) => {
    if (item.start !== undefined || item.end !== undefined) throw validation("proposals");
    const first = typeof item.first === "string" ? parseDateParts(item.first) : null;
    const last = typeof item.last === "string" ? parseDateParts(item.last) : null;
    if (first === null || last === null) throw validation("proposals");
    const firstDay = dayNumber(first);
    const lastDay = dayNumber(last);
    if (firstDay < today + 1 || lastDay < firstDay || lastDay - firstDay + 1 > POLL_MAX_DAYS) {
      throw validation("proposals");
    }
    if (lastDay > today + POLL_MAX_DAYS_AHEAD) throw validation("proposals");
    return {
      proposal: { startsAt: null, endsAt: null, firstDate: formatDateParts(first), lastDate: formatDateParts(last) },
      last,
    };
  });
}

/**
 * When the poll is deleted: `POLL_KEPT_DAYS_AFTER_LAST_PROPOSAL` days after the last proposal has ended (for
 * whole days: after German midnight following the latest last day).
 */
function expiryOf(kind: PollKind, proposals: NewProposal[], lastDays: DateParts[]): Date {
  if (kind === "timed") {
    const latestEnd = Math.max(...proposals.map((p) => Date.parse(p.endsAt!)));
    return addDays(new Date(latestEnd), POLL_KEPT_DAYS_AFTER_LAST_PROPOSAL);
  }
  const latest = lastDays.reduce((a, b) => (dayNumber(b) > dayNumber(a) ? b : a));
  return addDays(berlinWallToUtc(latest.year, latest.month, latest.day + 1, 0), POLL_KEPT_DAYS_AFTER_LAST_PROPOSAL);
}

/** Throws `validation(field)` for the first broken rule. */
export function checkedPoll(raw: RawCreatePoll, now: Date): CheckedPoll {
  const title = checkedTitle(raw.title);
  const note = checkedNote(raw.note ?? "");
  if (raw.proposals.length < 1 || raw.proposals.length > POLL_MAX_PROPOSALS) throw validation("proposals");

  let proposals: NewProposal[];
  let lastDays: DateParts[] = [];
  if (raw.kind === "timed") {
    proposals = timedProposals(raw.proposals, now);
  } else {
    const ranges = daysProposals(raw.proposals, now);
    proposals = ranges.map((range) => range.proposal);
    lastDays = ranges.map((range) => range.last);
  }
  const keys = proposals.map((p) => `${p.startsAt ?? p.firstDate}|${p.endsAt ?? p.lastDate}`);
  if (new Set(keys).size !== keys.length) throw validation("proposals");

  const deadline = raw.deadline === undefined || raw.deadline === null ? null : checkedDeadline(raw.deadline, now);
  return {
    title,
    note,
    kind: raw.kind,
    proposals,
    participantIds: [...new Set(raw.participants)],
    deadline,
    expiresAt: expiryOf(raw.kind, proposals, lastDays),
  };
}

/**
 * Exactly one answer for every proposal of the poll, each proposal once. Returned in the order of
 * `proposalIds`.
 */
export function checkedAnswers(
  raw: { proposalId: number; answer: VoteAnswer }[],
  proposalIds: number[],
): { proposalId: number; answer: VoteAnswer }[] {
  const byProposal = new Map(raw.map((item) => [item.proposalId, item.answer]));
  if (raw.length !== proposalIds.length || byProposal.size !== raw.length) throw validation("answers");
  return proposalIds.map((proposalId) => {
    const answer = byProposal.get(proposalId);
    if (answer === undefined) throw validation("answers");
    return { proposalId, answer };
  });
}
