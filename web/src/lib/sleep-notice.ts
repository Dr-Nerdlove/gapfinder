import type { HealthResult } from "./health";

// Decisions so that "the server sleeps from 1 to 7" is said only once per page: `OfflineNotice` (shown whenever the
// session noticed the server is away) already says it, so other places must not repeat it. Pure.

/**
 * Whether the start page shows its own "Lückenfüller schläft gerade" card. Only when the health check failed, and not
 * when `OfflineNotice` is visible on the same page (`noticeVisible`: the session is offline and the notice is on the page).
 */
export function showSleepCard(status: HealthResult | { kind: "loading" }, noticeVisible: boolean): boolean {
  return status.kind === "offline" && !noticeVisible;
}

/**
 * The text of the "poll cannot be loaded" card. `noticeVisible`: `OfflineNotice` above already explains that the server
 * sleeps from 1 to 7, so the card only says what the page does about it.
 */
export function pollWaitingText(night: boolean, noticeVisible: boolean): string {
  if (noticeVisible) {
    return night
      ? "Ab 7 Uhr kannst du abstimmen – dann ist alles wieder da. Lass diese Seite offen, sie versucht es von selbst noch einmal."
      : "Diese Seite versucht es alle 30 Sekunden von selbst noch einmal.";
  }
  return night
    ? "Lückenfüller schläft nachts von 1 bis 7 Uhr. Ab 7 Uhr kannst du abstimmen – dann ist alles wieder da. Lass diese Seite offen, sie versucht es von selbst noch einmal."
    : "Der Server antwortet gerade nicht (nachts von 1 bis 7 Uhr schläft er). Diese Seite versucht es alle 30 Sekunden von selbst noch einmal.";
}
