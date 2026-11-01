/** Version of the HTTP API. Increase only for breaking changes; the server must stay backward compatible. */
export const API_VERSION = 1;

export * from "./accounts.js";
export * from "./calendars.js";

/** Response of `GET /api/health`. */
export interface HealthResponse {
  status: "ok";
  /** Version of the running server (the image's `APP_VERSION`). */
  version: string;
  /** Server time as ISO 8601 string (UTC). */
  time: string;
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
