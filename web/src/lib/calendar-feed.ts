import type { CalendarFeed, CalendarFeedFetch, FeedApp } from "@lueckenfueller/shared";
import type { ApiResult } from "./api";
import { formatDateTime } from "./format";
import { errorMessage } from "./messages";

// The profile's "Lückenfüller-Kalender": what to show for the server's answer.

export type FeedScreen =
  | { phase: "loading" }
  | { phase: "off" }
  /** `fetches` is undefined when the server is older and does not send them. */
  | { phase: "on"; token: string; fetches: CalendarFeedFetch[] | undefined }
  /** The server is asleep and nothing is known yet. */
  | { phase: "waiting" }
  /** An older server without the feed (phase 5a): it answers 404 for the route. */
  | { phase: "unavailable" }
  | { phase: "failed"; message: string };

/** What the card shows after the server's answer to "how is the feed". */
export function feedScreenOf(result: ApiResult<CalendarFeed>): FeedScreen {
  if (result.ok) return typeof result.data?.token === "string" ? { phase: "on", token: result.data.token, fetches: result.data.fetches } : { phase: "off" };
  if (result.kind === "offline") return { phase: "waiting" };
  // The known 404 of a missing route has no JSON body, so it arrives as the generic "error".
  if (result.status === 404) return { phase: "unavailable" };
  return { phase: "failed", message: errorMessage(result) };
}

export const FEED_UNAVAILABLE_TEXT =
  "Diese Funktion ist auf dem Server noch nicht da. Der Server wird stündlich aktualisiert: komm später wieder.";

const FEED_APP_NAMES: Record<FeedApp, string> = {
  google: "Google Kalender",
  apple: "Apple Kalender",
  microsoft: "Outlook",
  other: "Anderes Programm (z. B. Browser)",
};

export const FEED_NEVER_FETCHED_TEXT = "Noch von keiner Kalender-App abgerufen.";

/** The lines under "Zuletzt abgerufen", newest first as the server sends them; null when there is nothing to say (older server). */
export function feedFetchLines(fetches: CalendarFeedFetch[] | undefined): string[] | null {
  if (fetches === undefined) return null;
  return fetches.map((fetch) => `${FEED_APP_NAMES[fetch.app] ?? FEED_APP_NAMES.other}: ${formatDateTime(fetch.at)}`);
}
