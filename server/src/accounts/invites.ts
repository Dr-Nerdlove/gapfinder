import { INVITE_VALID_DAYS, type AdminInvite, type CreatedInvite } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import { generateToken, hashToken } from "../auth/tokens.js";
import { addDays } from "../time.js";

export interface InviteRow {
  id: number;
  token_hash: string;
  suggested_username: string;
  is_admin: number;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: number | null;
}

export function toAdminInvite(invite: InviteRow): AdminInvite {
  return {
    id: invite.id,
    suggestedUsername: invite.suggested_username,
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
  };
}

/** Creates an invite valid for `INVITE_VALID_DAYS`. Only the command line creates admin invites. */
export function createInvite(
  db: DatabaseSync,
  invite: { suggestedUsername: string; isAdmin: boolean; createdBy: number | null },
  now: Date,
): CreatedInvite {
  const token = generateToken();
  const createdAt = now.toISOString();
  const expiresAt = addDays(now, INVITE_VALID_DAYS).toISOString();
  const result = db
    .prepare(
      `INSERT INTO invites (token_hash, suggested_username, is_admin, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), invite.suggestedUsername, invite.isAdmin ? 1 : 0, invite.createdBy, createdAt, expiresAt);
  return {
    token,
    id: Number(result.lastInsertRowid),
    suggestedUsername: invite.suggestedUsername,
    createdAt,
    expiresAt,
  };
}

/** The invite behind a token, if it is neither used nor expired. */
export function findOpenInvite(db: DatabaseSync, token: string, now: Date): InviteRow | undefined {
  return db
    .prepare("SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .get(hashToken(token), now.toISOString()) as InviteRow | undefined;
}

/** Marks the invite used. False when someone else used it first (single use), or it expired meanwhile. */
export function claimInvite(db: DatabaseSync, id: number, now: Date): boolean {
  const result = db
    .prepare("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?")
    .run(now.toISOString(), id, now.toISOString());
  return Number(result.changes) === 1;
}

export function setInviteUsedBy(db: DatabaseSync, id: number, userId: number): void {
  db.prepare("UPDATE invites SET used_by = ? WHERE id = ?").run(userId, id);
}

export function listOpenInvites(db: DatabaseSync, now: Date): InviteRow[] {
  return db
    .prepare("SELECT * FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY id DESC")
    .all(now.toISOString()) as unknown as InviteRow[];
}

/** Withdraws an unused invite. False when there is none with this id. */
export function deleteUnusedInvite(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare("DELETE FROM invites WHERE id = ? AND used_at IS NULL").run(id).changes) > 0;
}
