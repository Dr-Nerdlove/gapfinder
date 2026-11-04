import type {
  AcceptInviteRequest,
  AdminInvite,
  AdminRenameUserRequest,
  AdminUser,
  AddCalendarRequest,
  AccountVoteRequest,
  ApiErrorBody,
  BackupStatus,
  Calendar,
  CalendarList,
  CalendarFeed,
  CalendarPreview,
  ChangePasswordRequest,
  CompletePasswordResetRequest,
  CreatePollRequest,
  CreateInviteRequest,
  CreatedInvite,
  CreatedPasswordReset,
  ErrorCode,
  FixCheck,
  FixPollRequest,
  GuestVoteCreated,
  GuestVoteRequest,
  InviteInfo,
  LoginRequest,
  Me,
  PasswordResetInfo,
  NewShareLink,
  NotificationSettings,
  PeopleList,
  PollList,
  PollView,
  PushPublicKey,
  PushSubscriptionRequest,
  PushUnsubscribeRequest,
  ReminderSent,
  SearchRequest,
  SearchResult,
  SessionResponse,
  UpdateCalendarRequest,
  UpdateMeRequest,
  UpdatePollRequest,
} from "@lueckenfueller/shared";
import { API_URL } from "./config";

/** Slower than the health check: logging in hashes a password on the server. */
export const REQUEST_TIMEOUT_MS = 10000;

/** The request did not get an answer (no network, server asleep, timeout). */
export interface OfflineFailure {
  ok: false;
  kind: "offline";
}

/** The server answered with an error. `code` is "error" when the body was missing or not understood. */
export interface ErrorFailure {
  ok: false;
  kind: "error";
  status: number;
  code: ErrorCode;
  field?: string;
  retryAfterSeconds?: number;
}

export type ApiFailure = OfflineFailure | ErrorFailure;
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * Adding or changing a calendar link and the preview fetch calendars from outside; the server waits up to
 * about 25 seconds for them, so the app waits a little longer.
 */
export const CALENDAR_REQUEST_TIMEOUT_MS = 35000;

export interface CallOptions {
  token?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** A guest's secret vote key, sent as `X-Vote-Key`. */
  voteKey?: string;
}

export interface RequestOptions extends CallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

// A Record keeps this list complete: a new ErrorCode in `shared` fails to compile until it is added here.
const KNOWN_CODES: Record<ErrorCode, true> = {
  validation: true,
  unauthorized: true,
  forbidden: true,
  not_found: true,
  invalid_credentials: true,
  rate_limited: true,
  username_taken: true,
  invite_invalid: true,
  reset_invalid: true,
  wrong_password: true,
  cannot_delete_self: true,
  calendar_link_invalid: true,
  calendar_link_blocked: true,
  calendar_gone: true,
  calendar_unreachable: true,
  calendar_not_ics: true,
  calendar_too_large: true,
  calendar_limit: true,
  calendars_unavailable: true,
  poll_invalid: true,
  poll_closed: true,
  poll_not_fixed: true,
  poll_full: true,
  poll_limit: true,
  poll_fixed: true,
  reminder_too_soon: true,
  push_endpoint_invalid: true,
  vote_name_taken: true,
  error: true,
};

function isKnownCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(KNOWN_CODES, value);
}

/** Reads an error body. Anything that is not an `ApiErrorBody` with a known code becomes the generic "error". */
export function parseErrorBody(status: number, body: unknown): ErrorFailure {
  const failure: ErrorFailure = { ok: false, kind: "error", status, code: "error" };
  if (typeof body !== "object" || body === null) return failure;
  const record = body as Partial<ApiErrorBody>;
  if (!isKnownCode(record.code)) return failure;
  failure.code = record.code;
  if (typeof record.field === "string") failure.field = record.field;
  if (typeof record.retryAfterSeconds === "number" && Number.isFinite(record.retryAfterSeconds)) {
    failure.retryAfterSeconds = record.retryAfterSeconds;
  }
  return failure;
}

