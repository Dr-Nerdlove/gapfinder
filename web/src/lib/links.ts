import { API_URL } from "./config";

/** The part of `window.location` the links need. */
export interface LocationLike {
  origin: string;
  pathname: string;
}

function link(prefix: string, token: string, where: LocationLike): string {
  return `${where.origin}${where.pathname}#/${prefix}/${token}`;
}

/** Link a new user opens to create their account. */
export function buildInviteLink(token: string, where: LocationLike = window.location): string {
  return link("einladung", token, where);
}

/** Link a user opens to choose a new password. */
export function buildPasswordResetLink(token: string, where: LocationLike = window.location): string {
  return link("passwort", token, where);
}

/** Link everyone with it can open to see a poll and vote (guests too). */
export function buildPollLink(shareToken: string, where: LocationLike = window.location): string {
  return link("abstimmung", shareToken, where);
}

/** Link for subscribing to a person's calendar feed in a calendar app (the API, not a page of the app). */
export function buildFeedLink(token: string, apiUrl: string = API_URL): string {
  return `${apiUrl.replace(/\/+$/, "")}/api/calendar-feeds/${encodeURIComponent(token)}.ics`;
}
