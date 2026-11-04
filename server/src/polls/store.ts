import type {
  PollKind,
  PollSummary,
  PollView,
  Proposal,
  VoteAnswer,
  VoteView,
} from "@lueckenfueller/shared";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { findUserById, toPerson, type UserRow } from "../accounts/users.js";

export interface PollRow {
  id: number;
  share_token: string;
  creator_id: number | null;
  title: string;
  note: string;
  kind: PollKind;
  deadline: string | null;
  closed: number;
  /** The proposal chosen as the final date, or null. */
  fixed_proposal_id: number | null;
  fixed_at: string | null;
  /** Grows with every change of the fixed date (the SEQUENCE of the calendar event). */
  fixed_sequence: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  /** When the creator last sent a reminder, or null. */
  last_reminder_at: string | null;
}

/** A proposal as stored: the first two fields belong to `timed` polls, the last two to `days` polls. */
export interface NewProposal {
  startsAt: string | null;
  endsAt: string | null;
  firstDate: string | null;
  lastDate: string | null;
}

export interface ProposalRow {
  id: number;
  starts_at: string | null;
  ends_at: string | null;
  first_date: string | null;
  last_date: string | null;
}

export interface VoteRow {
  id: number;
  poll_id: number;
  user_id: number | null;
  guest_name: string | null;
  guest_name_key: string | null;
  key_hash: string | null;
}

/** A new share token: 128 random bits, 22 URL safe characters. */
export function generateShareToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Votes are accepted: not closed by hand, no date fixed, and the deadline (if any) has not been reached yet. */
export function isOpen(poll: PollRow, now: Date): boolean {
  return poll.closed === 0 && poll.fixed_proposal_id === null && (poll.deadline === null || poll.deadline > now.toISOString());
}

// An expired poll behaves as if it did not exist, whether or not `purgeExpired` has deleted its rows yet.

export function findPollById(db: DatabaseSync, id: number, now: Date): PollRow | undefined {
  return db.prepare("SELECT * FROM polls WHERE id = ? AND expires_at > ?").get(id, now.toISOString()) as
    | PollRow
    | undefined;
}

export function findPollByToken(db: DatabaseSync, token: string, now: Date): PollRow | undefined {
  return db.prepare("SELECT * FROM polls WHERE share_token = ? AND expires_at > ?").get(token, now.toISOString()) as
    | PollRow
    | undefined;
}

export function countPollsOfCreator(db: DatabaseSync, creatorId: number, now: Date): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM polls WHERE creator_id = ? AND expires_at > ?")
    .get(creatorId, now.toISOString()) as { n: number };
  return row.n;
}

export interface NewPoll {
  creatorId: number;
  title: string;
  note: string;
  kind: PollKind;
  deadline: string | null;
  proposals: NewProposal[];
  /** Account ids, the creator included. */
  participantIds: number[];
  createdAt: string;
  expiresAt: string;
}

