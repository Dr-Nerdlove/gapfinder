// The calendar check on the poll page (`PollCalendarCheck`): the "Nicht berücksichtigt" notices and the hint
// under each proposal of the vote form. Pure functions; the page loads the check. Nothing here changes a vote.
import type { PollCalendarCheck, PollView, VoteAnswer } from "@lueckenfueller/shared";
import { skippedNotices } from "./gap-search";

export interface CalendarHint {
  tone: "free" | "busy" | "conflict";
  text: string;
}

/** One line per participant who was left out, in the texts of the search ("Du" for the logged-in viewer). */
export function pollSkippedNotices(check: PollCalendarCheck, viewerId: number | null): string[] {
  return skippedNotices(
    check.skipped.map((s) => ({ personId: s.person.id, reason: s.reason })),
    check.skipped.map((s) => s.person),
    viewerId ?? -1,
  );
}

/** What the viewer's own calendar says about a proposal, or null when it says nothing (guest, no readable calendar). */
export function ownCalendarHint(
  check: PollCalendarCheck | null,
  proposalId: number,
  answer?: VoteAnswer,
): CalendarHint | null {
  const mine = check?.mine;
  if (!mine || !mine.readable) return null;
  if (!mine.busyProposalIds.includes(proposalId)) return { tone: "free", text: "Laut deinem Kalender frei" };
  if (answer === "yes") return { tone: "conflict", text: "Laut deinem Kalender belegt – du hast „Ja“ gewählt" };
  return { tone: "busy", text: "Laut deinem Kalender belegt" };
}

/** Nothing to show when the proposal is not part of the poll (e.g. the poll changed after the check). */
export const hintFor =
  (check: PollCalendarCheck | null, poll: Pick<PollView, "proposals">) =>
  (proposalId: number, answer?: VoteAnswer): CalendarHint | null =>
    poll.proposals.some((p) => p.id === proposalId) ? ownCalendarHint(check, proposalId, answer) : null;
