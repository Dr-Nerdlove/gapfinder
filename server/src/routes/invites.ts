import type { AcceptInviteRequest, InviteInfo, SessionResponse } from "@lueckenfueller/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { claimInvite, findOpenInvite, setInviteUsedBy, type InviteRow } from "../accounts/invites.js";
import { createSession } from "../accounts/sessions.js";
import { findUserById, findUserByKey, insertUser, toMe } from "../accounts/users.js";
import { hashPassword } from "../auth/passwords.js";
import { TOKEN_FAILURES_PER_IP } from "../auth/rate-limit.js";
import { inTransaction, isUniqueViolation } from "../db.js";
import type { AppContext } from "../context.js";
import { ApiError } from "../errors.js";
import { checkedPassword, checkedUsername, clientKey, enforceLimits, tokenParam } from "./shared.js";

const acceptBody = {
  type: "object",
  required: ["username", "password"],
  properties: {
    username: { type: "string", maxLength: 1000 },
    password: { type: "string", maxLength: 1000 },
  },
} as const;

export function registerInviteRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The open invite for the token in the URL; every miss counts against the caller's address. */
  function openInviteOrFail(request: FastifyRequest): InviteRow {
    const ipLimit = `token-ip:${clientKey(request)}`;
    enforceLimits(ctx, [[ipLimit, TOKEN_FAILURES_PER_IP]]);
    const invite = findOpenInvite(ctx.db, tokenParam(request), ctx.now());
    if (!invite) {
      ctx.limiter.recordFailure(ipLimit);
      throw new ApiError(404, "invite_invalid");
    }
    return invite;
  }

  app.get("/api/invites/:token", async (request): Promise<InviteInfo> => {
    const invite = openInviteOrFail(request);
    return { suggestedUsername: invite.suggested_username, expiresAt: invite.expires_at };
  });

  app.post<{ Body: AcceptInviteRequest }>(
    "/api/invites/:token/accept",
    { schema: { body: acceptBody } },
    async (request, reply): Promise<SessionResponse> => {
      const invite = openInviteOrFail(request);
      const name = checkedUsername(request.body.username);
      const password = checkedPassword(request.body.password, "password");
      if (findUserByKey(ctx.db, name.key)) throw new ApiError(409, "username_taken");

      const passwordHash = await hashPassword(password);
      // Hashing is done: the rest is synchronous, so nobody can slip in between claiming and creating.
      const outcome = inTransaction(ctx.db, () => {
        const now = ctx.now();
        if (!claimInvite(ctx.db, invite.id, now)) return "invite_invalid" as const;
        try {
          const userId = insertUser(ctx.db, {
            username: name.username,
            usernameKey: name.key,
            passwordHash,
            isAdmin: invite.is_admin === 1,
            createdAt: now.toISOString(),
          });
          setInviteUsedBy(ctx.db, invite.id, userId);
          return { token: createSession(ctx.db, userId, now), userId };
        } catch (error) {
          // The name was taken in the meantime: undo the claim as well.
          if (isUniqueViolation(error)) throw new ApiError(409, "username_taken");
          throw error;
        }
      });
      if (outcome === "invite_invalid") {
        ctx.limiter.recordFailure(`token-ip:${clientKey(request)}`);
        throw new ApiError(404, "invite_invalid");
      }
      return reply.status(201).send({ token: outcome.token, user: toMe(findUserById(ctx.db, outcome.userId)!) });
    },
  );
}
