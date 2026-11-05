import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type AppDeviceRegistered,
  type AppDeviceRemoveRequest,
  type AppPushTokenRequest,
  type AppPushTokenSaved,
  type NotificationItem,
  type NotificationList,
  type NotificationSettings,
  type PushPublicKey,
  type PushSubscriptionRequest,
  type PushUnsubscribeRequest,
  type ReminderSent,
  type UpdateNotificationSettingsRequest,
} from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { findAppDeviceUser, registerAppDevice, removeAppDevice, saveAppDeviceToken } from "../notifications/app-devices.js";
import { authOf, createGuards } from "../auth/guards.js";
import type { AppContext } from "../context.js";
import { ApiError, forbidden, notFound, unauthorized, validation } from "../errors.js";
import { NOTIFICATION_KEPT_DAYS } from "../notifications/dispatch.js";
import { areValidPushKeys, isAllowedPushEndpoint } from "../notifications/endpoint.js";
import { loadSettings, saveSettings, SETTING_NAMES } from "../notifications/settings.js";
import { removeSubscription, saveSubscription } from "../notifications/subscriptions.js";
import { notifyReminder } from "../notifications/triggers.js";
import { findPollById } from "../polls/store.js";
import { idParam } from "./shared.js";

/** A person may remind the others of one poll once in this time. */
export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_LIST = 100;

const settingsBody = {
  type: "object",
  required: SETTING_NAMES,
  additionalProperties: false,
  properties: Object.fromEntries(SETTING_NAMES.map((name) => [name, { type: "boolean" }])),
} as const;

const subscribeBody = {
  type: "object",
  required: ["endpoint", "keys"],
  properties: {
    endpoint: { type: "string", maxLength: 4096 },
    keys: {
      type: "object",
      required: ["p256dh", "auth"],
      properties: { p256dh: { type: "string", maxLength: 1000 }, auth: { type: "string", maxLength: 1000 } },
    },
  },
} as const;

const unsubscribeBody = {
  type: "object",
  required: ["endpoint"],
  properties: { endpoint: { type: "string", maxLength: 4096 } },
} as const;

const removeDeviceBody = {
  type: "object",
  required: ["deviceKey"],
  properties: { deviceKey: { type: "string", maxLength: 200 } },
} as const;

