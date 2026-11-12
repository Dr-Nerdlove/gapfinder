import { POLL_MAX_DAYS, SEARCH_MAX_DURATION_MINUTES, SEARCH_MAX_PERIOD_DAYS, type PollView } from "@lueckenfueller/shared";
import type { SearchSettings } from "./gap-search";

// "Nochmal planen": a poll's page hands its people, title and note to a new search. Like the search choice in
// `poll-draft.ts` it lives in memory only (a reload starts empty), and the old proposals are not copied.

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface Replan {
  title: string;
  note: string;
  /** The other people of the old poll (the person who plans again is not listed). */
  people: number[];
  kind: "hours" | "days";
  /** Hours poll: the length of its first proposal, rounded up to a full hour (the search offers full hours). */
  durationMinutes: number | null;
  /** Days poll: the length of its first proposal in days. */
  days: number | null;
  /** The old poll hid the votes (and still does): the new one starts with the same setting. */
  hidden: boolean;
}

/** What a poll gives to the next search. `selfId` is the person who plans again (the search never lists them). */
export function replanFromPoll(poll: PollView, selfId: number): Replan {
  const first = poll.proposals[0];
  const base = { title: poll.title, note: poll.note, people: poll.participants.map((p) => p.id).filter((id) => id !== selfId), hidden: poll.hidden === true };
  if (first && "first" in first) {
    const days = Math.round((Date.parse(`${first.last}T00:00:00Z`) - Date.parse(`${first.first}T00:00:00Z`)) / DAY_MS) + 1;
    return { ...base, kind: "days", durationMinutes: null, days: Math.min(Math.max(days, 1), Math.min(POLL_MAX_DAYS, SEARCH_MAX_PERIOD_DAYS)) };
  }
  if (first && "start" in first) {
    const minutes = Math.round((Date.parse(first.end) - Date.parse(first.start)) / MINUTE_MS);
    const hours = Math.min(Math.max(Math.ceil(minutes / 60), 1), SEARCH_MAX_DURATION_MINUTES / 60);
    return { ...base, kind: "hours", durationMinutes: hours * 60, days: null };
  }
  return { ...base, kind: poll.kind === "days" ? "days" : "hours", durationMinutes: null, days: null };
}

/** The search settings with the people (and length) of the old poll; everything else stays as the device had it. */
export function applyReplan(settings: SearchSettings, replan: Replan): SearchSettings {
  const next: SearchSettings = { ...settings, people: [...replan.people], kind: replan.kind };
  if (replan.durationMinutes !== null) next.durationMinutes = replan.durationMinutes;
  if (replan.days !== null) next.days = replan.days;
  return next;
}

let handedOver: Replan | null = null;

export const replanHandover = {
  set(replan: Replan): void {
    handedOver = replan;
  },
  /** Takes the handover: it is used once. */
  take(): Replan | null {
    const replan = handedOver;
    handedOver = null;
    return replan;
  },
};
