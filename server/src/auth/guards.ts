import type { FastifyRequest } from "fastify";
import { findSessionUser } from "../accounts/sessions.js";
import type { UserRow } from "../accounts/users.js";
import type { AppContext } from "../context.js";
import { forbidden, unauthorized } from "../errors.js";

export interface AuthInfo {
  user: UserRow;
  /** Hash of the token this request used (identifies the current session). */
  tokenHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireUser` on routes that need a login. */
    auth: AuthInfo | null;
  }
}

/** The logged-in user of a request that went through `requireUser`. */
export function authOf(request: FastifyRequest): AuthInfo {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

function bearerToken(request: FastifyRequest): string | null {
  const match = /^Bearer +(\S+)$/i.exec(request.headers.authorization ?? "");
  return match?.[1] ?? null;
}

/**
 * The logged-in user of a request that may or may not carry a login (routes open to everyone with a link). A
 * missing, wrong or expired token means "not logged in", never an error.
 */
export function optionalUser(ctx: AppContext, request: FastifyRequest): UserRow | null {
  const token = bearerToken(request);
  return token === null ? null : (findSessionUser(ctx.db, token, ctx.now())?.user ?? null);
}

/** Hooks (`onRequest`) that reject requests without a valid session, or from non-admins. */
export function createGuards(ctx: AppContext): {
  requireUser: (request: FastifyRequest) => Promise<void>;
  requireAdmin: (request: FastifyRequest) => Promise<void>;
} {
  return {
    async requireUser(request) {
      const token = bearerToken(request);
      const found = token === null ? null : findSessionUser(ctx.db, token, ctx.now());
      if (!found) throw unauthorized();
      request.auth = { user: found.user, tokenHash: found.tokenHash };
    },
    async requireAdmin(request) {
      if (authOf(request).user.is_admin !== 1) throw forbidden();
    },
  };
}
