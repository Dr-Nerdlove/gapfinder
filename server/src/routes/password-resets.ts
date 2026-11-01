import type { CompletePasswordResetRequest, PasswordResetInfo, SessionResponse } from "@lueckenfueller/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { claimReset, findOpenReset } from "../accounts/resets.js";
import { deleteSessionsOfUser } from "../accounts/sessions.js";
import { findUserById, updatePasswordHash } from "../accounts/users.js";
import { hashPassword } from "../auth/passwords.js";
import { TOKEN_FAILURES_PER_IP } from "../auth/rate-limit.js";
import { inTransaction } from "../db.js";
import type { AppContext } from "../context.js";
import { ApiError } from "../errors.js";
import { checkedPassword, clientKey, enforceLimits, sessionResponse, tokenParam } from "./shared.js";

const completeBody = {
  type: "object",
  required: ["password"],
  properties: { password: { type: "string", maxLength: 1000 } },
} as const;

export function registerPasswordResetRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The open reset and its user for the token in the URL; every miss counts against the caller's address. */
  function openResetOrFail(request: FastifyRequest) {
    const ipLimit = `token-ip:${clientKey(request)}`;
    enforceLimits(ctx, [[ipLimit, TOKEN_FAILURES_PER_IP]]);
    const reset = findOpenReset(ctx.db, tokenParam(request), ctx.now());
    const user = reset ? findUserById(ctx.db, reset.user_id) : undefined;
    if (!reset || !user) {
      ctx.limiter.recordFailure(ipLimit);
      throw new ApiError(404, "reset_invalid");
    }
    return { reset, user };
  }

  app.get("/api/password-resets/:token", async (request): Promise<PasswordResetInfo> => {
    const { reset, user } = openResetOrFail(request);
    return { username: user.username, expiresAt: reset.expires_at };
  });

  app.post<{ Body: CompletePasswordResetRequest }>(
    "/api/password-resets/:token",
    { schema: { body: completeBody } },
    async (request): Promise<SessionResponse> => {
      const { reset, user } = openResetOrFail(request);
      const password = checkedPassword(request.body.password, "password");
      const passwordHash = await hashPassword(password);

      const claimed = inTransaction(ctx.db, () => {
        if (!claimReset(ctx.db, reset.id, ctx.now())) return false;
        updatePasswordHash(ctx.db, user.id, passwordHash);
        deleteSessionsOfUser(ctx.db, user.id);
        return true;
      });
      if (!claimed) {
        ctx.limiter.recordFailure(`token-ip:${clientKey(request)}`);
        throw new ApiError(404, "reset_invalid");
      }
      ctx.limiter.reset(`login-user:${user.username_key}`);
      return sessionResponse(ctx, findUserById(ctx.db, user.id)!);
    },
  );
}
