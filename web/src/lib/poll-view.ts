import {
  VOTE_NAME_MAX_LENGTH,
  type PollPerson,
  type PollSummary,
  type PollView,
  type Proposal,
  type VoteAnswer,
  type VoteAnswersInput,
  type VoteView,
} from "@lueckenfueller/shared";
import type { ApiResult } from "./api";
import { berlinToday, formatClock, formatDay, formatStretch } from "./gap-search";
import { fixedIdOf } from "./fix-date";
import { errorMessage } from "./messages";

// Everything the poll pages show or decide without the screen: texts, sums, who has not voted, the answers a
// person is about to send and the page's state across refreshes (also while the server sleeps).

export const ANSWER_LABELS: Record<VoteAnswer, string> = { yes: "Ja", maybe: "Vielleicht", no: "Nein" };
export const ANSWERS: VoteAnswer[] = ["yes", "maybe", "no"];

// ---------- texts ----------

/** "Mi 2.12., 20:00" */
export function formatInstant(iso: string): string {
  return `${formatDay(berlinToday(new Date(iso)))}, ${formatClock(iso)}`;
}

/** The date and time of a proposal in one line: "Sa 12.12., 14:00–17:00" or "14.–28. Feb." */
export function proposalLabel(proposal: Proposal): string {
  if ("first" in proposal) return formatStretch(proposal.first, proposal.last);
  const day = berlinToday(new Date(proposal.start));
  const endDay = berlinToday(new Date(proposal.end));
  const end = day === endDay ? formatClock(proposal.end) : `${formatDay(endDay)}, ${formatClock(proposal.end)}`;
  return `${formatDay(day)}, ${formatClock(proposal.start)}–${end}`;
}

/** The two lines of a column heading: the day and the time (or the days of a run). */
export function proposalHeading(proposal: Proposal): { top: string; bottom: string } {
  if ("first" in proposal) return { top: formatStretch(proposal.first, proposal.last), bottom: "" };
  const day = berlinToday(new Date(proposal.start));
  const endDay = berlinToday(new Date(proposal.end));
  const time = `${formatClock(proposal.start)}–${formatClock(proposal.end)}`;
  return { top: formatDay(day), bottom: day === endDay ? time : `${time} (bis ${formatDay(endDay)})` };
}

/**
 * Whether and until when the poll takes votes. A fixed date comes first: fixing makes the poll not `open`, but
 * that is no "Frist abgelaufen" and no "von Hand geschlossen".
 */
