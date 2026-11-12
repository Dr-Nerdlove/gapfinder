/** Version of the HTTP API. Increase only for breaking changes; the server must stay backward compatible. */
export const API_VERSION = 1;

export * from "./accounts.js";
export * from "./calendars.js";
export * from "./gaps.js";
export * from "./groups.js";
export * from "./notifications.js";
export * from "./polls.js";

/** Response of `GET /api/health`. */
export interface HealthResponse {
  status: "ok";
  /** Version of the running server (the image's `APP_VERSION`). */
  version: string;
  /** Server time as ISO 8601 string (UTC). */
  time: string;
  /**
   * What this server supports beyond the first API (`ServerFeature`). Added later: an older server does not send
   * it (= none). The app offers a feature only when its name is listed, because the frontend is deployed before the
   * server is updated.
   */
  features?: ServerFeature[];
}

/** `hidden_votes`: polls with hidden votes (phase 10b). */
export type ServerFeature = "hidden_votes";

/**
 * `GET /api/admin/backup-status` (admin only): when the VM's backup script last did what, from the file it writes.
 * Times are ISO 8601 (UTC); a time that is missing or unreadable is null. Missing from servers older than this.
 */
export interface BackupStatus {
  /** False when the VM has not written a status file (yet): backups not set up, or `setup.sh` not rerun. */
  known: boolean;
  /** The last regular backup saved in the VM. */
  lastBackupAt: string | null;
  /** The last run after which all backups were also in the Windows folder. */
  lastCopyAt: string | null;
  /** The last trial restore (or restore) that decrypted and checked a backup. */
  lastCheckAt: string | null;
}

/**
 * `GET /api/admin/doorbell-status` (admin only): whether the server can ring Android phones through Firebase.
 * Missing from servers older than this.
 */
export interface DoorbellStatus {
  /** `ready`: a usable Firebase key; `not_configured`: none set; `invalid`: set but unusable. */
  state: "ready" | "not_configured" | "invalid";
  /** Phones (in use) that told the server their Firebase address. */
  devicesWithToken: number;
  /** The last ring since the server started (in memory only); null when there was none. */
  lastRing: { at: string; ok: boolean } | null;
}

/** `PUT /api/app-devices/push-token` (header `X-Device-Key`): the phone's Firebase token. */
export interface AppPushTokenRequest {
  token: string;
}

export interface AppPushTokenSaved {
  /** True when the server can ring phones (has a usable Firebase key). */
  instant: boolean;
}

/**
 * Machine-readable reason of a failed request. The frontend turns it into German text; the server never sends
 * text meant for users. Only ever add codes: an older frontend treats unknown codes as a generic error.
 */
export type ErrorCode =
  /** The body or a parameter is invalid (see `field`). */
  | "validation"
  /** No valid session token was sent, or it has expired. */
  | "unauthorized"
  /** Logged in, but not allowed (e.g. not an admin). */
  | "forbidden"
  /** The thing does not exist (or is not visible to the caller). */
  | "not_found"
  /** Wrong username or password. Deliberately does not say which. */
  | "invalid_credentials"
  /** Too many attempts; `retryAfterSeconds` says how long to wait. */
  | "rate_limited"
  /** Another account already has this username (compared without case). */
  | "username_taken"
  /** The invite link is unknown, used or expired. */
  | "invite_invalid"
  /** The password reset link is unknown, used or expired. */
  | "reset_invalid"
  /** The current password given to change the password is wrong. */
  | "wrong_password"
  /** The admin tried to delete their own account. */
  | "cannot_delete_self"
  /** The calendar link is not an `https://` or `webcal://` address on the standard port. */
  | "calendar_link_invalid"
  /** The calendar link (or a redirect) points to an address the server may not reach (e.g. a home network). */
  | "calendar_link_blocked"
  /** The provider says there is no calendar at this link (wrong, reset or no longer published). */
  | "calendar_gone"
  /** The provider did not answer in time, or the connection failed. Trying again later may work. */
  | "calendar_unreachable"
  /** The link answered, but not with a calendar (e.g. a login page). */
  | "calendar_not_ics"
  /** The calendar is bigger than the server reads (10 MB). */
  | "calendar_too_large"
  /** The person already has the most calendars allowed (`CALENDARS_PER_USER`). */
  | "calendar_limit"
  /** Calendars cannot be used: the server has no or the wrong key for the stored links (admin must set it up). */
  | "calendars_unavailable"
  /** The poll share link is unknown, was replaced by a new one, or the poll has been deleted. */
  | "poll_invalid"
  /** The poll does not take votes: closed by hand, past its deadline, or its date is fixed. */
  | "poll_closed"
  /** The poll has no fixed date (yet), so there is nothing to download as a calendar file. */
  | "poll_not_fixed"
  /** The poll already has the most guest votes allowed (`POLL_MAX_GUEST_VOTES`). */
  | "poll_full"
  /** The person already has the most polls allowed (`POLLS_PER_USER`). */
  | "poll_limit"
  /** The poll already has a fixed date, so a reminder to vote makes no sense. */
  | "poll_fixed"
  /** A reminder for this poll was sent less than 24 hours ago (`retryAfterSeconds` says how long to wait). */
  | "reminder_too_soon"
  /** The push address is not one of the known push services (https, port 443), or its keys are malformed. */
  | "push_endpoint_invalid"
  /** The person already has the most groups allowed (`GROUPS_PER_USER`). */
  | "group_limit"
  /** A guest's name is an account's username or another guest's name in this poll. */
  | "vote_name_taken"
  /** Anything else (server errors, unknown routes). */
  | "error";

/** Body of every error response (status 4xx or 5xx). */
export interface ApiErrorBody {
  statusCode: number;
  /** Short technical label (e.g. "Request Error"); never shown to users. */
  error: string;
  code: ErrorCode;
  /** With `validation`: the field of the request body that is wrong, e.g. "username". */
  field?: string;
  /** With `rate_limited`: seconds until the next attempt is allowed. */
  retryAfterSeconds?: number;
}
