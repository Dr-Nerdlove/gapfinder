import type { DatabaseSync } from "node:sqlite";
import { generateToken, hashToken } from "../auth/tokens.js";
import { addDays } from "../time.js";

/** A person can use the app on this many phones; a new one beyond that pushes the one used longest ago out. */
export const MAX_APP_DEVICES_PER_USER = 10;
/** A key that was not used for this long stops working and is deleted. */
export const APP_DEVICE_UNUSED_DAYS = 90;

function unusedBefore(now: Date): string {
  return addDays(now, -APP_DEVICE_UNUSED_DAYS).toISOString();
}

/** Makes a key for a new phone and returns it (the only time it exists in clear; only its hash is stored). */
export function registerAppDevice(db: DatabaseSync, userId: number, now: Date): string {
  const key = generateToken();
  const iso = now.toISOString();
  db.prepare("DELETE FROM app_devices WHERE last_used_at < ?").run(unusedBefore(now));
  db.prepare("INSERT INTO app_devices (user_id, key_hash, created_at, last_used_at) VALUES (?, ?, ?, ?)").run(
    userId,
    hashToken(key),
    iso,
    iso,
  );
  db.prepare(
    `DELETE FROM app_devices WHERE user_id = ? AND id NOT IN (
       SELECT id FROM app_devices WHERE user_id = ? ORDER BY last_used_at DESC, id DESC LIMIT ?)`,
  ).run(userId, userId, MAX_APP_DEVICES_PER_USER);
  return key;
}

/** The user the key belongs to (and marks the key as used now), or null for an unknown or expired key. */
export function findAppDeviceUser(db: DatabaseSync, key: string, now: Date): number | null {
  const keyHash = hashToken(key);
  const row = db.prepare("SELECT user_id, last_used_at FROM app_devices WHERE key_hash = ?").get(keyHash) as
    | { user_id: number; last_used_at: string }
    | undefined;
  if (!row) return null;
  if (row.last_used_at < unusedBefore(now)) {
    db.prepare("DELETE FROM app_devices WHERE key_hash = ?").run(keyHash);
    return null;
  }
  db.prepare("UPDATE app_devices SET last_used_at = ? WHERE key_hash = ?").run(now.toISOString(), keyHash);
  return row.user_id;
}

/** Removes the user's own device with this key; false when they have none. */
export function removeAppDevice(db: DatabaseSync, userId: number, key: string): boolean {
  return Number(db.prepare("DELETE FROM app_devices WHERE user_id = ? AND key_hash = ?").run(userId, hashToken(key)).changes) > 0;
}

export function removeAppDevicesOfUser(db: DatabaseSync, userId: number): void {
  db.prepare("DELETE FROM app_devices WHERE user_id = ?").run(userId);
}

/**
 * Stores the phone's Firebase token on the row of this key. The same token is first cleared from any other row
 * (a token belongs to one phone: after a reinstall or a logout it may sit on an old row). False for an unknown key.
 */
export function saveAppDeviceToken(db: DatabaseSync, key: string, token: string): boolean {
  const keyHash = hashToken(key);
  db.prepare("UPDATE app_devices SET fcm_token = NULL WHERE fcm_token = ? AND key_hash <> ?").run(token, keyHash);
  return Number(db.prepare("UPDATE app_devices SET fcm_token = ? WHERE key_hash = ?").run(token, keyHash).changes) > 0;
}

/** The Firebase tokens of the user's phones that are still in use. */
export function ringTokensOf(db: DatabaseSync, userId: number, now: Date): string[] {
  const rows = db
    .prepare("SELECT fcm_token FROM app_devices WHERE user_id = ? AND fcm_token IS NOT NULL AND last_used_at >= ?")
    .all(userId, unusedBefore(now)) as { fcm_token: string }[];
  return rows.map((row) => row.fcm_token);
}

/** Forgets a token that Firebase reports as invalid. */
export function clearAppDeviceToken(db: DatabaseSync, token: string): void {
  db.prepare("UPDATE app_devices SET fcm_token = NULL WHERE fcm_token = ?").run(token);
}

/** How many phones could be rung (have a token and are still in use). */
export function countRingableDevices(db: DatabaseSync, now: Date): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM app_devices WHERE fcm_token IS NOT NULL AND last_used_at >= ?")
    .get(unusedBefore(now)) as { n: number };
  return Number(row.n);
}