/** Inserts the poll with its proposals and participants; call inside a transaction. Returns the poll's id. */
export function insertPoll(db: DatabaseSync, poll: NewPoll): number {
  const result = db
    .prepare(
      `INSERT INTO polls (share_token, creator_id, title, note, kind, deadline, closed, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      generateShareToken(),
      poll.creatorId,
      poll.title,
      poll.note,
      poll.kind,
      poll.deadline,
      poll.createdAt,
      poll.createdAt,
      poll.expiresAt,
    );
  const pollId = Number(result.lastInsertRowid);
  const insertProposal = db.prepare(
    "INSERT INTO poll_proposals (poll_id, position, starts_at, ends_at, first_date, last_date) VALUES (?, ?, ?, ?, ?, ?)",
  );
  poll.proposals.forEach((p, position) => {
    insertProposal.run(pollId, position, p.startsAt, p.endsAt, p.firstDate, p.lastDate);
  });
  const insertParticipant = db.prepare("INSERT INTO poll_participants (poll_id, user_id) VALUES (?, ?)");
  for (const userId of poll.participantIds) insertParticipant.run(pollId, userId);
  return pollId;
}

export interface PollChanges {
  title: string;
  note: string;
  deadline: string | null;
  closed: boolean;
}

export function updatePoll(db: DatabaseSync, id: number, changes: PollChanges, now: Date): void {
  db.prepare("UPDATE polls SET title = ?, note = ?, deadline = ?, closed = ?, updated_at = ? WHERE id = ?").run(
    changes.title,
    changes.note,
    changes.deadline,
    changes.closed ? 1 : 0,
    now.toISOString(),
    id,
  );
}

/**
 * Fixes `proposalId` (a proposal of this poll) as the final date, or changes the fixed date to it. Fixing the
 * proposal that is already fixed changes nothing but `updated_at`.
 */
export function fixProposal(db: DatabaseSync, poll: PollRow, proposalId: number, now: Date): void {
  const iso = now.toISOString();
  if (poll.fixed_proposal_id === proposalId) {
    touchPoll(db, poll.id, now);
    return;
  }
  db.prepare(
    "UPDATE polls SET fixed_proposal_id = ?, fixed_at = ?, fixed_sequence = fixed_sequence + 1, updated_at = ? WHERE id = ?",
  ).run(proposalId, iso, iso, poll.id);
}

/** Removes the fixed date. A poll that has none changes nothing but `updated_at`. */
export function unfixProposal(db: DatabaseSync, poll: PollRow, now: Date): void {
  if (poll.fixed_proposal_id === null) {
    touchPoll(db, poll.id, now);
    return;
  }
  db.prepare(
    "UPDATE polls SET fixed_proposal_id = NULL, fixed_at = NULL, fixed_sequence = fixed_sequence + 1, updated_at = ? WHERE id = ?",
  ).run(now.toISOString(), poll.id);
}

export function replaceShareToken(db: DatabaseSync, id: number, now: Date): string {
  const token = generateShareToken();
  db.prepare("UPDATE polls SET share_token = ?, updated_at = ? WHERE id = ?").run(token, now.toISOString(), id);
  return token;
}

export function touchPoll(db: DatabaseSync, id: number, now: Date): void {
  db.prepare("UPDATE polls SET updated_at = ? WHERE id = ?").run(now.toISOString(), id);
}

/** Deletes the poll; proposals, participants, votes and answers go with it. */
export function deletePoll(db: DatabaseSync, id: number): void {
  db.prepare("DELETE FROM polls WHERE id = ?").run(id);
}

/** The ids of the poll's proposals, in the order the creator chose them. */
export function proposalIdsOf(db: DatabaseSync, pollId: number): number[] {
  const rows = db.prepare("SELECT id FROM poll_proposals WHERE poll_id = ? ORDER BY position").all(pollId) as {
    id: number;
  }[];
  return rows.map((row) => row.id);
}

/** The poll's proposals as stored, in the order the creator chose them. */
export function proposalRowsOf(db: DatabaseSync, pollId: number): ProposalRow[] {
  return db
    .prepare("SELECT id, starts_at, ends_at, first_date, last_date FROM poll_proposals WHERE poll_id = ? ORDER BY position")
    .all(pollId) as unknown as ProposalRow[];
}

/** The people of the poll (the creator included), sorted by username without regard to case. */
export function participantsOf(db: DatabaseSync, pollId: number): UserRow[] {
  return db
    .prepare(
      `SELECT u.* FROM poll_participants pp JOIN users u ON u.id = pp.user_id
       WHERE pp.poll_id = ? ORDER BY u.username_key, u.id`,
    )
    .all(pollId) as unknown as UserRow[];
}

export function countGuestVotes(db: DatabaseSync, pollId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ? AND user_id IS NULL").get(pollId) as {
    n: number;
  };
  return row.n;
}

/** True when another guest vote of this poll (not `exceptVoteId`) already has this name key. */
export function guestNameInUse(db: DatabaseSync, pollId: number, nameKey: string, exceptVoteId: number): boolean {
  return (
    db
      .prepare("SELECT 1 FROM poll_votes WHERE poll_id = ? AND guest_name_key = ? AND id <> ?")
      .get(pollId, nameKey, exceptVoteId) !== undefined
  );
}

export function findGuestVote(db: DatabaseSync, pollId: number, voteId: number): VoteRow | undefined {
  return db
    .prepare("SELECT * FROM poll_votes WHERE id = ? AND poll_id = ? AND user_id IS NULL")
    .get(voteId, pollId) as VoteRow | undefined;
}

export function findAccountVote(db: DatabaseSync, pollId: number, userId: number): VoteRow | undefined {
  return db.prepare("SELECT * FROM poll_votes WHERE poll_id = ? AND user_id = ?").get(pollId, userId) as
    | VoteRow
    | undefined;
}

function replaceAnswers(db: DatabaseSync, voteId: number, answers: { proposalId: number; answer: VoteAnswer }[]): void {
  db.prepare("DELETE FROM poll_vote_answers WHERE vote_id = ?").run(voteId);
  const insert = db.prepare("INSERT INTO poll_vote_answers (vote_id, proposal_id, answer) VALUES (?, ?, ?)");
  for (const { proposalId, answer } of answers) insert.run(voteId, proposalId, answer);
}

type Answers = { proposalId: number; answer: VoteAnswer }[];

/** Casts or replaces the account's vote (one per account and poll). Call inside a transaction. */
export function saveAccountVote(db: DatabaseSync, pollId: number, userId: number, answers: Answers, now: Date): number {
  const iso = now.toISOString();
  const existing = findAccountVote(db, pollId, userId);
  let voteId: number;
  if (existing) {
    voteId = existing.id;
    db.prepare("UPDATE poll_votes SET updated_at = ? WHERE id = ?").run(iso, voteId);
  } else {
    const result = db
      .prepare("INSERT INTO poll_votes (poll_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(pollId, userId, iso, iso);
    voteId = Number(result.lastInsertRowid);
  }
  replaceAnswers(db, voteId, answers);
  return voteId;
}

/** Inserts a guest vote. Throws on a duplicate name (see `isUniqueViolation`). Call inside a transaction. */
export function insertGuestVote(
  db: DatabaseSync,
  vote: { pollId: number; name: string; nameKey: string; keyHash: string; answers: Answers; now: Date },
): number {
  const iso = vote.now.toISOString();
  const result = db
    .prepare(
      `INSERT INTO poll_votes (poll_id, guest_name, guest_name_key, key_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(vote.pollId, vote.name, vote.nameKey, vote.keyHash, iso, iso);
  const voteId = Number(result.lastInsertRowid);
  replaceAnswers(db, voteId, vote.answers);
  return voteId;
}

/** Changes a guest's name and answers. Throws on a duplicate name. Call inside a transaction. */
export function updateGuestVote(
  db: DatabaseSync,
  voteId: number,
  vote: { name: string; nameKey: string; answers: Answers; now: Date },
): void {
  db.prepare("UPDATE poll_votes SET guest_name = ?, guest_name_key = ?, updated_at = ? WHERE id = ?").run(
    vote.name,
    vote.nameKey,
    vote.now.toISOString(),
    voteId,
  );
  replaceAnswers(db, voteId, vote.answers);
}

/** Deletes a vote of this poll (its answers go with it); false when the poll has no such vote. */
export function deleteVote(db: DatabaseSync, pollId: number, voteId: number): boolean {
  return Number(db.prepare("DELETE FROM poll_votes WHERE id = ? AND poll_id = ?").run(voteId, pollId).changes) > 0;
}

/** Polls the person created, takes part in, or voted in; newest first. */
export function listPollSummaries(db: DatabaseSync, userId: number, now: Date): PollSummary[] {
  const rows = db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM poll_proposals WHERE poll_id = p.id) AS proposal_count,
         (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id) AS vote_count,
         EXISTS (SELECT 1 FROM poll_votes WHERE poll_id = p.id AND user_id = ?) AS voted
       FROM polls p
       WHERE p.expires_at > ? AND (
         p.creator_id = ?
         OR EXISTS (SELECT 1 FROM poll_participants WHERE poll_id = p.id AND user_id = ?)
         OR EXISTS (SELECT 1 FROM poll_votes WHERE poll_id = p.id AND user_id = ?)
       )
       ORDER BY p.created_at DESC, p.id DESC`,
    )
    .all(userId, now.toISOString(), userId, userId, userId) as unknown as (PollRow & {
    proposal_count: number;
    vote_count: number;
    voted: number;
  })[];
  return rows.map((row) => ({
    id: row.id,
    shareToken: row.share_token,
    title: row.title,
    kind: row.kind,
    creator: creatorOf(db, row),
    proposalCount: row.proposal_count,
    voteCount: row.vote_count,
    deadline: row.deadline,
    open: isOpen(row, now),
    fixedProposalId: row.fixed_proposal_id,
    fixedProposal: row.fixed_proposal_id === null ? null : (proposalsOf(db, row).find((p) => p.id === row.fixed_proposal_id) ?? null),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    voted: row.voted === 1,
  }));
}

function creatorOf(db: DatabaseSync, poll: PollRow): PollView["creator"] {
  const creator = poll.creator_id === null ? undefined : findUserById(db, poll.creator_id);
  return creator ? toPerson(creator) : null;
}

function proposalsOf(db: DatabaseSync, poll: PollRow): Proposal[] {
  return proposalRowsOf(db, poll.id).map((row) =>
    poll.kind === "timed"
      ? { id: row.id, start: row.starts_at!, end: row.ends_at! }
      : { id: row.id, first: row.first_date!, last: row.last_date! },
  );
}

function votesOf(db: DatabaseSync, pollId: number): VoteView[] {
  // Account votes first by username, then guests in the order they were cast.
  const votes = db
    .prepare(
      `SELECT v.id, v.user_id, v.guest_name, v.updated_at, u.username
       FROM poll_votes v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.poll_id = ?
       ORDER BY v.user_id IS NULL, u.username_key, v.id`,
    )
    .all(pollId) as unknown as {
    id: number;
    user_id: number | null;
    guest_name: string | null;
    updated_at: string;
    username: string | null;
  }[];
  const answerRows = db
    .prepare(
      `SELECT a.vote_id, a.proposal_id, a.answer
       FROM poll_vote_answers a JOIN poll_proposals p ON p.id = a.proposal_id
       WHERE p.poll_id = ?
       ORDER BY a.vote_id, p.position`,
    )
    .all(pollId) as unknown as { vote_id: number; proposal_id: number; answer: VoteAnswer }[];
  const answers = new Map<number, VoteView["answers"]>();
  for (const row of answerRows) {
    const list = answers.get(row.vote_id) ?? [];
    list.push({ proposalId: row.proposal_id, answer: row.answer });
    answers.set(row.vote_id, list);
  }
  return votes.map((vote) => ({
    id: vote.id,
    name: vote.username ?? vote.guest_name ?? "",
    personId: vote.user_id,
    answers: answers.get(vote.id) ?? [],
    updatedAt: vote.updated_at,
  }));
}

/** The poll as everybody with the link sees it; `viewer` (when logged in) fills `myVoteId` and `canManage`. */
export function buildPollView(db: DatabaseSync, poll: PollRow, viewer: UserRow | null, now: Date): PollView {
  const participants = participantsOf(db, poll.id);
  const myVote = viewer ? findAccountVote(db, poll.id, viewer.id) : undefined;
  const canManage = viewer !== null && (viewer.id === poll.creator_id || viewer.is_admin === 1);
  return {
    id: poll.id,
    shareToken: poll.share_token,
    title: poll.title,
    note: poll.note,
    kind: poll.kind,
    proposals: proposalsOf(db, poll),
    creator: creatorOf(db, poll),
    participants: participants.map(toPerson),
    votes: votesOf(db, poll.id),
    deadline: poll.deadline,
    closed: poll.closed === 1,
    open: isOpen(poll, now),
    fixedProposalId: poll.fixed_proposal_id,
    fixedAt: poll.fixed_proposal_id === null ? null : poll.fixed_at,
    createdAt: poll.created_at,
    expiresAt: poll.expires_at,
    myVoteId: myVote?.id ?? null,
    canManage,
    ...(canManage ? { lastReminderAt: poll.last_reminder_at } : {}),
  };
}
