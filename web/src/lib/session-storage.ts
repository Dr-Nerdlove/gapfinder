import type { Me } from "@lueckenfueller/shared";

// Everything here must work without storage (private window, blocked site data): every access is wrapped.

export const SESSION_KEY = "lueckenfueller.session";
export const SEED_KEY = "lueckenfueller.seed";

export interface StoredSession {
  token: string;
  user: Me;
}

/** `localStorage`, or null when the browser does not give access to it. */
export function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "number" &&
    typeof v["username"] === "string" &&
    typeof v["isAdmin"] === "boolean" &&
    (v["seedColor"] === null || typeof v["seedColor"] === "string")
  );
}

/** The saved login, or null when there is none or it is unreadable. */
export function loadSession(storage: Storage | null = defaultStorage()): StoredSession | null {
  try {
    const raw = storage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { token, user } = parsed as Record<string, unknown>;
    return typeof token === "string" && token !== "" && isMe(user) ? { token, user } : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Without storage the login simply lasts until the page is closed.
  }
}

export function clearSession(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do.
  }
}

/** The last seed colour, kept so the right colours show before the server has answered. */
export function loadSeed(storage: Storage | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(SEED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Remembers the seed colour; `null` forgets it. */
export function saveSeed(seed: string | null, storage: Storage | null = defaultStorage()): void {
  try {
    if (seed === null) storage?.removeItem(SEED_KEY);
    else storage?.setItem(SEED_KEY, seed);
  } catch {
    // Nothing to do.
  }
}