export function statusText(poll: Pick<PollView, "closed" | "open" | "deadline"> & { fixedProposalId?: number | null | undefined }): string {
  if (fixedIdOf(poll) !== null) return "Der Termin steht";
  if (poll.closed) return "Beendet (von Hand geschlossen)";
  if (!poll.open) return poll.deadline ? `Beendet (Frist am ${formatInstant(poll.deadline)} abgelaufen)` : "Beendet";
  return poll.deadline ? `Abstimmen möglich bis ${formatInstant(poll.deadline)}` : "Abstimmen ohne Frist";
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "2 Termine · 3 Stimmen · offen bis Mi 2.12., 20:00" */
export function summaryLine(poll: PollSummary): string {
  const state = poll.open ? (poll.deadline ? `offen bis ${formatInstant(poll.deadline)}` : "offen") : "beendet";
  return `${plural(poll.proposalCount, "Termin", "Termine")} · ${plural(poll.voteCount, "Stimme", "Stimmen")} · ${state}`;
}

/**
 * The tag of a fixed date in the list: "Termin steht: Sa 12.12., 13:00–15:00". An older server sends no
 * `fixedProposal` (or null): then only "Termin steht ✓".
 */
export function fixedTag(poll: { fixedProposal?: Proposal | null | undefined }): string {
  return poll.fixedProposal ? `Termin steht: ${proposalLabel(poll.fixedProposal)}` : "Termin steht ✓";
}

/** The hint under a poll in the list: only while the person can still vote. */
export function needsVote(poll: Pick<PollSummary, "open" | "voted">): boolean {
  return poll.open && !poll.voted;
}

/** "20:14" for the line "Zuletzt aktualisiert". */
export function updatedText(at: Date): string {
  return formatClock(at.toISOString());
}

// ---------- sums and who is missing ----------

export interface Tally {
  proposalId: number;
  yes: number;
  maybe: number;
  no: number;
}

/** The sums for each proposal, in the order of the proposals. */
export function tallies(poll: Pick<PollView, "proposals" | "votes">): Tally[] {
  return poll.proposals.map((proposal) => {
    const tally: Tally = { proposalId: proposal.id, yes: 0, maybe: 0, no: 0 };
    for (const vote of poll.votes) {
      const answer = vote.answers.find((a) => a.proposalId === proposal.id)?.answer;
      if (answer !== undefined) tally[answer]++;
    }
    return tally;
  });
}

/** The proposals with the most "Ja" (ties: the fewest "Nein"); none while nobody has said yes. */
export function bestProposalIds(poll: Pick<PollView, "proposals" | "votes">): number[] {
  const all = tallies(poll);
  const best = all.reduce<Tally | null>((top, t) => (top === null || t.yes > top.yes || (t.yes === top.yes && t.no < top.no) ? t : top), null);
  if (best === null || best.yes === 0) return [];
  return all.filter((t) => t.yes === best.yes && t.no === best.no).map((t) => t.proposalId);
}

/** The columns to highlight: the fixed date once there is one, otherwise the best proposals. */
export function highlightedProposalIds(poll: Pick<PollView, "proposals" | "votes"> & { fixedProposalId?: number | null | undefined }): number[] {
  const fixed = fixedIdOf(poll);
  return fixed !== null ? [fixed] : bestProposalIds(poll);
}

/** The sum as text: "3 Ja", or "2 Ja · 1 Vielleicht · 1 Nein" (only what is not zero). */
export function tallyText(tally: Tally): string {
  const parts = [
    tally.yes > 0 ? `${tally.yes} Ja` : "",
    tally.maybe > 0 ? `${tally.maybe} Vielleicht` : "",
    tally.no > 0 ? `${tally.no} Nein` : "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? "–" : parts.join(" · ");
}

/** The answer of a vote for a proposal. */
export function answerOf(vote: VoteView, proposalId: number): VoteAnswer | null {
  return vote.answers.find((a) => a.proposalId === proposalId)?.answer ?? null;
}

/** The people of the search who have no account vote yet (guests are not on the list of participants). */
export function notVotedYet(poll: Pick<PollView, "participants" | "votes">): PollPerson[] {
  const voted = new Set(poll.votes.flatMap((v) => (v.personId === null ? [] : [v.personId])));
  return poll.participants.filter((p) => !voted.has(p.id));
}

// ---------- the vote the person is about to send ----------

export type AnswerMap = Record<number, VoteAnswer>;

/** The answers of an existing vote, to fill the form. */
export function answersOfVote(poll: Pick<PollView, "votes">, voteId: number | null): AnswerMap {
  const map: AnswerMap = {};
  const vote = poll.votes.find((v) => v.id === voteId);
  for (const a of vote?.answers ?? []) map[a.proposalId] = a.answer;
  return map;
}

/** The proposals that have no answer yet. */
export function unanswered(poll: Pick<PollView, "proposals">, answers: AnswerMap): Proposal[] {
  return poll.proposals.filter((p) => answers[p.id] === undefined);
}

/** One answer for every proposal, or null while some are missing. */
export function answersInput(poll: Pick<PollView, "proposals">, answers: AnswerMap): VoteAnswersInput | null {
  if (unanswered(poll, answers).length > 0) return null;
  return { answers: poll.proposals.map((p) => ({ proposalId: p.id, answer: answers[p.id]! })) };
}

export type NameProblem = "empty" | "long";

export const NAME_PROBLEM_TEXTS: Record<NameProblem, string> = {
  empty: "Bitte gib deinen Namen ein.",
  long: `Der Name darf höchstens ${VOTE_NAME_MAX_LENGTH} Zeichen lang sein.`,
};

/** The name as it is sent (trimmed, blanks merged) or what is wrong with it. */
export function checkGuestName(raw: string): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, problem: "empty" };
  if ([...name].length > VOTE_NAME_MAX_LENGTH) return { ok: false, problem: "long" };
  return { ok: true, name };
}

// ---------- the page's state across refreshes ----------

export type PollScreen =
  | { phase: "loading" }
  /** The poll is shown. `offline`: the last refresh got no answer, so this is an older state. */
  | { phase: "ready"; poll: PollView; updatedAt: Date; offline: boolean; problem: string }
  /** The server did not answer and there is nothing to show yet. */
  | { phase: "waiting" }
  /** The link is unknown, replaced or the poll deleted. */
  | { phase: "gone" }
  | { phase: "failed"; message: string };

/** What the page shows after a refresh. An older state stays on screen when the server is asleep or hiccups. */
export function nextScreen(previous: PollScreen, result: ApiResult<PollView>, now: Date): PollScreen {
  if (result.ok) return { phase: "ready", poll: result.data, updatedAt: now, offline: false, problem: "" };
  if (result.kind === "error" && result.code === "poll_invalid") {
    return { phase: "gone" };
  }
  if (previous.phase === "ready") {
    return result.kind === "offline" ? { ...previous, offline: true } : { ...previous, problem: errorMessage(result) };
  }
  return result.kind === "offline" ? { phase: "waiting" } : { phase: "failed", message: errorMessage(result) };
}
