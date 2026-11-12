import type { GuestVoteCreated, PollView } from "@lueckenfueller/shared";
import * as realApi from "./api";
import type { ApiFailure, ApiResult, CallOptions } from "./api";
import { forgetGuestVote, guestVoteFor, liveGuestVote, rememberGuestVote, type StoredGuestVote } from "./guest-votes";
import { NAME_PROBLEM_TEXTS, checkGuestName, answersInput, type AnswerMap } from "./poll-view";
import { defaultStorage } from "./session-storage";

// What happens when someone votes or withdraws a vote: an account votes as itself, a guest with a name and the
// secret key their device keeps. The screens call these; the calls to the server are handed in so tests can
// replace them.

export interface VoteDeps {
  /** Runs one call to the server (with the login, if there is one) and keeps the session's state right. */
  run: <T>(call: (options: CallOptions) => Promise<ApiResult<T>>) => Promise<ApiResult<T>>;
  api?: Pick<typeof realApi, "castAccountVote" | "withdrawAccountVote" | "castGuestVote" | "changeGuestVote" | "withdrawGuestVote">;
  storage?: Storage | null;
}

export type VoteOutcome =
  | { kind: "done"; poll: PollView }
  /** The input is not complete; nothing was sent. */
  | { kind: "problem"; text: string }
  | { kind: "failed"; failure: ApiFailure };

export interface VoteInput {
  /** Logged in: the vote is the account's own. */
  loggedIn: boolean;
  name: string;
  answers: AnswerMap;
  /** The key this device kept for the poll, if any. */
  stored: StoredGuestVote | null;
}

/**
 * Loads the poll for its link. A device that keeps a guest vote for it sends the key (`X-Vote-Key`), so a poll with
 * hidden votes still shows the guest their own vote. Also used by the live refresh.
 */
export async function loadPoll(shareToken: string, deps: Pick<VoteDeps, "run" | "storage"> & { api?: Pick<typeof realApi, "getPollByLink"> }): Promise<ApiResult<PollView>> {
  const api = deps.api ?? realApi;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const key = guestVoteFor(shareToken, storage)?.voteKey;
  return deps.run((o) => api.getPollByLink(shareToken, key ? { ...o, voteKey: key } : o));
}

export const INCOMPLETE_ANSWERS_TEXT = "Bitte beantworte jeden Termin mit Ja, Vielleicht oder Nein.";

/** Casts the vote, or changes the one this person already has. */
export async function submitVote(poll: PollView, input: VoteInput, deps: VoteDeps): Promise<VoteOutcome> {
  const api = deps.api ?? realApi;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const body = answersInput(poll, input.answers);
  if (body === null) return { kind: "problem", text: INCOMPLETE_ANSWERS_TEXT };

  if (input.loggedIn) {
    const result = await deps.run((o) => api.castAccountVote(poll.shareToken, body, o));
    return result.ok ? { kind: "done", poll: result.data } : { kind: "failed", failure: result };
  }

  const name = checkGuestName(input.name);
  if (!name.ok) return { kind: "problem", text: NAME_PROBLEM_TEXTS[name.problem] };
  const request = { name: name.name, ...body };

  const mine = liveGuestVote(poll, input.stored);
  if (mine !== null) {
    const changed = await deps.run((o) => api.changeGuestVote(poll.shareToken, mine.voteId, request, { ...o, voteKey: mine.voteKey }));
    if (changed.ok) {
      rememberGuestVote(poll.shareToken, { ...mine, name: name.name }, storage);
      return { kind: "done", poll: changed.data };
    }
    // The vote was removed in the meantime: cast a new one below. Any other failure stops here.
    if (changed.kind !== "error" || changed.code !== "not_found") return { kind: "failed", failure: changed };
    forgetGuestVote(poll.shareToken, storage);
  }

  const created = await deps.run<GuestVoteCreated>((o) => api.castGuestVote(poll.shareToken, request, o));
  if (!created.ok) return { kind: "failed", failure: created };
  rememberGuestVote(poll.shareToken, { voteId: created.data.voteId, voteKey: created.data.voteKey, name: name.name }, storage);
  return { kind: "done", poll: created.data.poll };
}

/** Withdraws the vote of the account, or of this device's guest. */
export async function withdrawVote(poll: PollView, input: Pick<VoteInput, "loggedIn" | "stored">, deps: VoteDeps): Promise<VoteOutcome> {
  const api = deps.api ?? realApi;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  if (input.loggedIn) {
    const result = await deps.run((o) => api.withdrawAccountVote(poll.shareToken, o));
    return result.ok ? { kind: "done", poll: result.data } : { kind: "failed", failure: result };
  }
  const mine = liveGuestVote(poll, input.stored);
  if (mine === null) return { kind: "done", poll };
  const result = await deps.run((o) => api.withdrawGuestVote(poll.shareToken, mine.voteId, { ...o, voteKey: mine.voteKey }));
  if (result.ok) {
    forgetGuestVote(poll.shareToken, storage);
    return { kind: "done", poll: result.data };
  }
  if (result.kind === "error" && result.code === "not_found") {
    // Already gone on the server: forget the key and show the current state on the next refresh.
    forgetGuestVote(poll.shareToken, storage);
    return { kind: "done", poll: { ...poll, votes: poll.votes.filter((v) => v.id !== mine.voteId) } };
  }
  return { kind: "failed", failure: result };
}
