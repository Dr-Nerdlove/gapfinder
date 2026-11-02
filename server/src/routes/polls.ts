import {
  GUEST_VOTE_WRITES_PER_IP,
  POLL_MAX_PARTICIPANTS,
  POLL_MAX_GUEST_VOTES,
  POLL_MAX_PROPOSALS,
  POLLS_PER_USER,
  type AccountVoteRequest,
  type CreatePollRequest,
  type GuestVoteCreated,
  type GuestVoteRequest,
  type NewShareLink,
  type PollList,
  type PollView,
  type UpdatePollRequest,
} from "@lueckenfueller/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { findUserById, findUserByKey, type UserRow } from "../accounts/users.js";
import { authOf, createGuards, optionalUser } from "../auth/guards.js";
import { TOKEN_FAILURES_PER_IP } from "../auth/rate-limit.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import type { AppContext } from "../context.js";
import { inTransaction, isUniqueViolation } from "../db.js";
import { ApiError, forbidden, notFound, validation } from "../errors.js";
import {
  buildPollView,
  countGuestVotes,
  countPollsOfCreator,
  deletePoll,
  deleteVote,
  findAccountVote,
  findGuestVote,
  findPollById,
  findPollByToken,
  guestNameInUse,
  insertGuestVote,
  insertPoll,
  isOpen,
  listPollSummaries,
  proposalIdsOf,
  replaceShareToken,
  saveAccountVote,
  touchPoll,
  updateGuestVote,
  updatePoll,
  type PollRow,
  type VoteRow,
} from "../polls/store.js";
import {
  checkedAnswers,
  checkedDeadline,
  checkedGuestName,
  checkedNote,
  checkedPoll,
  checkedTitle,
  type RawCreatePoll,
} from "../polls/validation.js";
import { clientKey, enforceLimits, idParam } from "./shared.js";

const instant = { type: "string", maxLength: 40 } as const;
const answersSchema = {
  type: "array",
  // One answer per proposal, none more.
  maxItems: POLL_MAX_PROPOSALS,
  items: {
    type: "object",
    required: ["proposalId", "answer"],
    properties: { proposalId: { type: "integer" }, answer: { enum: ["yes", "maybe", "no"] } },
  },
} as const;

const createBody = {
  type: "object",
  required: ["title", "kind", "proposals", "participants"],
  properties: {
    title: { type: "string", maxLength: 1000 },
    note: { type: "string", maxLength: 5000 },
    kind: { enum: ["timed", "days"] },
    proposals: {
      type: "array",
      maxItems: POLL_MAX_PROPOSALS,
      items: {
        type: "object",
        properties: { start: instant, end: instant, first: instant, last: instant },
      },
    },
    // The creator may be in the list too.
    participants: { type: "array", maxItems: POLL_MAX_PARTICIPANTS + 1, items: { type: "integer" } },
    deadline: { type: ["string", "null"], maxLength: 40 },
  },
} as const;

const updateBody = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 1000 },
    note: { type: "string", maxLength: 5000 },
    deadline: { type: ["string", "null"], maxLength: 40 },
    closed: { type: "boolean" },
  },
} as const;

const accountVoteBody = {
  type: "object",
  required: ["answers"],
  properties: { answers: answersSchema },
} as const;

const guestVoteBody = {
  type: "object",
  required: ["name", "answers"],
  properties: { name: { type: "string", maxLength: 1000 }, answers: answersSchema },
} as const;

