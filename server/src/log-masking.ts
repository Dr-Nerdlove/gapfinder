// Invite and password reset links carry their secret token in the URL path. Fastify logs every request URL,
// so the token must be hidden before it reaches the log (admin routes like /api/admin/invites/5 are fine).
const TOKEN_IN_PATH = /(?<!\/admin)\/(invites|password-resets)\/[^/?#]+/g;

/** Replaces the token segment after `/invites/` and `/password-resets/` with `***`. */
export function maskTokens(url: string): string {
  return url.replace(TOKEN_IN_PATH, "/$1/***");
}
