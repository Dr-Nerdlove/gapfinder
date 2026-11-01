import type { Me, SessionResponse, UpdateMeRequest } from "@lueckenfueller/shared";
import * as api from "./api";
import type { ApiResult, CallOptions } from "./api";
import { API_URL } from "./config";
import { checkHealth } from "./health";
import { clearSession, defaultStorage, loadSession, saveSeed, saveSession } from "./session-storage";

export interface SessionState {
  token: string | null;
  user: Me | null;
  /** The last request got no answer: show the "sleeping" notice and keep forms disabled. */
  offline: boolean;
}

export interface SessionDeps {
  storage?: Storage | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Called with a fresh copy of the state after every change. */
  onChange?: (state: SessionState) => void;
  /** Called when the logged-in user changes (also with null on logout), e.g. to switch the colours. */
  onUser?: (user: Me | null) => void;
}

/**
 * Login state: token and last known user, kept in localStorage. Plain TypeScript so it can be tested;
 * `session.svelte.ts` connects it to the components.
 */
export function createSession(deps: SessionDeps = {}) {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const stored = loadSession(storage);
  const state: SessionState = { token: stored?.token ?? null, user: stored?.user ?? null, offline: false };

  const notify = (): void => deps.onChange?.({ ...state });

  function callOptions(auth: boolean): CallOptions {
    const options: CallOptions = {};
    if (auth && state.token) options.token = state.token;
    if (deps.fetchImpl) options.fetchImpl = deps.fetchImpl;
    if (deps.baseUrl !== undefined) options.baseUrl = deps.baseUrl;
    return options;
  }

  function setUser(user: Me | null): void {
    state.user = user;
    if (user && state.token) saveSession({ token: state.token, user }, storage);
    saveSeed(user?.seedColor ?? null, storage);
    deps.onUser?.(user);
  }

  /** Forgets the login on this device. */
  function clear(): void {
    state.token = null;
    clearSession(storage);
    setUser(null);
    notify();
  }

  function begin(response: SessionResponse): void {
    state.token = response.token;
    state.offline = false;
    setUser(response.user);
    notify();
  }

  /**
   * Runs one API call with the current token and keeps the state right: offline is noted, a rejected token
   * logs out (the login page shows up), anything else leaves the cached user alone.
   */
  async function run<T>(call: (options: CallOptions) => Promise<ApiResult<T>>, auth = true): Promise<ApiResult<T>> {
    const hadToken = auth && state.token !== null;
    const result = await call(callOptions(auth));
    const offline = !result.ok && result.kind === "offline";
    if (offline !== state.offline) {
      state.offline = offline;
      notify();
    }
    if (hadToken && api.isSessionExpired(result)) clear();
    return result;
  }

  async function begunBy(result: ApiResult<SessionResponse>): Promise<ApiResult<SessionResponse>> {
    if (result.ok) begin(result.data);
    return result;
  }

  return {
    get state(): SessionState {
      return { ...state };
    },

    /** Shows the cached user (the caller already can) and refreshes it from the server. */
    async start(): Promise<void> {
      // Colours and name of the cached user are applied right away.
      deps.onUser?.(state.user);
      notify();
      if (!state.token) return;
      const result = await run((o) => api.getMe(o));
      if (result.ok) setUser(result.data);
      notify();
    },

    run,
    clear,

    async login(username: string, password: string): Promise<ApiResult<SessionResponse>> {
      return begunBy(await run((o) => api.login({ username, password }, o), false));
    },

    async acceptInvite(token: string, username: string, password: string): Promise<ApiResult<SessionResponse>> {
      return begunBy(await run((o) => api.acceptInvite(token, { username, password }, o), false));
    },

    async completePasswordReset(token: string, password: string): Promise<ApiResult<SessionResponse>> {
      return begunBy(await run((o) => api.completePasswordReset(token, { password }, o), false));
    },

    async updateMe(changes: UpdateMeRequest): Promise<ApiResult<Me>> {
      const result = await run((o) => api.updateMe(changes, o));
      if (result.ok) {
        setUser(result.data);
        notify();
      }
      return result;
    },

    /** Ends the login on the server (if it is reachable) and always on this device. */
    async logout(): Promise<void> {
      if (state.token) await run((o) => api.logout(o));
      clear();
    },

    /** Asks the server whether it is back and updates the offline flag. */
    async checkConnection(): Promise<boolean> {
      const result = await checkHealth(deps.baseUrl ?? API_URL, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
      const offline = result.kind === "offline";
      if (offline !== state.offline) {
        state.offline = offline;
        notify();
      }
      return !offline;
    },
  };
}

export type SessionController = ReturnType<typeof createSession>;
