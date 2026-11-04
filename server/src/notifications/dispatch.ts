import type { NotificationData, NotificationItem } from "@lueckenfueller/shared";
import type { DatabaseSync } from "node:sqlite";
import type { AppContext } from "../context.js";
import type { PushTarget } from "./send.js";
import type { Recipient } from "./recipients.js";
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

/** Stores one notification for each recipient whose setting is on. Returns what was stored. */
function store(ctx: AppContext, pollId: number, data: NotificationData, recipients: Recipient[]): Stored[] {
  const settings = loadSettingsOf(ctx.db, recipients.map((recipient) => recipient.userId));
  const createdAt = ctx.now().toISOString();
  const insert = ctx.db.prepare("INSERT INTO notifications (user_id, poll_id, data, created_at) VALUES (?, ?, ?, ?)");
  const done = new Set<number>();
  const stored: Stored[] = [];
  purgeOldNotifications(ctx.db, ctx.now());
  for (const { userId, setting } of recipients) {
    if (done.has(userId) || !settings.get(userId)?.[setting]) continue;
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

/**
 * Stores the notification for every recipient who wants it, and sends Web Push to their devices without making
 * the caller wait. Never throws: a failed notification must not fail the vote or the poll. Returns how many
 * accounts got it.
 */
export function notify(ctx: AppContext, pollId: number, data: NotificationData, recipients: Recipient[]): number {
  try {
    const stored = store(ctx, pollId, data, recipients);
    if (stored.length > 0) {
      void push(ctx, stored).catch(() => {
        // Already handled per message; this only keeps an unexpected error from becoming a crash.
      });
    }
    return stored.length;
  } catch (error) {
    ctx.log.warn({ kind: data.kind, err: (error as Error).name }, "Notification could not be stored");
    return 0;
  }
}
