import type { NotificationSettings } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";

/** An account that may get a notification, and the setting that has to be on for it. */
export interface Recipient {
  userId: number;
  setting: keyof NotificationSettings;
}

interface PollIds {
  id: number;
  creator_id: number | null;
}

const ids = (rows: unknown): number[] => (rows as { user_id: number }[]).map((row) => row.user_id);

/** The participants of the search (the creator included) that have no vote in the poll. */
export function participantsWithoutVote(db: DatabaseSync, pollId: number): number[] {
  return ids(
    db
      .prepare(
        `SELECT pp.user_id FROM poll_participants pp
         WHERE pp.poll_id = ? AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = pp.poll_id AND v.user_id = pp.user_id)`,
      )
      .all(pollId),
  );
}

/** "Involved": the creator, the participants and the accounts that voted. */
function involvedIds(db: DatabaseSync, poll: PollIds): number[] {
  const found = new Set<number>(ids(db.prepare("SELECT user_id FROM poll_participants WHERE poll_id = ?").all(poll.id)));
  for (const id of ids(db.prepare("SELECT user_id FROM poll_votes WHERE poll_id = ? AND user_id IS NOT NULL").all(poll.id))) {
    found.add(id);
  }
  if (poll.creator_id !== null) found.add(poll.creator_id);
  return [...found];
}

/** The creator gets the "own" setting, every other involved account the "others" one. The actor never gets one. */
function creatorAndOthers(
  db: DatabaseSync,
  poll: PollIds,
  actorId: number | null,
  own: keyof NotificationSettings,
  others: keyof NotificationSettings,
): Recipient[] {
  return involvedIds(db, poll)
    .filter((id) => id !== actorId)
    .map((userId) => ({ userId, setting: userId === poll.creator_id ? own : others }));
}

/** A new poll: every participant except the creator. */
export function pollCreatedRecipients(db: DatabaseSync, poll: PollIds): Recipient[] {
  const participants = ids(db.prepare("SELECT user_id FROM poll_participants WHERE poll_id = ?").all(poll.id));
  return participants
    .filter((id) => id !== poll.creator_id)
    .map((userId) => ({ userId, setting: "pollCreated" as const }));
}

/** A new or changed vote. */
export function voteRecipients(db: DatabaseSync, poll: PollIds, actorId: number | null): Recipient[] {
  return creatorAndOthers(db, poll, actorId, "voteOwn", "voteOthers");
}

/** The last participant without a vote has voted. */
export function allVotedRecipients(db: DatabaseSync, poll: PollIds, actorId: number | null): Recipient[] {
  return creatorAndOthers(db, poll, actorId, "allVotedOwn", "allVotedOthers");
}

/**
 * The date was fixed or changed to `proposalId`: involved accounts that answered "yes" or "maybe" to exactly
 * that proposal, and participants who have not voted. Whoever said "no" to it gets nothing.
 */
export function dateFixedRecipients(db: DatabaseSync, poll: PollIds, proposalId: number, actorId: number | null): Recipient[] {
  const agreeing = ids(
    db
      .prepare(
        `SELECT v.user_id FROM poll_votes v JOIN poll_vote_answers a ON a.vote_id = v.id
         WHERE v.poll_id = ? AND v.user_id IS NOT NULL AND a.proposal_id = ? AND a.answer IN ('yes', 'maybe')`,
      )
      .all(poll.id, proposalId),
  );
  const found = new Set([...agreeing, ...participantsWithoutVote(db, poll.id)]);
  return [...found].filter((id) => id !== actorId).map((userId) => ({ userId, setting: "dateFixed" as const }));
}

/** A reminder: the participants without a vote, except the creator who sends it. */
export function reminderRecipients(db: DatabaseSync, poll: PollIds): Recipient[] {
  return participantsWithoutVote(db, poll.id)
    .filter((id) => id !== poll.creator_id)
    .map((userId) => ({ userId, setting: "reminder" as const }));
}
