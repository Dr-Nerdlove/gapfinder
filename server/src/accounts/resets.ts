import { RESET_VALID_HOURS, type CreatedPasswordReset } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import { generateToken, hashToken } from "../auth/tokens.js";
import { addHours } from "../time.js";

export interface ResetRow {
  id: number;
  token_hash: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

/** Creates a reset link for the user and replaces their earlier unused one. */
export function createPasswordReset(db: DatabaseSync, userId: number, now: Date): CreatedPasswordReset {
  const token = generateToken();
  const expiresAt = addHours(now, RESET_VALID_HOURS).toISOString();
  db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(userId);
  db.prepare("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now.toISOString(),
    expiresAt,
  );
  return { token, expiresAt };
}

/** The reset behind a token, if it is neither used nor expired. */
export function findOpenReset(db: DatabaseSync, token: string, now: Date): ResetRow | undefined {
  return db
    .prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .get(hashToken(token), now.toISOString()) as ResetRow | undefined;
}

/** Marks the reset used. False when someone else used it first (single use), or it expired meanwhile. */
export function claimReset(db: DatabaseSync, id: number, now: Date): boolean {
  const result = db
    .prepare("UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?")
    .run(now.toISOString(), id, now.toISOString());
  return Number(result.changes) === 1;
}
