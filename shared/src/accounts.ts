// Accounts, sessions, invites and password resets: the contract between server and frontend (phase 1c).
//
// Authentication: every request that needs a login sends `Authorization: Bearer <token>`. Tokens are random
// strings returned by login, invite acceptance and password reset; the server stores only their SHA-256 hash.

/** Shortest allowed password. */
export const PASSWORD_MIN_LENGTH = 8;
/** Longest allowed password (keeps hashing cheap for strangers sending huge strings). */
export const PASSWORD_MAX_LENGTH = 256;
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;
/** Longest name the admin may type when creating an invite. */
export const INVITE_NAME_MAX_LENGTH = 80;

/** A personal invite link is valid this long and only once. */
export const INVITE_VALID_DAYS = 14;
/** A password reset link is valid this long and only once. */
export const RESET_VALID_HOURS = 24;
/** A login stays valid this long after it was last used. */
export const SESSION_VALID_DAYS = 180;

/** The logged-in user, as `GET /api/me` returns it. */
export interface Me {
  id: number;
  username: string;
  isAdmin: boolean;
  /** Seed colour of the user's colour scheme as `#rrggbb` (lower case), or null for the app's default. */
  seedColor: string | null;
}

/** Answer of login, invite acceptance and password reset: a new session. */
export interface SessionResponse {
  token: string;
  user: Me;
}

/** `POST /api/auth/login` */
export interface LoginRequest {
  username: string;
  password: string;
}

/** `GET /api/invites/:token` (no login needed). */
export interface InviteInfo {
  suggestedUsername: string;
  expiresAt: string;
}

/** `POST /api/invites/:token/accept` (no login needed) → `SessionResponse` (201). */
export interface AcceptInviteRequest {
  username: string;
  password: string;
}

/** `GET /api/password-resets/:token` (no login needed). */
export interface PasswordResetInfo {
  username: string;
  expiresAt: string;
}

/** `POST /api/password-resets/:token` (no login needed) → `SessionResponse`. Ends all other sessions. */
export interface CompletePasswordResetRequest {
  password: string;
}

/** `PATCH /api/me` → `Me`. Fields left out stay as they are; `seedColor: null` goes back to the default. */
export interface UpdateMeRequest {
  username?: string;
  seedColor?: string | null;
}

/** `POST /api/me/password` → 204. Ends all other sessions of the user, keeps the current one. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** An account in the admin area (`GET /api/admin/users` → `AdminUser[]`, sorted by username). */
export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

/** `PATCH /api/admin/users/:id` → `AdminUser`. */
export interface AdminRenameUserRequest {
  username: string;
}

/**
 * `POST /api/admin/users/:id/password-reset` → `CreatedPasswordReset` (201). Replaces an open reset link of
 * the same user. The token is shown only once; the frontend builds the link `#/passwort/<token>`.
 */
export interface CreatedPasswordReset {
  token: string;
  expiresAt: string;
}

/** An open (unused, unexpired) invite (`GET /api/admin/invites` → `AdminInvite[]`, newest first). */
export interface AdminInvite {
  id: number;
  suggestedUsername: string;
  createdAt: string;
  expiresAt: string;
}

/** `POST /api/admin/invites` → `CreatedInvite` (201). `name` is the person's name, e.g. "Vincent Richter". */
export interface CreateInviteRequest {
  name: string;
}

/** The token is shown only once; the frontend builds the link `#/einladung/<token>`. */
export interface CreatedInvite extends AdminInvite {
  token: string;
}

// `DELETE /api/admin/invites/:id` → 204 (withdraws an open invite).
// `DELETE /api/admin/users/:id` → 204 (not oneself: `cannot_delete_self`).
// `POST /api/auth/logout` → 204 (ends the current session).

/** NFC, trimmed, runs of whitespace collapsed to one space. */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** The form usernames are compared in: normalized and lower case, so "vincent r." and "Vincent R." clash. */
export function usernameKey(username: string): string {
  return normalizeName(username).toLowerCase();
}

const USERNAME_PATTERN = /^[\p{L}\p{M}\p{N} .'_-]+$/u;

export type UsernameProblem = "too_short" | "too_long" | "invalid_characters";

/** Checks an already normalized username. Letters (any language), digits, space and . ' _ - are allowed. */
export function usernameProblem(normalized: string): UsernameProblem | null {
  const length = [...normalized].length;
  if (length < USERNAME_MIN_LENGTH) return "too_short";
  if (length > USERNAME_MAX_LENGTH) return "too_long";
  if (!USERNAME_PATTERN.test(normalized) || !/\p{L}/u.test(normalized)) return "invalid_characters";
  return null;
}

/**
 * Suggests a username from a full name: first name(s) plus the initial of the last name.
 * "Vincent Richter" → "Vincent R.", "Anna Maria Schmidt" → "Anna Maria S.", "Max" → "Max".
 * The result is cut to `USERNAME_MAX_LENGTH`.
 */
export function suggestUsername(fullName: string): string {
  const words = normalizeName(fullName)
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return "";
  const last = words.length > 1 ? words.pop()! : null;
  const initial = last ? [...last][0]!.toUpperCase() : "";
  const suggestion = last ? `${words.join(" ")} ${initial}.` : words[0]!;
  return [...suggestion].slice(0, USERNAME_MAX_LENGTH).join("").trim();
}

const SEED_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** Returns the colour as lower-case `#rrggbb`, or null when it is not such a colour. */
export function normalizeSeedColor(value: string): string | null {
  const lower = value.trim().toLowerCase();
  return SEED_COLOR_PATTERN.test(lower) ? lower : null;
}
