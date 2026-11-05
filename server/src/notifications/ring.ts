import { JWT } from "google-auth-library";
import type { FcmAccount } from "../config.js";

export type RingResult = { ok: true } | { ok: false; gone: boolean; status?: number; reason?: string };

/** Rings one phone by its Firebase token. Never throws; never logs or returns the token. */
export type RingDevice = (token: string) => Promise<RingResult>;

/** Gives an OAuth2 access token for the FCM HTTP v1 API (caches it until it expires). */
export type TokenSource = () => Promise<string | null | undefined>;

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const RING_TIMEOUT_MS = 10_000;
/** FCM error codes that say the token is dead for good. */
const GONE_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

/**
 * The code of an FCM error answer: `error.details[]` holds an entry of type `...google.firebase.fcm.v1.FcmError`
 * with `errorCode` (this is how firebase-admin reads it). Null when there is none.
 */
export function fcmErrorCode(body: unknown): string | null {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const entry of details as unknown[]) {
    const detail = entry as { "@type"?: unknown; errorCode?: unknown } | null;
    if (
      typeof detail?.["@type"] === "string" &&
      detail["@type"].endsWith("google.firebase.fcm.v1.FcmError") &&
      typeof detail.errorCode === "string"
    ) {
      return detail.errorCode;
    }
  }
  return null;
}

/** Whether FCM's answer means the token is gone for good. */
export function isGoneAnswer(status: number, body: unknown): boolean {
  const code = fcmErrorCode(body);
  return code !== null ? GONE_CODES.has(code) : status === 404;
}

/** The Google login of the service account; `getAccessToken` caches the token. */
export function createTokenSource(account: FcmAccount): TokenSource {
  const client = new JWT({ email: account.clientEmail, key: account.privateKey, scopes: [SCOPE] });
  return async () => (await client.getAccessToken()).token;
}

/**
 * The doorbell: one FCM data message that carries NO content (no title, text, poll or name), only the fixed kind
 * `check`. The app then asks the server what is new. High priority, so a sleeping phone wakes up at once.
 */
export function createFcmRinger(account: FcmAccount, tokenSource: TokenSource = createTokenSource(account)): RingDevice {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`;
  return async (token) => {
    let accessToken: string | null | undefined;
    try {
      accessToken = await tokenSource();
    } catch {
      return { ok: false, gone: false, reason: "auth" };
    }
    if (!accessToken) return { ok: false, gone: false, reason: "auth" };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            data: { kind: "check" },
            android: { priority: "high", ttl: "86400s", collapse_key: "check" },
          },
        }),
        signal: AbortSignal.timeout(RING_TIMEOUT_MS),
      });
      if (response.ok) {
        await response.body?.cancel().catch(() => {});
        return { ok: true };
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // No JSON answer: only the status counts.
      }
      return { ok: false, gone: isGoneAnswer(response.status, body), status: response.status };
    } catch {
      return { ok: false, gone: false, reason: "network" };
    }
  };
}
