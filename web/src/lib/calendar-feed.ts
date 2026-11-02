import type { CalendarFeed } from "@lueckenfueller/shared";
import type { ApiResult } from "./api";
import { errorMessage } from "./messages";

// The profile's "Lückenfüller-Kalender": what to show for the server's answer.

export type FeedScreen =
  | { phase: "loading" }
  | { phase: "off" }
  | { phase: "on"; token: string }
  /** The server is asleep and nothing is known yet. */
  | { phase: "waiting" }
  /** An older server without the feed (phase 5a): it answers 404 for the route. */
  | { phase: "unavailable" }
  | { phase: "failed"; message: string };

/** What the card shows after the server's answer to "how is the feed". */
export function feedScreenOf(result: ApiResult<CalendarFeed>): FeedScreen {
  if (result.ok) return typeof result.data?.token === "string" ? { phase: "on", token: result.data.token } : { phase: "off" };
  if (result.kind === "offline") return { phase: "waiting" };
  // The known 404 of a missing route has no JSON body, so it arrives as the generic "error".
  if (result.status === 404) return { phase: "unavailable" };
  return { phase: "failed", message: errorMessage(result) };
}

export const FEED_UNAVAILABLE_TEXT =
  "Diese Funktion ist auf dem Server noch nicht da. Der Server wird stündlich aktualisiert: komm später wieder.";
