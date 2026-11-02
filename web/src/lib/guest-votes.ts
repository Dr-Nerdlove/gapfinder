import type { PollView } from "@lueckenfueller/shared";
import { defaultStorage } from "./session-storage";

// A guest has no account, so the device keeps the secret vote key the server gave out (per poll link). With it
// the guest can change or withdraw their vote later; another device or cleared site data starts a new vote.

export const GUEST_VOTES_KEY = "lueckenfueller.guest-votes";
/** Votes of old polls pile up on a device; the oldest are forgotten beyond this. */
export const GUEST_VOTES_KEPT = 50;

export interface StoredGuestVote {
  voteId: number;
  voteKey: string;
  name: string;
}

interface Stored {
  /** The name the guest used last, to fill the field on the next poll. */
  name: string;
  votes: Record<string, StoredGuestVote>;
}

const empty = (): Stored => ({ name: "", votes: {} });

function isVote(value: unknown): value is StoredGuestVote {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["voteId"] === "number" && Number.isInteger(v["voteId"]) && typeof v["voteKey"] === "string" && v["voteKey"] !== "" && typeof v["name"] === "string";
}

function read(storage: Storage | null): Stored {
  try {
    const raw = storage?.getItem(GUEST_VOTES_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty();
    const { name, votes } = parsed as Record<string, unknown>;
    const out = empty();
    if (typeof name === "string") out.name = name;
    if (typeof votes === "object" && votes !== null) {
      for (const [token, vote] of Object.entries(votes)) if (isVote(vote)) out.votes[token] = vote;
    }
    return out;
  } catch {
    return empty();
  }
}

function write(stored: Stored, storage: Storage | null): void {
  try {
    storage?.setItem(GUEST_VOTES_KEY, JSON.stringify(stored));
  } catch {
    // Without storage the guest can change the vote until the page is closed.
  }
}

export function guestVoteFor(shareToken: string, storage: Storage | null = defaultStorage()): StoredGuestVote | null {
  return read(storage).votes[shareToken] ?? null;
}

export function lastGuestName(storage: Storage | null = defaultStorage()): string {
  return read(storage).name;
}

export function rememberGuestVote(shareToken: string, vote: StoredGuestVote, storage: Storage | null = defaultStorage()): void {
  const stored = read(storage);
  delete stored.votes[shareToken];
  stored.votes[shareToken] = vote;
  stored.name = vote.name;
  const tokens = Object.keys(stored.votes);
  for (const old of tokens.slice(0, Math.max(0, tokens.length - GUEST_VOTES_KEPT))) delete stored.votes[old];
  write(stored, storage);
}

export function forgetGuestVote(shareToken: string, storage: Storage | null = defaultStorage()): void {
  const stored = read(storage);
  if (!(shareToken in stored.votes)) return;
  delete stored.votes[shareToken];
  write(stored, storage);
}

/**
 * The remembered vote if the poll still has it as a guest vote; otherwise null (the creator removed it, or the
 * poll's link was renewed).
 */
export function liveGuestVote(poll: Pick<PollView, "votes">, stored: StoredGuestVote | null): StoredGuestVote | null {
  if (stored === null) return null;
  return poll.votes.some((v) => v.id === stored.voteId && v.personId === null) ? stored : null;
}
