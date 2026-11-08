import { createSession, type SessionState } from "./session-core";
import { Lueckenfueller, isAndroidApp } from "./native";
import { browserSubscription, type ServiceWorkerNavigator } from "./push";
import type { Me } from "@lueckenfueller/shared";

/** Reactive login state for the components. */
export const sessionState = $state<SessionState>({ token: null, user: null, offline: false });

/** A short text the login page shows once, e.g. after the account was deleted. */
export const loginNotice = $state({ text: "" });

let onUserChange: ((user: Me | null) => void) | undefined;

export const session = createSession({
  onChange: (next) => Object.assign(sessionState, next),
  onUser: (user) => onUserChange?.(user),
  // Inside the Android app, logout stops the app's notifications too.
  appDevice: isAndroidApp() ? { disable: async () => (await Lueckenfueller.disableNotifications()).deviceKey } : undefined,
  // Logout switches this device's push messages off (nothing happens where there is no service worker).
  pushDevice: {
    endpoint: async () => (await browserSubscription(navigator as unknown as ServiceWorkerNavigator))?.endpoint ?? null,
    forget: async () => {
      await (await browserSubscription(navigator as unknown as ServiceWorkerNavigator))?.unsubscribe();
    },
  },
});

// The cached login is available immediately, before the first server answer.
Object.assign(sessionState, session.state);

/** Called once at startup: `onUser` switches the colours; then the cached user is refreshed from the server. */
export function startSession(onUser: (user: Me | null) => void): Promise<void> {
  onUserChange = onUser;
  return session.start();
}