/** A numeric id segment of the URL, or null when it cannot be an id. */
function numberParam(request: FastifyRequest, name: string): number | null {
  const raw = (request.params as Record<string, string | undefined>)[name] ?? "";
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/** The vote key header; anything that is not one plain, reasonably short value counts as missing. */
function voteKeyHeader(request: FastifyRequest): string | null {
  const value = request.headers["x-vote-key"];
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

export function registerPollRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  // --- Managing polls (login; creator or admin) ---

  /** The poll with this id for its creator or an admin; an expired poll does not exist. */
  function manageablePollOrFail(request: FastifyRequest): { poll: PollRow; user: UserRow } {
    const { user } = authOf(request);
    const poll = findPollById(ctx.db, idParam(request), ctx.now());
    if (!poll) throw notFound();
    if (poll.creator_id !== user.id && user.is_admin !== 1) throw forbidden();
    return { poll, user };
  }

  const viewFor = (pollId: number, viewer: UserRow | null): PollView => {
    // Read again: the poll row may have changed since the caller loaded it.
    const poll = findPollById(ctx.db, pollId, ctx.now())!;
    return buildPollView(ctx.db, poll, viewer, ctx.now());
  };

  app.post<{ Body: CreatePollRequest }>(
    "/api/polls",
    { onRequest: requireUser, schema: { body: createBody } },
    async (request, reply): Promise<PollView> => {
      const { user } = authOf(request);
      const now = ctx.now();
      const checked = checkedPoll(request.body as unknown as RawCreatePoll, now);
      // Unknown accounts (e.g. deleted since the search) are ignored; the creator is always a participant.
      const others = checked.participantIds.filter((id) => id !== user.id && findUserById(ctx.db, id) !== undefined);
      if (others.length > POLL_MAX_PARTICIPANTS) throw validation("participants");

      const pollId = inTransaction(ctx.db, () => {
        if (countPollsOfCreator(ctx.db, user.id, now) >= POLLS_PER_USER) throw new ApiError(409, "poll_limit");
        return insertPoll(ctx.db, {
          creatorId: user.id,
          title: checked.title,
          note: checked.note,
          kind: checked.kind,
          deadline: checked.deadline,
          proposals: checked.proposals,
          participantIds: [user.id, ...others],
          createdAt: now.toISOString(),
          expiresAt: checked.expiresAt.toISOString(),
        });
      });
      return reply.status(201).send(viewFor(pollId, user));
    },
  );

  app.get("/api/polls", { onRequest: requireUser }, async (request): Promise<PollList> => {
    const { user } = authOf(request);
    return { polls: listPollSummaries(ctx.db, user.id, ctx.now()) };
  });

  app.patch<{ Body: UpdatePollRequest }>(
    "/api/polls/:id",
    {
      onRequest: requireUser,
      // A request without any body is an empty change.
      preValidation: async (request) => {
        request.body ??= {};
      },
      schema: { body: updateBody },
    },
    async (request): Promise<PollView> => {
      const { poll, user } = manageablePollOrFail(request);
      const { body } = request;
      const now = ctx.now();
      updatePoll(
        ctx.db,
        poll.id,
        {
          title: body.title === undefined ? poll.title : checkedTitle(body.title),
          note: body.note === undefined ? poll.note : checkedNote(body.note),
          deadline:
            body.deadline === undefined ? poll.deadline : body.deadline === null ? null : checkedDeadline(body.deadline, now),
          closed: body.closed === undefined ? poll.closed === 1 : body.closed,
        },
        now,
      );
      return viewFor(poll.id, user);
    },
  );

  app.post("/api/polls/:id/share-link", { onRequest: requireUser }, async (request): Promise<NewShareLink> => {
    const { poll } = manageablePollOrFail(request);
    return { shareToken: replaceShareToken(ctx.db, poll.id, ctx.now()) };
  });

  app.delete("/api/polls/:id", { onRequest: requireUser }, async (request, reply) => {
    const { poll } = manageablePollOrFail(request);
    deletePoll(ctx.db, poll.id);
    return reply.status(204).send();
  });

  // The creator or an admin removes any vote, also while the poll is closed.
  app.delete("/api/polls/:id/votes/:voteId", { onRequest: requireUser }, async (request): Promise<PollView> => {
    const { poll, user } = manageablePollOrFail(request);
    const voteId = numberParam(request, "voteId");
    if (voteId === null || !deleteVote(ctx.db, poll.id, voteId)) throw notFound();
    touchPoll(ctx.db, poll.id, ctx.now());
    return viewFor(poll.id, user);
  });

  // --- Share link (everyone with the link; a login is optional) ---

  const guestWriteKey = (request: FastifyRequest): string => `guest-vote-ip:${clientKey(request)}`;

  /**
   * The poll for the share token in the URL. Every miss counts against the caller's address, in the same
   * bucket as wrong invite and reset links. `guestWrite`: the route writes a guest vote and is limited per
   * address too (the write itself is counted by `countGuestWrite` once it has succeeded).
   */
  function pollByLinkOrFail(request: FastifyRequest, guestWrite = false): PollRow {
    const ipLimit = `token-ip:${clientKey(request)}`;
    const checks: (readonly [string, number])[] = [[ipLimit, TOKEN_FAILURES_PER_IP]];
    if (guestWrite) checks.push([guestWriteKey(request), GUEST_VOTE_WRITES_PER_IP]);
    enforceLimits(ctx, checks);
    const poll = findPollByToken(ctx.db, (request.params as { shareToken: string }).shareToken, ctx.now());
    if (!poll) {
      ctx.limiter.recordFailure(ipLimit);
      throw new ApiError(404, "poll_invalid");
    }
    return poll;
  }

  /** The guest vote named in the URL when the `X-Vote-Key` header is its key; otherwise a counted `not_found`. */
  function guestVoteOrFail(request: FastifyRequest, poll: PollRow): VoteRow {
    const voteId = numberParam(request, "voteId");
    const key = voteKeyHeader(request);
    const vote = voteId === null || key === null ? undefined : findGuestVote(ctx.db, poll.id, voteId);
    if (!vote || vote.key_hash !== hashToken(key!)) {
      ctx.limiter.recordFailure(`token-ip:${clientKey(request)}`);
      throw notFound();
    }
    return vote;
  }

  const assertOpen = (poll: PollRow): void => {
    if (!isOpen(poll, ctx.now())) throw new ApiError(409, "poll_closed");
  };

  /** Counts one successful guest write against the address. */
  const countGuestWrite = (request: FastifyRequest): void => ctx.limiter.recordFailure(guestWriteKey(request));

  app.get("/api/poll-links/:shareToken", async (request): Promise<PollView> => {
    const poll = pollByLinkOrFail(request);
    return buildPollView(ctx.db, poll, optionalUser(ctx, request), ctx.now());
  });

  app.put<{ Body: AccountVoteRequest }>(
    "/api/poll-links/:shareToken/my-vote",
    { onRequest: requireUser, schema: { body: accountVoteBody } },
    async (request): Promise<PollView> => {
      const { user } = authOf(request);
      const poll = pollByLinkOrFail(request);
      assertOpen(poll);
      const answers = checkedAnswers(request.body.answers, proposalIdsOf(ctx.db, poll.id));
      inTransaction(ctx.db, () => saveAccountVote(ctx.db, poll.id, user.id, answers, ctx.now()));
      return buildPollView(ctx.db, poll, user, ctx.now());
    },
  );

  // Withdrawing when there is no vote (e.g. already withdrawn on another device) changes nothing.
  app.delete("/api/poll-links/:shareToken/my-vote", { onRequest: requireUser }, async (request): Promise<PollView> => {
    const { user } = authOf(request);
    const poll = pollByLinkOrFail(request);
    assertOpen(poll);
    const vote = findAccountVote(ctx.db, poll.id, user.id);
    if (vote) deleteVote(ctx.db, poll.id, vote.id);
    return buildPollView(ctx.db, poll, user, ctx.now());
  });

  /** Throws `vote_name_taken` when an account or another guest of this poll already has the name. */
  function assertNameFree(poll: PollRow, key: string, exceptVoteId: number): void {
    if (findUserByKey(ctx.db, key) || guestNameInUse(ctx.db, poll.id, key, exceptVoteId)) {
      throw new ApiError(409, "vote_name_taken");
    }
  }

  app.post<{ Body: GuestVoteRequest }>(
    "/api/poll-links/:shareToken/votes",
    { schema: { body: guestVoteBody } },
    async (request, reply): Promise<GuestVoteCreated> => {
      const poll = pollByLinkOrFail(request, true);
      assertOpen(poll);
      const answers = checkedAnswers(request.body.answers, proposalIdsOf(ctx.db, poll.id));
      const { name, key } = checkedGuestName(request.body.name);
      const voteKey = generateToken();

      // Checks and insert in one go: nobody can slip in between.
      const voteId = inTransaction(ctx.db, () => {
        assertNameFree(poll, key, 0);
        if (countGuestVotes(ctx.db, poll.id) >= POLL_MAX_GUEST_VOTES) throw new ApiError(409, "poll_full");
        try {
          return insertGuestVote(ctx.db, {
            pollId: poll.id,
            name,
            nameKey: key,
            keyHash: hashToken(voteKey),
            answers,
            now: ctx.now(),
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new ApiError(409, "vote_name_taken");
          throw error;
        }
      });
      countGuestWrite(request);
      const created: GuestVoteCreated = {
        voteId,
        voteKey,
        poll: buildPollView(ctx.db, poll, optionalUser(ctx, request), ctx.now()),
      };
      return reply.status(201).send(created);
    },
  );

  app.put<{ Body: GuestVoteRequest }>(
    "/api/poll-links/:shareToken/votes/:voteId",
    { schema: { body: guestVoteBody } },
    async (request): Promise<PollView> => {
      const poll = pollByLinkOrFail(request, true);
      const vote = guestVoteOrFail(request, poll);
      assertOpen(poll);
      const answers = checkedAnswers(request.body.answers, proposalIdsOf(ctx.db, poll.id));
      const { name, key } = checkedGuestName(request.body.name);
      inTransaction(ctx.db, () => {
        assertNameFree(poll, key, vote.id);
        try {
          updateGuestVote(ctx.db, vote.id, { name, nameKey: key, answers, now: ctx.now() });
        } catch (error) {
          if (isUniqueViolation(error)) throw new ApiError(409, "vote_name_taken");
          throw error;
        }
      });
      countGuestWrite(request);
      return buildPollView(ctx.db, poll, optionalUser(ctx, request), ctx.now());
    },
  );

  app.delete("/api/poll-links/:shareToken/votes/:voteId", async (request): Promise<PollView> => {
    const poll = pollByLinkOrFail(request, true);
    const vote = guestVoteOrFail(request, poll);
    assertOpen(poll);
    deleteVote(ctx.db, poll.id, vote.id);
    countGuestWrite(request);
    return buildPollView(ctx.db, poll, optionalUser(ctx, request), ctx.now());
  });
}