/** True when the server says the session token is no longer valid (wrong passwords also use 401, but are not this). */
export function isSessionExpired(result: ApiResult<unknown>): boolean {
  if (result.ok || result.kind !== "error") return false;
  if (result.code === "unauthorized") return true;
  return result.status === 401 && result.code !== "wrong_password" && result.code !== "invalid_credentials";
}

/** One request to the API. Never throws. 204 gives `data: undefined`. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = "GET", body, token, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch, baseUrl = API_URL, voteKey } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (voteKey) headers["X-Vote-Key"] = voteKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      text = response.status === 204 ? "" : await response.text();
    } catch {
      return { ok: false, kind: "offline" };
    }

    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!response.ok) return parseErrorBody(response.status, parsed);
    if (response.status === 204) return { ok: true, data: undefined as T };
    // A success without a readable JSON body is not something the contract allows.
    if (parsed === undefined) return { ok: false, kind: "error", status: response.status, code: "error" };
    return { ok: true, data: parsed as T };
  } finally {
    clearTimeout(timer);
  }
}

const segment = (value: string | number): string => encodeURIComponent(String(value));

// Typed functions, one per endpoint of `shared/src/accounts.ts`.

export const login = (body: LoginRequest, o: CallOptions = {}) =>
  request<SessionResponse>("/api/auth/login", { ...o, method: "POST", body });

export const logout = (o: CallOptions = {}) => request<void>("/api/auth/logout", { ...o, method: "POST" });

export const getMe = (o: CallOptions = {}) => request<Me>("/api/me", o);

export const updateMe = (body: UpdateMeRequest, o: CallOptions = {}) =>
  request<Me>("/api/me", { ...o, method: "PATCH", body });

export const changePassword = (body: ChangePasswordRequest, o: CallOptions = {}) =>
  request<void>("/api/me/password", { ...o, method: "POST", body });

export const getInvite = (token: string, o: CallOptions = {}) => request<InviteInfo>(`/api/invites/${segment(token)}`, o);

export const acceptInvite = (token: string, body: AcceptInviteRequest, o: CallOptions = {}) =>
  request<SessionResponse>(`/api/invites/${segment(token)}/accept`, { ...o, method: "POST", body });

export const getPasswordReset = (token: string, o: CallOptions = {}) =>
  request<PasswordResetInfo>(`/api/password-resets/${segment(token)}`, o);

export const completePasswordReset = (token: string, body: CompletePasswordResetRequest, o: CallOptions = {}) =>
  request<SessionResponse>(`/api/password-resets/${segment(token)}`, { ...o, method: "POST", body });

export const listUsers = (o: CallOptions = {}) => request<AdminUser[]>("/api/admin/users", o);

export const renameUser = (id: number, body: AdminRenameUserRequest, o: CallOptions = {}) =>
  request<AdminUser>(`/api/admin/users/${segment(id)}`, { ...o, method: "PATCH", body });

export const deleteUser = (id: number, o: CallOptions = {}) =>
  request<void>(`/api/admin/users/${segment(id)}`, { ...o, method: "DELETE" });

export const createPasswordReset = (id: number, o: CallOptions = {}) =>
  request<CreatedPasswordReset>(`/api/admin/users/${segment(id)}/password-reset`, { ...o, method: "POST" });

/** Not on servers older than the backup status: they answer 404, which callers treat as "nothing to show". */
export const getBackupStatus = (o: CallOptions = {}) => request<BackupStatus>("/api/admin/backup-status", o);

export const listInvites = (o: CallOptions = {}) => request<AdminInvite[]>("/api/admin/invites", o);

/**
 * The invite request for an exact username. It carries the same text as `username` (current servers) and as
 * `name` (older servers, which only know that field and turn it into a suggestion).
 */
export const inviteRequest = (username: string): CreateInviteRequest => ({ username, name: username });

