import {
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX_LENGTH,
  GROUPS_PER_USER,
  normalizeName,
  usernameKey,
  type CreateGroupRequest,
  type Group,
  type GroupList,
  type UpdateGroupRequest,
} from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { findUserById } from "../accounts/users.js";
import { authOf, createGuards } from "../auth/guards.js";
import type { AppContext } from "../context.js";
import { inTransaction, isUniqueViolation } from "../db.js";
import { ApiError, notFound, validation } from "../errors.js";
import { idParam } from "./shared.js";

const memberIds = { type: "array", maxItems: 1000, items: { type: "integer" } } as const;
const createBody = {
  type: "object",
  required: ["name", "members"],
  properties: { name: { type: "string", maxLength: 1000 }, members: memberIds },
} as const;
const updateBody = {
  type: "object",
  properties: { name: { type: "string", maxLength: 1000 }, members: memberIds },
} as const;

interface GroupRow {
  id: number;
  name: string;
}

function membersOf(db: DatabaseSync, groupId: number): number[] {
  const rows = db
    .prepare("SELECT member_id FROM people_group_members WHERE group_id = ? ORDER BY member_id")
    .all(groupId) as { member_id: number }[];
  return rows.map((row) => row.member_id);
}

function findGroup(db: DatabaseSync, userId: number, id: number): Group | undefined {
  const row = db.prepare("SELECT id, name FROM people_groups WHERE id = ? AND user_id = ?").get(id, userId) as
    | GroupRow
    | undefined;
  return row && { id: row.id, name: row.name, members: membersOf(db, row.id) };
}

function listGroups(db: DatabaseSync, userId: number): Group[] {
  const rows = db
    .prepare("SELECT id, name FROM people_groups WHERE user_id = ? ORDER BY name_key, id")
    .all(userId) as unknown as GroupRow[];
  return rows.map((row) => ({ id: row.id, name: row.name, members: membersOf(db, row.id) }));
}

function checkedName(raw: string): string {
  const name = normalizeName(raw);
  const length = [...name].length;
  if (length < 1 || length > GROUP_NAME_MAX_LENGTH) throw validation("name");
  return name;
}

/** Each person once, never the caller; every one must have an account. */
function checkedMembers(ctx: AppContext, callerId: number, raw: number[]): number[] {
  const ids = [...new Set(raw)].filter((id) => id !== callerId);
  if (ids.length > GROUP_MAX_MEMBERS) throw validation("members");
  if (ids.some((id) => findUserById(ctx.db, id) === undefined)) throw validation("members");
  return ids;
}

function setMembers(db: DatabaseSync, groupId: number, ids: number[]): void {
  db.prepare("DELETE FROM people_group_members WHERE group_id = ?").run(groupId);
  const insert = db.prepare("INSERT INTO people_group_members (group_id, member_id) VALUES (?, ?)");
  for (const id of ids) insert.run(groupId, id);
}

/** Runs `work`; a second group with the same name is the caller's mistake, not a server error. */
function withNameCheck<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (isUniqueViolation(error)) throw validation("name");
    throw error;
  }
}

/** All routes below `/api/groups`: a person's own groups of people, never anybody else's. */
export function registerGroupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.get("/api/groups", { onRequest: requireUser }, async (request): Promise<GroupList> => {
    return { groups: listGroups(ctx.db, authOf(request).user.id) };
  });

  app.post<{ Body: CreateGroupRequest }>(
    "/api/groups",
    { onRequest: requireUser, schema: { body: createBody } },
    async (request, reply): Promise<Group> => {
      const { user } = authOf(request);
      const name = checkedName(request.body.name);
      const members = checkedMembers(ctx, user.id, request.body.members);
      const id = withNameCheck(() =>
        inTransaction(ctx.db, () => {
          // Two requests at once must not get past the limit together.
          const count = ctx.db.prepare("SELECT COUNT(*) AS n FROM people_groups WHERE user_id = ?").get(user.id) as {
            n: number;
          };
          if (count.n >= GROUPS_PER_USER) throw new ApiError(409, "group_limit");
          const result = ctx.db
            .prepare("INSERT INTO people_groups (user_id, name, name_key, created_at) VALUES (?, ?, ?, ?)")
            .run(user.id, name, usernameKey(name), ctx.now().toISOString());
          const groupId = Number(result.lastInsertRowid);
          setMembers(ctx.db, groupId, members);
          return groupId;
        }),
      );
      return reply.status(201).send(findGroup(ctx.db, user.id, id)!);
    },
  );

  app.patch<{ Body: UpdateGroupRequest }>(
    "/api/groups/:id",
    { onRequest: requireUser, schema: { body: updateBody } },
    async (request): Promise<Group> => {
      const { user } = authOf(request);
      const id = idParam(request);
      if (!findGroup(ctx.db, user.id, id)) throw notFound();
      const name = request.body.name === undefined ? undefined : checkedName(request.body.name);
      const members =
        request.body.members === undefined ? undefined : checkedMembers(ctx, user.id, request.body.members);
      withNameCheck(() =>
        inTransaction(ctx.db, () => {
          if (!findGroup(ctx.db, user.id, id)) throw notFound();
          if (name !== undefined) {
            ctx.db
              .prepare("UPDATE people_groups SET name = ?, name_key = ? WHERE id = ?")
              .run(name, usernameKey(name), id);
          }
          if (members !== undefined) setMembers(ctx.db, id, members);
        }),
      );
      return findGroup(ctx.db, user.id, id)!;
    },
  );

  app.delete("/api/groups/:id", { onRequest: requireUser }, async (request, reply) => {
    const { user } = authOf(request);
    const id = idParam(request);
    const result = ctx.db.prepare("DELETE FROM people_groups WHERE id = ? AND user_id = ?").run(id, user.id);
    if (Number(result.changes) === 0) throw notFound();
    return reply.status(204).send();
  });
}
