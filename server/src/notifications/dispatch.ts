import type { NotificationData, NotificationItem } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import type { AppContext } from "../context.js";
import type { RingDevice, RingResult } from "./ring.js";
import type { PushTarget } from "./send.js";
import type { Recipient } from "./recipients.js";
import { clearAppDeviceToken, ringTokensOf } from "./app-devices.js";
import { loadSettingsOf } from "./settings.js";
import { removeSubscriptionByEndpoint, subscriptionsOf } from "./subscriptions.js";

/** Notifications are kept this long for the apps that fetch them (`GET /api/notifications`). */
export const NOTIFICATION_KEPT_DAYS = 7;

/** Deletes notifications older than 7 days. */
export function purgeOldNotifications(db: DatabaseSync, now: Date): void {
  const limit = new Date(now.getTime() - NOTIFICATION_KEPT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM notifications WHERE created_at < ?").run(limit);
}

interface Stored {
  userId: number;
  item: NotificationItem;
}

/**
 * Stores one notification for each recipient whose setting is on (`setting: null` means always). Returns what was stored.
 */
function store(ctx: AppContext, pollId: number | null, data: NotificationData, recipients: Recipient[]): Stored[] {
  const settings = loadSettingsOf(ctx.db, recipients.map((recipient) => recipient.userId));
  const createdAt = ctx.now().toISOString();
  const insert = ctx.db.prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (?, ?, ?, ?)");
  const done = new Set<number>();
  const stored: Stored[] = [];
  purgeOldNotifications(ctx.db, ctx.now());
  for (const { userId, setting } of recipients) {
    if (done.has(userId) || (setting !== null && !settings.get(userId)?.[setting])) continue;
    done.add(userId);
    const result = insert.run(userId, pollId, JSON.stringify(data), createdAt);
    stored.push({ userId, item: { id: Number(result.lastInsertRowid), createdAt, data } });
  }
  return stored;
}

async function pushOne(ctx: AppContext, kind: string, target: PushTarget, payload: string): Promise<void> {
  try {
    await ctx.sendPush(target, payload);
  } catch (error) {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    const statusCode = typeof status === "number" ? status : undefined;
    if (statusCode === 404 || statusCode === 410) {
      try {
        removeSubscriptionByEndpoint(ctx.db, target.endpoint);
      } catch {
        // The database may be closed already (shutdown); nothing more to do.
      }
    }
    // Never the endpoint or the keys: they identify a person's device.
    ctx.log.warn({ kind, status: statusCode }, "Push message was not delivered");
  }
}

async function push(ctx: AppContext, stored: Stored[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const { userId, item } of stored) {
    const payload = JSON.stringify(item);
    for (const target of subscriptionsOf(ctx.db, userId)) jobs.push(pushOne(ctx, item.data.kind, target, payload));
  }
  await Promise.all(jobs);
}

async function ringOne(ctx: AppContext, kind: string, ring: RingDevice, token: string): Promise<void> {
  const result = await ring(token).catch((): RingResult => ({ ok: false, gone: false, reason: "error" }));
  ctx.doorbell.lastRing = { at: ctx.now().toISOString(), ok: result.ok };
  if (result.ok) return;
  if (result.gone) {
    try {
      clearAppDeviceToken(ctx.db, token);
    } catch {
      // The database may be closed already (shutdown); nothing more to do.
    }
  }
  // Never the token: it is the address of a person's phone.
  ctx.log.warn({ kind, status: result.status, reason: result.reason }, "Ring was not delivered");
}

/** Rings every app device of the stored users once. The ring carries no content: the app asks the server itself. */
async function ring(ctx: AppContext, stored: Stored[]): Promise<void> {
  const ringer = ctx.ringDevice;
  if (!ringer) return;
  const jobs: Promise<void>[] = [];
  for (const { userId, item } of stored) {
    for (const token of ringTokensOf(ctx.db, userId, ctx.now())) jobs.push(ringOne(ctx, item.data.kind, ringer, token));
  }
  await Promise.all(jobs);
}

/**
 * Stores the notification for every recipient who wants it (and is not in `skip`), and sends Web Push and the Android ring to their
 * devices without making the caller wait. Never throws: a failed notification must not fail the vote or the poll.
 * Returns the ids of the accounts that got it.
 */
export function notifyUsers(
  ctx: AppContext,
  pollId: number | null,
  data: NotificationData,
  recipients: Recipient[],
  skip: ReadonlySet<number> = new Set(),
): Set<number> {
  try {
    const stored = store(ctx, pollId, data, skip.size > 0 ? recipients.filter((r) => !skip.has(r.userId)) : recipients);
    if (stored.length > 0) {
      void push(ctx, stored).catch(() => {
        // Already handled per message; this only keeps an unexpected error from becoming a crash.
      });
      void ring(ctx, stored).catch(() => {
        // Same: handled per ring.
      });
    }
    return new Set(stored.map((entry) => entry.userId));
  } catch (error) {
    ctx.log.warn({ kind: data.kind, err: (error as Error).name }, "Notification could not be stored");
    return new Set();
  }
}

/**
 * Tells every admin except `exceptUserId` that an account was deleted (no setting, no poll). The notification belongs
 * to the admin, so it stays after the deleted user's row is gone. Never throws.
 */
export function notifyAdminsOfDeletedAccount(ctx: AppContext, username: string, exceptUserId: number): void {
  try {
    const rows = ctx.db.prepare("SELECT id FROM users WHERE is_admin = 1 AND id != ?").all(exceptUserId) as { id: number }[];
    notifyUsers(
      ctx,
      null,
      { kind: "account_deleted", actorName: username },
      rows.map((row) => ({ userId: row.id, setting: null })),
    );
  } catch (error) {
    ctx.log.warn({ kind: "account_deleted", err: (error as Error).name }, "Notification could not be stored");
  }
}

/** Tells every admin (no setting, no poll), the person the news is about included. Never throws. */
export function notifyAdmins(ctx: AppContext, data: NotificationData): void {
  try {
    const rows = ctx.db.prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
    notifyUsers(ctx, null, data, rows.map((row) => ({ userId: row.id, setting: null })));
  } catch (error) {
    ctx.log.warn({ kind: data.kind, err: (error as Error).name }, "Notification could not be stored");
  }
}

/** Like `notifyUsers`, but returns only how many accounts got it. */
export function notify(ctx: AppContext, pollId: number, data: NotificationData, recipients: Recipient[]): number {
  return notifyUsers(ctx, pollId, data, recipients).size;
}
