import type {
  AcceptInviteRequest,
  AdminInvite,
  AdminRenameUserRequest,
  AdminUser,
  AddCalendarRequest,
  ApiErrorBody,
  Calendar,
  CalendarList,
  CalendarPreview,
  ChangePasswordRequest,
  CompletePasswordResetRequest,
  CreateInviteRequest,
  CreatedInvite,
  CreatedPasswordReset,
  ErrorCode,
  InviteInfo,
  LoginRequest,
  Me,
  PasswordResetInfo,
  SessionResponse,
  UpdateCalendarRequest,
  UpdateMeRequest,
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
}

export interface RequestOptions extends CallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
  const { method = "GET", body, token, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch, baseUrl = API_URL } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
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

export const listInvites = (o: CallOptions = {}) => request<AdminInvite[]>("/api/admin/invites", o);

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
