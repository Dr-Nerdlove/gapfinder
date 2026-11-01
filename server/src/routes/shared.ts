import {
  normalizeName,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  usernameKey,
  usernameProblem,
  type SessionResponse,
} from "@lueckenfueller/shared";
import type { FastifyRequest } from "fastify";
import { createSession } from "../accounts/sessions.js";
import { toMe, type UserRow } from "../accounts/users.js";
import type { AppContext } from "../context.js";
import { notFound, rateLimited, validation } from "../errors.js";

/** Throws `rate_limited` (429) when any of the (key, limit) pairs has too many failures. */
export function enforceLimits(ctx: AppContext, checks: readonly (readonly [string, number])[]): void {
  const wait = ctx.limiter.blockedForAny(checks);
  if (wait !== null) throw rateLimited(wait);
}

/** The address of the caller (correct behind Funnel because `TRUST_PROXY=true`). */
export function clientKey(request: FastifyRequest): string {
  return request.ip;
}

/** A normalized, valid username and its comparison key; throws `validation` for `field` otherwise. */
export function checkedUsername(raw: string, field = "username"): { username: string; key: string } {
  const username = normalizeName(raw);
  if (usernameProblem(username) !== null) throw validation(field);
  return { username, key: usernameKey(username) };
}

export function checkedPassword(raw: string, field: string): string {
  const length = [...raw].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) throw validation(field);
  return raw;
}

/** A numeric id from the URL; anything else cannot exist, so it is "not found". */
export function idParam(request: FastifyRequest): number {
  const raw = (request.params as { id?: string }).id ?? "";
  if (!/^\d{1,15}$/.test(raw)) throw notFound();
  return Number(raw);
}

export function tokenParam(request: FastifyRequest): string {
  return (request.params as { token: string }).token;
}

export function sessionResponse(ctx: AppContext, user: UserRow): SessionResponse {
  return { token: createSession(ctx.db, user.id, ctx.now()), user: toMe(user) };
}
