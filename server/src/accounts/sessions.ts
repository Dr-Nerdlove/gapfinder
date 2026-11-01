import { SESSION_VALID_DAYS } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import { generateToken, hashToken } from "../auth/tokens.js";
import { addDays, ONE_HOUR_MS } from "../time.js";
import type { UserRow } from "./users.js";

/** Creates a session for the user and returns its token (the only time it exists in clear). */
export function createSession(db: DatabaseSync, userId: number, now: Date): string {
  const token = generateToken();
  const iso = now.toISOString();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(hashToken(token), userId, iso, iso, addDays(now, SESSION_VALID_DAYS).toISOString());
  return token;
}

export interface SessionUser {
  user: UserRow;
  tokenHash: string;
}

/**
 * Finds the user of a valid session. A session that is used again after more than an hour is prolonged
 * (it expires `SESSION_VALID_DAYS` after its last use).
 */
export function findSessionUser(db: DatabaseSync, token: string, now: Date): SessionUser | null {
  const tokenHash = hashToken(token);
  const session = db
    .prepare("SELECT user_id, last_used_at, expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as { user_id: number; last_used_at: string; expires_at: string } | undefined;
  if (!session) return null;
  if (session.expires_at <= now.toISOString()) {
    deleteSession(db, tokenHash);
    return null;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as UserRow | undefined;
  if (!user) return null;
  if (now.getTime() - Date.parse(session.last_used_at) > ONE_HOUR_MS) {
    db.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?").run(
      now.toISOString(),
      addDays(now, SESSION_VALID_DAYS).toISOString(),
      tokenHash,
    );
  }
  return { user, tokenHash };
}

export function deleteSession(db: DatabaseSync, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

/** Ends all sessions of a user, except the one with `keepTokenHash` when given. */
export function deleteSessionsOfUser(db: DatabaseSync, userId: number, keepTokenHash?: string): void {
  if (keepTokenHash === undefined) {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, keepTokenHash);
  }
}
