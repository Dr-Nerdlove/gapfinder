// "Jetzt nachsehen", the test notification and the check when the app is opened (Android app only). Pure: the
// throttle and the texts. Do not import this from `sw.ts`.

/** The check on open runs at most this often. */
export const OPEN_CHECK_GAP_MS = 60_000;

/** Shown when the app shell is too old to have the method (the call rejects). */
export const NEEDS_NEWER_APP_TEXT = "Dafür braucht es eine neuere Version der App.";

export const BLOCKED_SETTINGS_TEXT = "Einstellungen → Apps → Lückenfüller → Benachrichtigungen";

let lastOpenCheck: number | null = null;

/**
 * True when a check on open may run now, and remembers the time then (in memory only: a new start of the app
 * checks again). A manual "Jetzt nachsehen" is never held back, but also counts (`force`).
 */
export function claimOpenCheck(now: number, force = false): boolean {
  if (!force && lastOpenCheck !== null && now - lastOpenCheck < OPEN_CHECK_GAP_MS) return false;
  lastOpenCheck = now;
  return true;
}

/** For the tests. */
export function resetOpenCheck(): void {
  lastOpenCheck = null;
}

/** The note under the buttons after the test notification. */
export function testNotificationNote(answer: { shown: boolean }): string {
  return answer.shown
    ? `Test-Benachrichtigung gesendet. Siehst du sie nicht, blockiert Android sie: ${BLOCKED_SETTINGS_TEXT}.`
    : `Android blockiert Benachrichtigungen für Lückenfüller. Erlaube sie unter ${BLOCKED_SETTINGS_TEXT}.`;
}
