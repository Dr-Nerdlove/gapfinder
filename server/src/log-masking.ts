// Invite, password reset, poll share and calendar feed links carry their secret token in the URL path. Fastify logs
// every request URL, so the token must be hidden before it reaches the log (admin routes like /api/admin/invites/5
// are fine). A new route with a secret in its path must be added here.
const TOKEN_IN_PATH = /(?<!\/admin)\/(invites|password-resets|poll-links|calendar-feeds)\/[^/?#]+/g;

/** Replaces the token segment after `/invites/`, `/password-resets/`, `/poll-links/` and `/calendar-feeds/` with `***`. */
export function maskTokens(url: string): string {
  return url.replace(TOKEN_IN_PATH, "/$1/***");
}
