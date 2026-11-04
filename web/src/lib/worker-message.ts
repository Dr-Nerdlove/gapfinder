// Messages from the service worker to the open app window.

const POLL_HASH = /^#\/abstimmung\/[A-Za-z0-9_%-]{1,600}$/;

/** The page to go to for a worker message `{ type: "open", hash }`; null for anything else (only poll pages are allowed). */
export function openHashOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, hash } = data as { type?: unknown; hash?: unknown };
  if (type !== "open" || typeof hash !== "string") return null;
  return POLL_HASH.test(hash) ? hash : null;
}
