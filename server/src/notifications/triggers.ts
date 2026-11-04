import type { NotificationData, Proposal } from "@lueckenfueller/shared";
import type { AppContext } from "../context.js";
import { proposalRowsOf, type PollRow } from "../polls/store.js";
import { notify } from "./dispatch.js";
import {
  allVotedRecipients,
  dateFixedRecipients,
  participantsWithoutVote,
  pollCreatedRecipients,
  reminderRecipients,
  voteRecipients,
} from "./recipients.js";

/** The poll fields a notification needs. */
type PollInfo = Pick<PollRow, "id" | "creator_id" | "title" | "share_token" | "kind">;

const base = (poll: PollInfo) => ({ pollTitle: poll.title, shareToken: poll.share_token });

/** A new poll was created by `actorName`. */
export function notifyPollCreated(ctx: AppContext, poll: PollInfo, actorName: string): void {
  const data: NotificationData = { kind: "poll_created", ...base(poll), actorName };
  notify(ctx, poll.id, data, pollCreatedRecipients(ctx.db, poll));
}

/** How many participants still have no vote; call before and after a vote is saved to see the last gap close. */
export function missingVotes(ctx: AppContext, pollId: number): number {
  return participantsWithoutVote(ctx.db, pollId).length;
}

/**
 * Someone voted (a new or changed vote; withdrawing sends nothing). `actorId` is null for a guest. `missingBefore`
 * is `missingVotes` from before the vote was saved: `all_voted` goes out once, when this vote filled the last gap.
 */
export function notifyVote(ctx: AppContext, poll: PollInfo, actorId: number | null, actorName: string, missingBefore: number): void {
  notify(ctx, poll.id, { kind: "vote", ...base(poll), actorName }, voteRecipients(ctx.db, poll, actorId));
  if (missingBefore > 0 && missingVotes(ctx, poll.id) === 0) {
    notify(ctx, poll.id, { kind: "all_voted", ...base(poll), actorName }, allVotedRecipients(ctx.db, poll, actorId));
  }
}

/** The date was fixed or changed to `proposalId` by `actorName`. */
export function notifyDateFixed(ctx: AppContext, poll: PollInfo, proposalId: number, actorId: number, actorName: string): void {
  const row = proposalRowsOf(ctx.db, poll.id).find((r) => r.id === proposalId);
  if (!row) return;
  const proposal: Proposal =
    poll.kind === "timed"
      ? { id: row.id, start: row.starts_at!, end: row.ends_at! }
      : { id: row.id, first: row.first_date!, last: row.last_date! };
  const data: NotificationData = { kind: "date_fixed", ...base(poll), actorName, proposal };
  notify(ctx, poll.id, data, dateFixedRecipients(ctx.db, poll, proposalId, actorId));
}

/** The creator reminds the participants who have not voted. Returns how many accounts got it. */
export function notifyReminder(ctx: AppContext, poll: PollInfo, actorName: string): number {
  return notify(ctx, poll.id, { kind: "reminder", ...base(poll), actorName }, reminderRecipients(ctx.db, poll));
}
