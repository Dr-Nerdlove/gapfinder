import { normalizeSeedColor, type ChangePasswordRequest, type Me, type UpdateMeRequest } from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { deleteSessionsOfUser } from "../accounts/sessions.js";
import {
  findUserByKey,
  findUserById,
  toMe,
  updatePasswordHash,
  updateSeedColor,
  updateUsername,
} from "../accounts/users.js";
import { authOf, createGuards } from "../auth/guards.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { PASSWORD_FAILURES_PER_USER } from "../auth/rate-limit.js";
import { isUniqueViolation } from "../db.js";
import type { AppContext } from "../context.js";
import { ApiError, validation } from "../errors.js";
import { checkedPassword, checkedUsername, enforceLimits } from "./shared.js";

const updateMeBody = {
  type: "object",
  properties: {
    username: { type: "string", maxLength: 1000 },
    seedColor: { type: ["string", "null"], maxLength: 1000 },
  },
} as const;

const changePasswordBody = {
  type: "object",
  required: ["currentPassword", "newPassword"],
  properties: {
    currentPassword: { type: "string", maxLength: 1000 },
    newPassword: { type: "string", maxLength: 1000 },
  },
} as const;

export function registerMeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.get("/api/me", { onRequest: requireUser }, async (request): Promise<Me> => toMe(authOf(request).user));

  app.patch<{ Body: UpdateMeRequest }>(
    "/api/me",
    { onRequest: requireUser, schema: { body: updateMeBody } },
    async (request): Promise<Me> => {
      const { user } = authOf(request);
      const { username, seedColor } = request.body;

      let newName: { username: string; key: string } | undefined;
      if (username !== undefined) {
        newName = checkedUsername(username);
        const owner = findUserByKey(ctx.db, newName.key);
        if (owner && owner.id !== user.id) throw new ApiError(409, "username_taken");
      }
      let newColor: string | null | undefined;
      if (seedColor !== undefined) {
        newColor = seedColor === null ? null : normalizeSeedColor(seedColor);
        if (seedColor !== null && newColor === null) throw validation("seedColor");
      }

      try {
        if (newName) updateUsername(ctx.db, user.id, newName.username, newName.key);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, "username_taken");
        throw error;
      }
      if (newColor !== undefined) updateSeedColor(ctx.db, user.id, newColor);
      return toMe(findUserById(ctx.db, user.id)!);
    },
  );

  app.post<{ Body: ChangePasswordRequest }>(
    "/api/me/password",
    { onRequest: requireUser, schema: { body: changePasswordBody } },
    async (request, reply) => {
      const { user, tokenHash } = authOf(request);
      const limitKey = `password:${user.id}`;
      enforceLimits(ctx, [[limitKey, PASSWORD_FAILURES_PER_USER]]);

      const newPassword = checkedPassword(request.body.newPassword, "newPassword");
      if (!(await verifyPassword(user.password_hash, request.body.currentPassword))) {
        ctx.limiter.recordFailure(limitKey);
        throw new ApiError(400, "wrong_password");
      }
      ctx.limiter.reset(limitKey);

      updatePasswordHash(ctx.db, user.id, await hashPassword(newPassword));
      deleteSessionsOfUser(ctx.db, user.id, tokenHash);
      return reply.status(204).send();
    },
  );
}