export const createInvite = (body: CreateInviteRequest, o: CallOptions = {}) =>
  request<CreatedInvite>("/api/admin/invites", { ...o, method: "POST", body });

export const deleteInvite = (id: number, o: CallOptions = {}) =>
  request<void>(`/api/admin/invites/${segment(id)}`, { ...o, method: "DELETE" });

// Calendars (`shared/src/calendars.ts`). The server never sends a link, only the provider and the name.

export const listCalendars = (o: CallOptions = {}) => request<CalendarList>("/api/calendars", o);

export const addCalendar = (body: AddCalendarRequest, o: CallOptions = {}) =>
  request<Calendar>("/api/calendars", { timeoutMs: CALENDAR_REQUEST_TIMEOUT_MS, ...o, method: "POST", body });

export const updateCalendar = (id: number, body: UpdateCalendarRequest, o: CallOptions = {}) =>
  request<Calendar>(`/api/calendars/${segment(id)}`, { timeoutMs: CALENDAR_REQUEST_TIMEOUT_MS, ...o, method: "PATCH", body });

export const deleteCalendar = (id: number, o: CallOptions = {}) =>
  request<void>(`/api/calendars/${segment(id)}`, { ...o, method: "DELETE" });

export const getCalendarPreview = (o: CallOptions = {}) =>
  request<CalendarPreview>("/api/calendars/preview", { timeoutMs: CALENDAR_REQUEST_TIMEOUT_MS, ...o });

// Gap search (`shared/src/gaps.ts`). The server reads the calendars fresh, up to 8 at a time, so it can take long.

/** Generous: 50 people with up to 10 calendars each are read 8 at a time, each up to about 25 seconds. */
export const SEARCH_REQUEST_TIMEOUT_MS = 90000;

export const listPeople = (o: CallOptions = {}) => request<PeopleList>("/api/people", o);

export const searchGaps = (body: SearchRequest, o: CallOptions = {}) =>
  request<SearchResult>("/api/searches", { timeoutMs: SEARCH_REQUEST_TIMEOUT_MS, ...o, method: "POST", body });

// Polls (`shared/src/polls.ts`). The routes under `/api/poll-links` need only the share link (a login is optional);
// a guest changes or withdraws their vote with the key their device kept (`voteKey` in the call options).

export const createPoll = (body: CreatePollRequest, o: CallOptions = {}) =>
  request<PollView>("/api/polls", { ...o, method: "POST", body });

export const listPolls = (o: CallOptions = {}) => request<PollList>("/api/polls", o);

export const updatePoll = (id: number, body: UpdatePollRequest, o: CallOptions = {}) =>
  request<PollView>(`/api/polls/${segment(id)}`, { ...o, method: "PATCH", body });

export const deletePoll = (id: number, o: CallOptions = {}) =>
  request<void>(`/api/polls/${segment(id)}`, { ...o, method: "DELETE" });

export const newPollShareLink = (id: number, o: CallOptions = {}) =>
  request<NewShareLink>(`/api/polls/${segment(id)}/share-link`, { ...o, method: "POST" });

export const removePollVote = (pollId: number, voteId: number, o: CallOptions = {}) =>
  request<PollView>(`/api/polls/${segment(pollId)}/votes/${segment(voteId)}`, { ...o, method: "DELETE" });

export const getPollByLink = (shareToken: string, o: CallOptions = {}) =>
  request<PollView>(`/api/poll-links/${segment(shareToken)}`, o);

export const castAccountVote = (shareToken: string, body: AccountVoteRequest, o: CallOptions = {}) =>
  request<PollView>(`/api/poll-links/${segment(shareToken)}/my-vote`, { ...o, method: "PUT", body });

export const withdrawAccountVote = (shareToken: string, o: CallOptions = {}) =>
  request<PollView>(`/api/poll-links/${segment(shareToken)}/my-vote`, { ...o, method: "DELETE" });

