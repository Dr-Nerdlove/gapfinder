import type { Proposal } from "./polls.js";

/** Which kinds of notification a person wants (`GET`/`PUT /api/me/notification-settings`). */
export interface NotificationSettings {
  /** A poll was created that includes me. */
  pollCreated: boolean;
  /** Someone voted in a poll I created. */
  voteOwn: boolean;
  /** Someone voted in a poll of somebody else that I am involved in. */
  voteOthers: boolean;
  /** Everybody has voted in a poll I created. */
  allVotedOwn: boolean;
  /** Everybody has voted in a poll of somebody else that I am involved in. */
  allVotedOthers: boolean;
  /** The date of a poll was fixed or changed (and it is not a date I said "Nein" to). */
  dateFixed: boolean;
  /** The creator reminds me to vote. */
  reminder: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  pollCreated: true,
  voteOwn: true,
  voteOthers: false,
  allVotedOwn: true,
  allVotedOthers: false,
  dateFixed: true,
  reminder: true,
};

/** Fields every notification carries; the app makes the German text from them (the server sends no text). */
interface NotificationBase {
  pollTitle: string;
  /** Opens the poll in the app. */
  shareToken: string;
}

/**
 * What happened, as data. `actorName` is the username of the account, or the name a guest gave; for
 * `all_voted` it is the last voter. Only ever add kinds and fields: an older app ignores kinds it does not know.
 */
export type NotificationData =
  | (NotificationBase & { kind: "poll_created"; actorName: string })
  | (NotificationBase & { kind: "vote"; actorName: string })
  | (NotificationBase & { kind: "all_voted"; actorName: string })
  | (NotificationBase & { kind: "date_fixed"; actorName: string; proposal: Proposal })
  | (NotificationBase & { kind: "reminder"; actorName: string });

export type NotificationKind = NotificationData["kind"];

/** One stored notification; it is also the payload of a Web Push message. */
export interface NotificationItem {
  id: number;
  /** ISO 8601, UTC. */
  createdAt: string;
  data: NotificationData;
}

/** `PUT /api/me/notification-settings` takes all settings at once and answers with what is stored. */
export type UpdateNotificationSettingsRequest = NotificationSettings;

/** `GET /api/push/public-key`: the server's VAPID key (base64url), needed to subscribe a browser. */
export interface PushPublicKey {
  publicKey: string;
}

/**
 * `POST /api/push/subscriptions` (login) → 204: switches this device on (the same address moves to this account).
 * Only the known push services are accepted (`push_endpoint_invalid`, 400). At most 10 per account; the oldest goes.
 * `DELETE /api/push/subscriptions` with `{ endpoint }` → 204 switches it off (only the caller's own).
 */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushUnsubscribeRequest {
  endpoint: string;
}

/** `GET /api/notifications?after=<id>` (login): the caller's own notifications newer than `after`, oldest first, at most 100. */
export interface NotificationList {
  items: NotificationItem[];
}

/** `POST /api/polls/:id/reminders` (creator only) → 200. At most one per 24 hours (`reminder_too_soon`, 429). */
export interface ReminderSent {
  /** ISO 8601, UTC. */
  sentAt: string;
  /** How many accounts got it (the ones who have not voted and have the setting on). */
  recipients: number;
}
