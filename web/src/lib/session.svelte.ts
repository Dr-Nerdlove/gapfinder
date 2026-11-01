import { createSession, type SessionState } from "./session-core";
import type { Me } from "@lueckenfueller/shared";

/** Reactive login state for the components. */
export const sessionState = $state<SessionState>({ token: null, user: null, offline: false });

let onUserChange: ((user: Me | null) => void) | undefined;

export const session = createSession({
  onChange: (next) => Object.assign(sessionState, next),
  onUser: (user) => onUserChange?.(user),
});

// The cached login is available immediately, before the first server answer.
Object.assign(sessionState, session.state);

/** Called once at startup: `onUser` switches the colours; then the cached user is refreshed from the server. */
export function startSession(onUser: (user: Me | null) => void): Promise<void> {
  onUserChange = onUser;
  return session.start();
}