export const castGuestVote = (shareToken: string, body: GuestVoteRequest, o: CallOptions = {}) =>
  request<GuestVoteCreated>(`/api/poll-links/${segment(shareToken)}/votes`, { ...o, method: "POST", body });

export const changeGuestVote = (shareToken: string, voteId: number, body: GuestVoteRequest, o: CallOptions = {}) =>
  request<PollView>(`/api/poll-links/${segment(shareToken)}/votes/${segment(voteId)}`, { ...o, method: "PUT", body });

export const withdrawGuestVote = (shareToken: string, voteId: number, o: CallOptions = {}) =>
  request<PollView>(`/api/poll-links/${segment(shareToken)}/votes/${segment(voteId)}`, { ...o, method: "DELETE" });

// Fixing the date (phase 5a, `shared/src/polls.ts`). The check reads the participants' calendars like a search.

export const fixPoll = (id: number, body: FixPollRequest, o: CallOptions = {}) =>
  request<PollView>(`/api/polls/${segment(id)}/fixed`, { ...o, method: "PUT", body });

export const unfixPoll = (id: number, o: CallOptions = {}) =>
  request<PollView>(`/api/polls/${segment(id)}/fixed`, { ...o, method: "DELETE" });

export const checkFix = (id: number, body: FixPollRequest, o: CallOptions = {}) =>
  request<FixCheck>(`/api/polls/${segment(id)}/fix-check`, { timeoutMs: SEARCH_REQUEST_TIMEOUT_MS, ...o, method: "POST", body });

/**
 * The fixed date as a calendar file (text, not JSON). Fetched by the app instead of opened as a link, so that a
 * sleeping server shows a message in the app and not the browser's error page.
 */
export async function getEventIcs(shareToken: string, o: CallOptions = {}): Promise<ApiResult<string>> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch, baseUrl = API_URL } = o;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/poll-links/${segment(shareToken)}/event.ics`, {
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      return { ok: false, kind: "offline" };
    }
    if (response.ok) return { ok: true, data: text };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return parseErrorBody(response.status, parsed);
  } finally {
    clearTimeout(timer);
  }
}

// The personal calendar feed (`shared/src/polls.ts`): `token` is null while it is switched off.

export const getCalendarFeed = (o: CallOptions = {}) => request<CalendarFeed>("/api/me/calendar-feed", o);

/** Switches the feed on, or renews its token (the old link stops working). */
export const createCalendarFeed = (o: CallOptions = {}) =>
  request<CalendarFeed>("/api/me/calendar-feed", { ...o, method: "POST" });

export const deleteCalendarFeed = (o: CallOptions = {}) =>
  request<void>("/api/me/calendar-feed", { ...o, method: "DELETE" });

// Notifications (`shared/src/notifications.ts`). Not on servers older than phase 6: they answer 404.

export const getNotificationSettings = (o: CallOptions = {}) =>
  request<NotificationSettings>("/api/me/notification-settings", o);

/** Takes all settings at once and answers with what is stored. */
export const updateNotificationSettings = (body: NotificationSettings, o: CallOptions = {}) =>
  request<NotificationSettings>("/api/me/notification-settings", { ...o, method: "PUT", body });

export const getPushPublicKey = (o: CallOptions = {}) => request<PushPublicKey>("/api/push/public-key", o);

/** Switches this device on for push messages. */
export const subscribePush = (body: PushSubscriptionRequest, o: CallOptions = {}) =>
  request<void>("/api/push/subscriptions", { ...o, method: "POST", body });

/** Switches this device off (with the endpoint in a JSON body). */
export const unsubscribePush = (body: PushUnsubscribeRequest, o: CallOptions = {}) =>
  request<void>("/api/push/subscriptions", { ...o, method: "DELETE", body });

/** The creator reminds everyone who has not voted yet (`reminder_too_soon` within 24 hours). */
export const sendReminder = (pollId: number, o: CallOptions = {}) =>
  request<ReminderSent>(`/api/polls/${segment(pollId)}/reminders`, { ...o, method: "POST" });
