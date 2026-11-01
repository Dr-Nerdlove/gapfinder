import { usernameKey, type LoginRequest, type SessionResponse } from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { purgeExpired } from "../accounts/cleanup.js";
import { deleteSession } from "../accounts/sessions.js";
import { findUserByKey } from "../accounts/users.js";
import { authOf, createGuards } from "../auth/guards.js";
import { verifyPassword } from "../auth/passwords.js";
import { LOGIN_FAILURES_PER_IP, LOGIN_FAILURES_PER_USERNAME } from "../auth/rate-limit.js";
import type { AppContext } from "../context.js";
import { ApiError } from "../errors.js";
import { clientKey, enforceLimits, sessionResponse } from "./shared.js";

const loginBody = {
  type: "object",
  required: ["username", "password"],
  properties: {
    username: { type: "string", maxLength: 1000 },
    password: { type: "string", maxLength: 1000 },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.post<{ Body: LoginRequest }>(
    "/api/auth/login",
    { schema: { body: loginBody } },
    async (request): Promise<SessionResponse> => {
      const key = usernameKey(request.body.username);
      const userLimit = `login-user:${key}`;
      const ipLimit = `login-ip:${clientKey(request)}`;
      // Before any hashing: a blocked caller must not be able to make the server do expensive work.
      enforceLimits(ctx, [
        [userLimit, LOGIN_FAILURES_PER_USERNAME],
        [ipLimit, LOGIN_FAILURES_PER_IP],
      ]);

      const user = findUserByKey(ctx.db, key);
      const ok = await verifyPassword(user?.password_hash ?? null, request.body.password);
      if (!user || !ok) {
        ctx.limiter.recordFailure(userLimit);
        ctx.limiter.recordFailure(ipLimit);
        throw new ApiError(401, "invalid_credentials");
      }

      ctx.limiter.reset(userLimit);
      purgeExpired(ctx.db, ctx.now());
      return sessionResponse(ctx, user);
    },
  );

  app.post("/api/auth/logout", { onRequest: requireUser }, async (request, reply) => {
    deleteSession(ctx.db, authOf(request).tokenHash);
    return reply.status(204).send();
  });
}