const pushTokenBody = {
  type: "object",
  required: ["token"],
  properties: { token: { type: "string", minLength: 1, maxLength: 4096, pattern: "^[\\x21-\\x7e]+$" } },
} as const;

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.get(
    "/api/me/notification-settings",
    { onRequest: requireUser },
    async (request): Promise<NotificationSettings> => loadSettings(ctx.db, authOf(request).user.id),
  );

  app.put<{ Body: UpdateNotificationSettingsRequest }>(
    "/api/me/notification-settings",
    { onRequest: requireUser, schema: { body: settingsBody } },
    async (request): Promise<NotificationSettings> => {
      const { user } = authOf(request);
      const settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
      for (const name of SETTING_NAMES) settings[name] = request.body[name];
      saveSettings(ctx.db, user.id, settings);
      return loadSettings(ctx.db, user.id);
    },
  );

  app.get("/api/push/public-key", { onRequest: requireUser }, async (): Promise<PushPublicKey> => ({
    publicKey: ctx.vapidPublicKey,
  }));

  app.post<{ Body: PushSubscriptionRequest }>(
    "/api/push/subscriptions",
    { onRequest: requireUser, schema: { body: subscribeBody } },
    async (request, reply) => {
      const { user } = authOf(request);
      const { endpoint, keys } = request.body;
      if (!isAllowedPushEndpoint(endpoint) || !areValidPushKeys(keys.p256dh, keys.auth)) {
        throw new ApiError(400, "push_endpoint_invalid");
      }
      saveSubscription(ctx.db, user.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth }, ctx.now());
      return reply.status(204).send();
    },
  );

  app.delete<{ Body: PushUnsubscribeRequest }>(
    "/api/push/subscriptions",
    { onRequest: requireUser, schema: { body: unsubscribeBody } },
    async (request, reply) => {
      // Switching off something that is already off is fine.
      removeSubscription(ctx.db, authOf(request).user.id, request.body.endpoint);
      return reply.status(204).send();
    },
  );

  /** The user's notifications after `after`, from the last 7 days; shared by the session and the device key routes. */
  function listNotifications(userId: number, after: string | undefined): NotificationList {
    if (after !== undefined && !/^\d{1,15}$/.test(after)) throw validation("after");
    const keptSince = new Date(ctx.now().getTime() - NOTIFICATION_KEPT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = ctx.db
      .prepare(
        "SELECT id, data, created_at FROM notifications WHERE user_id = ? AND id > ? AND created_at >= ? ORDER BY id LIMIT ?",
      )
      .all(userId, after === undefined ? 0 : Number(after), keptSince, MAX_LIST) as unknown as {
      id: number;
      data: string;
      created_at: string;
    }[];
    const items: NotificationItem[] = rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      data: JSON.parse(row.data) as NotificationItem["data"],
    }));
    return { items };
  }

  app.get<{ Querystring: { after?: string } }>(
    "/api/notifications",
    { onRequest: requireUser },
    async (request): Promise<NotificationList> => listNotifications(authOf(request).user.id, request.query.after),
  );

  // The Android app's background job calls this from native code with the phone's key. The key opens nothing else.
  app.get<{ Querystring: { after?: string } }>("/api/app-notifications", async (request): Promise<NotificationList> => {
    const key = request.headers["x-device-key"];
    const userId = typeof key === "string" && key !== "" ? findAppDeviceUser(ctx.db, key, ctx.now()) : null;
    if (userId === null) throw unauthorized();
    return listNotifications(userId, request.query.after);
  });

  app.post("/api/app-devices", { onRequest: requireUser }, async (request, reply) => {
    const { user } = authOf(request);
    const deviceKey = registerAppDevice(ctx.db, user.id, ctx.now());
    // A new phone starts after the newest notification, so it does not show the last 7 days.
    const last = ctx.db.prepare("SELECT MAX(id) AS id FROM notifications WHERE user_id = ?").get(user.id) as {
      id: number | null;
    };
    const body: AppDeviceRegistered = { deviceKey, lastNotificationId: last.id ?? 0 };
    return reply.status(201).send(body);
  });

  // The app's native code sends the phone's Firebase token with the device key (no session, nothing in the URL).
  app.put<{ Body: AppPushTokenRequest }>(
    "/api/app-devices/push-token",
    { schema: { body: pushTokenBody } },
    async (request): Promise<AppPushTokenSaved> => {
      const key = request.headers["x-device-key"];
      const userId = typeof key === "string" && key !== "" ? findAppDeviceUser(ctx.db, key, ctx.now()) : null;
      if (userId === null || typeof key !== "string") throw unauthorized();
      saveAppDeviceToken(ctx.db, key, request.body.token);
      return { instant: ctx.ringDevice !== null };
    },
  );

  app.delete<{ Body: AppDeviceRemoveRequest }>(
    "/api/app-devices",
    { onRequest: requireUser, schema: { body: removeDeviceBody } },
    async (request, reply) => {
      // Switching off something that is already off (or not yours) is fine.
      removeAppDevice(ctx.db, authOf(request).user.id, request.body.deviceKey);
      return reply.status(204).send();
    },
  );

  // Only the creator (not an admin) reminds the participants who have not voted.
  app.post("/api/polls/:id/reminders", { onRequest: requireUser }, async (request): Promise<ReminderSent> => {
    const { user } = authOf(request);
    const poll = findPollById(ctx.db, idParam(request), ctx.now());
    if (!poll) throw notFound();
    if (poll.creator_id !== user.id) throw forbidden();
    if (poll.fixed_proposal_id !== null) throw new ApiError(409, "poll_fixed");
    const now = ctx.now();
    if (poll.last_reminder_at !== null) {
      const waitMs = Date.parse(poll.last_reminder_at) + REMINDER_INTERVAL_MS - now.getTime();
      if (waitMs > 0) throw new ApiError(429, "reminder_too_soon", { retryAfterSeconds: Math.ceil(waitMs / 1000) });
    }
    const recipients = notifyReminder(ctx, poll, user.username);
    const sentAt = now.toISOString();
    if (recipients > 0) ctx.db.prepare("UPDATE polls SET last_reminder_at = ? WHERE id = ?").run(sentAt, poll.id);
    return { sentAt, recipients };
  });
}
