// Fixed dates as calendar events: the event of one poll, and the personal calendar feed.
import type { DatabaseSync } from "node:sqlite";
import type { FixedEvent } from "../calendars/ics-write.js";
import { generateShareToken, proposalRowsOf, type PollRow, type ProposalRow } from "./store.js";

function eventOf(
  poll: Pick<PollRow, "id" | "title" | "note" | "kind" | "fixed_at" | "fixed_sequence">,
  proposal: Omit<ProposalRow, "id">,
): FixedEvent {
  return {
    pollId: poll.id,
    title: poll.title,
    note: poll.note,
    when:
      poll.kind === "timed"
        ? { kind: "timed", start: proposal.starts_at!, end: proposal.ends_at! }
        : { kind: "days", first: proposal.first_date!, last: proposal.last_date! },
    fixedAt: poll.fixed_at!,
    sequence: poll.fixed_sequence,
  };
}

/** The event for the poll's fixed date, or null when the poll has none. */
export function fixedEventOfPoll(db: DatabaseSync, poll: PollRow): FixedEvent | null {
  if (poll.fixed_proposal_id === null || poll.fixed_at === null) return null;
  const proposal = proposalRowsOf(db, poll.id).find((row) => row.id === poll.fixed_proposal_id);
  return proposal === undefined ? null : eventOf(poll, proposal);
}

export function findFeedToken(db: DatabaseSync, userId: number): string | null {
  const row = db.prepare("SELECT token FROM calendar_feeds WHERE user_id = ?").get(userId) as
    | { token: string }
    | undefined;
  return row?.token ?? null;
}

/** Switches the person's feed on or renews it: a new token, the old one stops working. */
export function renewFeedToken(db: DatabaseSync, userId: number, now: Date): string {
  const token = generateShareToken();
  db.prepare(
    `INSERT INTO calendar_feeds (user_id, token, created_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET token = excluded.token, created_at = excluded.created_at`,
  ).run(userId, token, now.toISOString());
  return token;
}

export function deleteFeed(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM calendar_feeds WHERE user_id = ?").run(userId);
}

/** The person whose feed this token opens, or undefined. */
export function findFeedOwner(db: DatabaseSync, token: string): number | undefined {
  const row = db.prepare("SELECT user_id FROM calendar_feeds WHERE token = ?").get(token) as
    | { user_id: number }
    | undefined;
  return row?.user_id;
}

/**
 * The fixed dates of the polls the person created, takes part in, or voted in, except those where the person's
 * own account vote says "no" to the fixed proposal. Polls that are expired (or deleted) are not in it.
 */
export function feedEventsOf(db: DatabaseSync, userId: number, now: Date): FixedEvent[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.note, p.kind, p.fixed_at, p.fixed_sequence,
              pr.starts_at, pr.ends_at, pr.first_date, pr.last_date
       FROM polls p JOIN poll_proposals pr ON pr.id = p.fixed_proposal_id
       WHERE p.expires_at > ? AND p.fixed_at IS NOT NULL AND (
         p.creator_id = ?
         OR EXISTS (SELECT 1 FROM poll_participants WHERE poll_id = p.id AND user_id = ?)
         OR EXISTS (SELECT 1 FROM poll_votes WHERE poll_id = p.id AND user_id = ?)
       ) AND NOT EXISTS (
         SELECT 1 FROM poll_votes v JOIN poll_vote_answers a ON a.vote_id = v.id
         WHERE v.poll_id = p.id AND v.user_id = ? AND a.proposal_id = p.fixed_proposal_id AND a.answer = 'no'
       )
       ORDER BY COALESCE(pr.starts_at, pr.first_date), p.id`,
    )
    .all(now.toISOString(), userId, userId, userId, userId) as unknown as (Pick<
    PollRow,
    "id" | "title" | "note" | "kind" | "fixed_at" | "fixed_sequence"
  > &
    Omit<ProposalRow, "id">)[];
  return rows.map((row) => eventOf(row, row));
}
