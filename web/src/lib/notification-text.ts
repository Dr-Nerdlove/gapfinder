import type { NotificationItem, Proposal } from "@lueckenfueller/shared";
import { proposalLabel } from "./poll-view";

// The German texts of push messages. The service worker imports this file: only pure functions, nothing
// that touches the page (no window, document or localStorage) and no Svelte.

export interface NotificationText {
  title: string;
  body: string;
  /** Opens the poll; null when the message does not carry one. */
  shareToken: string | null;
  /** Messages with the same tag replace each other (several votes in one poll show up once). */
  tag: string;
}

const APP_NAME = "Lückenfüller";
const FALLBACK_TAG = "lueckenfueller";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const textOf = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Makes the text of a notification from its data. Never throws: unknown or broken data gives a general text. */
export function notificationText(data: unknown): NotificationText {
  const record = isRecord(data) ? data : {};
  const shareToken = textOf(record["shareToken"]);
  const pollTitle = textOf(record["pollTitle"]);
  const actor = textOf(record["actorName"]);
  const kind = typeof record["kind"] === "string" ? record["kind"] : null;
  const tag = shareToken !== null && kind !== null ? `${shareToken}:${kind}` : shareToken ?? FALLBACK_TAG;

  // The one kind that belongs to no poll: it has no title and no token.
  if (kind === "account_deleted" && actor !== null) {
    return { title: "Konto gelöscht", body: `${actor} hat das eigene Konto gelöscht.`, shareToken: null, tag: `account_deleted:${actor}` };
  }

  if (pollTitle !== null && actor !== null) {
    switch (kind) {
      case "poll_created":
        return { title: `Neue Abstimmung: ${pollTitle}`, body: `${actor} fragt, wann du Zeit hast. Stimm jetzt ab.`, shareToken, tag };
      case "vote":
        return { title: pollTitle, body: `${actor} hat abgestimmt.`, shareToken, tag };
      case "all_voted":
        return { title: `Alle haben abgestimmt: ${pollTitle}`, body: `Zuletzt hat ${actor} abgestimmt.`, shareToken, tag };
      case "reminder":
        return { title: `Erinnerung: ${pollTitle}`, body: `${actor} bittet dich, abzustimmen.`, shareToken, tag };
      case "date_fixed": {
        const label = proposalText(record["proposal"]);
        if (label !== null) {
          return { title: `Termin steht: ${pollTitle}`, body: `${actor} hat den Termin festgelegt: ${label}.`, shareToken, tag };
        }
        break;
      }
    }
  }
  return {
    title: APP_NAME,
    body: pollTitle !== null ? `Es gibt Neuigkeiten zu „${pollTitle}“.` : "Es gibt Neuigkeiten.",
    shareToken,
    tag,
  };
}

function proposalText(proposal: unknown): string | null {
  if (!isRecord(proposal)) return null;
  try {
    const label = proposalLabel(proposal as unknown as Proposal);
    return label.includes("undefined") || label.includes("NaN") ? null : label;
  } catch {
    return null;
  }
}

/** The address a tap on the message opens: the poll, or the start page without a token. `scope` ends with "/". */
export function notificationTarget(shareToken: string | null, scope: string): string {
  return shareToken ? `${scope}#/abstimmung/${encodeURIComponent(shareToken)}` : scope;
}

/** The first open window of the app (its address starts with the scope), or null. */
export function pickWindow<T extends { url: string }>(clients: readonly T[], scope: string): T | null {
  return clients.find((client) => client.url.startsWith(scope)) ?? null;
}

/** The payload of a push message: a JSON `NotificationItem`. Null when it is empty or not understood. */
export function parsePushPayload(text: string | null): NotificationItem | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !isRecord(parsed["data"])) return null;
    return {
      id: typeof parsed["id"] === "number" ? parsed["id"] : 0,
      createdAt: typeof parsed["createdAt"] === "string" ? parsed["createdAt"] : "",
      data: parsed["data"] as unknown as NotificationItem["data"],
    };
  } catch {
    return null;
  }
}
