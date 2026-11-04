import webpush from "web-push";
import type { VapidKeys } from "./vapid.js";

/** A browser's push subscription. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends one encrypted message. Rejects when the push service does not accept it; the error then has the
 * service's HTTP status as `statusCode` (404 and 410 mean the subscription is gone).
 */
export type SendPush = (target: PushTarget, payload: string) => Promise<void>;

/** Messages are kept by the push service for at most 3 days when the device is off. */
export const PUSH_TTL_SECONDS = 3 * 24 * 60 * 60;
const PUSH_TIMEOUT_MS = 10_000;

/** The real sender (tests swap it). The endpoint must have passed `isAllowedPushEndpoint` before it was stored. */
export function createWebPushSender(keys: VapidKeys, subject: string): SendPush {
  return async (target, payload) => {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      {
        TTL: PUSH_TTL_SECONDS,
        timeout: PUSH_TIMEOUT_MS,
        vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      },
    );
  };
}
