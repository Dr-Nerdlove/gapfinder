import {
  INVITE_NAME_MAX_LENGTH,
  normalizeName,
  suggestUsername,
  usernameProblem,
  type AdminInvite,
  type AdminRenameUserRequest,
  type AdminUser,
  type CreateInviteRequest,
  type CreatedInvite,
  type CreatedPasswordReset,
} from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { createInvite, deleteUnusedInvite, listOpenInvites, toAdminInvite } from "../accounts/invites.js";
import { createPasswordReset } from "../accounts/resets.js";
import { deleteUser, findUserById, findUserByKey, listUsers, toAdminUser, updateUsername } from "../accounts/users.js";
import { authOf, createGuards } from "../auth/guards.js";
import { isUniqueViolation } from "../db.js";
import type { AppContext } from "../context.js";
import { ApiError, notFound, validation } from "../errors.js";
import { checkedUsername, idParam } from "./shared.js";

const renameBody = {
  type: "object",
  required: ["username"],
  properties: { username: { type: "string", maxLength: 1000 } },
} as const;

const createInviteBody = {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string", maxLength: 1000 } },
} as const;

/** All routes below `/api/admin`: only for logged-in admins. */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser, requireAdmin } = createGuards(ctx);

  void app.register(async (admin) => {
    admin.addHook("onRequest", requireUser);
    admin.addHook("onRequest", requireAdmin);

    admin.get("/api/admin/users", async (): Promise<AdminUser[]> => listUsers(ctx.db).map(toAdminUser));

    admin.patch<{ Body: AdminRenameUserRequest }>(
      "/api/admin/users/:id",
      { schema: { body: renameBody } },
      async (request): Promise<AdminUser> => {
        const id = idParam(request);
        if (!findUserById(ctx.db, id)) throw notFound();
        const name = checkedUsername(request.body.username);
        const owner = findUserByKey(ctx.db, name.key);
        if (owner && owner.id !== id) throw new ApiError(409, "username_taken");
        try {
          updateUsername(ctx.db, id, name.username, name.key);
        } catch (error) {
          if (isUniqueViolation(error)) throw new ApiError(409, "username_taken");
          throw error;
        }
        return toAdminUser(findUserById(ctx.db, id)!);
      },
    );

    admin.delete("/api/admin/users/:id", async (request, reply) => {
      const id = idParam(request);
      if (id === authOf(request).user.id) throw new ApiError(400, "cannot_delete_self");
      if (!deleteUser(ctx.db, id)) throw notFound();
      return reply.status(204).send();
    });

    admin.post("/api/admin/users/:id/password-reset", async (request, reply): Promise<CreatedPasswordReset> => {
      const id = idParam(request);
      if (!findUserById(ctx.db, id)) throw notFound();
      return reply.status(201).send(createPasswordReset(ctx.db, id, ctx.now()));
    });

    admin.get(
      "/api/admin/invites",
      async (): Promise<AdminInvite[]> => listOpenInvites(ctx.db, ctx.now()).map(toAdminInvite),
    );

    admin.post<{ Body: CreateInviteRequest }>(
      "/api/admin/invites",
      { schema: { body: createInviteBody } },
      async (request, reply): Promise<CreatedInvite> => {
        const name = normalizeName(request.body.name);
        if ([...name].length > INVITE_NAME_MAX_LENGTH) throw validation("name");
        const suggestedUsername = suggestUsername(name);
        if (suggestedUsername === "" || usernameProblem(suggestedUsername) !== null) throw validation("name");
        // Invites made in the admin area are never admin invites: admins are created on the command line.
        const invite = createInvite(
          ctx.db,
          { suggestedUsername, isAdmin: false, createdBy: authOf(request).user.id },
          ctx.now(),
        );
        return reply.status(201).send(invite);
      },
    );

    admin.delete("/api/admin/invites/:id", async (request, reply) => {
      if (!deleteUnusedInvite(ctx.db, idParam(request))) throw notFound();
      return reply.status(204).send();
    });
  });
}
