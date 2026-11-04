import type { DatabaseSync } from "node:sqlite";
import type { PushTarget } from "./send.js";

/** A person can switch on this many devices; a new one beyond that pushes the oldest out. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/** Saves the subscription for the user. The same address moves to this user (a browser that changed account). */
export function saveSubscription(db: DatabaseSync, userId: number, target: PushTarget, now: Date): void {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       created_at = excluded.created_at`,
  ).run(userId, target.endpoint, target.p256dh, target.auth, now.toISOString());
  db.prepare(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
  ).run(userId, userId, MAX_SUBSCRIPTIONS_PER_USER);
}

/** Removes the user's own subscription with this address; false when they have none. */
export function removeSubscription(db: DatabaseSync, userId: number, endpoint: string): boolean {
  return Number(db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(userId, endpoint).changes) > 0;
}

/** Removes a subscription the push service reported as gone. */
export function removeSubscriptionByEndpoint(db: DatabaseSync, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function subscriptionsOf(db: DatabaseSync, userId: number): PushTarget[] {
  return db
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY id")
    .all(userId) as unknown as PushTarget[];
}
