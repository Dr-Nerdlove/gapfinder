import type { FeedApp } from "@lueckenfueller/shared";

/**
 * Tells the kind of calendar app from the `User-Agent` of its request for the personal feed. Only the kind is
 * kept; the header itself is never stored or logged.
 */
export function classifyFeedApp(userAgent: string | undefined): FeedApp {
  if (userAgent === undefined) return "other";
  const agent = userAgent.toLowerCase();
  if (agent.includes("google-calendar-importer")) return "google";
  if (agent.includes("dataaccessd") || agent.includes("calendaragent") || userAgent.includes("iCal")) return "apple";
  if (agent.includes("microsoft") || agent.includes("outlook") || agent.includes("exchange")) return "microsoft";
  return "other";
}
