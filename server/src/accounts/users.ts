import type { AdminUser, Me, Person } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";

export interface UserRow {
  id: number;
  username: string;
  username_key: string;
  password_hash: string;
  is_admin: number;
  seed_color: string | null;
  created_at: string;
}

export function toMe(user: UserRow): Me {
  return { id: user.id, username: user.username, isAdmin: user.is_admin === 1, seedColor: user.seed_color };
}

/** What everybody with an account may see of everybody else: the name and the colour, nothing more. */
export function toPerson(user: UserRow): Person {
  return { id: user.id, username: user.username, seedColor: user.seed_color };
}

/** `calendarProblems`: how many of the person's calendars are broken (a count only, never more about them). */
export function toAdminUser(user: UserRow, calendarProblems: number): AdminUser {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.is_admin === 1,
    createdAt: user.created_at,
    calendarProblems,
  };
}

export function findUserById(db: DatabaseSync, id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function findUserByKey(db: DatabaseSync, key: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username_key = ?").get(key) as UserRow | undefined;
}

export function listUsers(db: DatabaseSync): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY username_key, id").all() as unknown as UserRow[];
}

/** Inserts a user; throws on a duplicate `username_key` (see `isUniqueViolation`). */
export function insertUser(
  db: DatabaseSync,
  user: { username: string; usernameKey: string; passwordHash: string; isAdmin: boolean; createdAt: string },
): number {
  const result = db
    .prepare("INSERT INTO users (username, username_key, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(user.username, user.usernameKey, user.passwordHash, user.isAdmin ? 1 : 0, user.createdAt);
  return Number(result.lastInsertRowid);
}

/** Throws on a duplicate `username_key` (see `isUniqueViolation`). */
export function updateUsername(db: DatabaseSync, id: number, username: string, usernameKey: string): void {
  db.prepare("UPDATE users SET username = ?, username_key = ? WHERE id = ?").run(username, usernameKey, id);
}

export function updateSeedColor(db: DatabaseSync, id: number, seedColor: string | null): void {
  db.prepare("UPDATE users SET seed_color = ? WHERE id = ?").run(seedColor, id);
}

export function updatePasswordHash(db: DatabaseSync, id: number, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

/** Deletes the user; sessions and password resets go with it, invites keep their record. */
export function deleteUser(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare("DELETE FROM users WHERE id = ?").run(id).changes) > 0;
}
