import type { PollView, ReminderSent } from "@lueckenfueller/shared";
import { fixedIdOf } from "./fix-date";
import { berlinToday, formatClock } from "./gap-search";
import { notVotedYet } from "./poll-view";

// The poll page's "Erinnerung senden" card: when it shows and what it says.

export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ReminderState =
  | { show: false }
  | {
      show: true;
      canSend: boolean;
      /** "Erinnerung gesendet heute um 14:05"; null when no reminder was sent yet. */
      sentText: string | null;
      /** While sending is blocked: "Die nächste geht ab morgen 14:05." */
      nextText: string | null;
    };

function dayWord(at: Date, now: Date): "heute" | "gestern" | "morgen" | null {
  const day = berlinToday(at);
  if (day === berlinToday(now)) return "heute";
  if (day === berlinToday(new Date(now.getTime() - REMINDER_INTERVAL_MS))) return "gestern";
  if (day === berlinToday(new Date(now.getTime() + REMINDER_INTERVAL_MS))) return "morgen";
  return null;
}

/** "2.11." of an instant, as the app writes dates. */
function shortDate(at: Date): string {
  const [, month, day] = berlinToday(at).split("-");
  return `${Number(day)}.${Number(month)}.`;
}

/** "heute um 14:05", "gestern um 14:05" or "am 2.11. um 14:05". */
function pastText(at: Date, now: Date): string {
  const word = dayWord(at, now);
  const clock = formatClock(at.toISOString());
  return word === "heute" || word === "gestern" ? `${word} um ${clock}` : `am ${shortDate(at)} um ${clock}`;
}

/** "heute 14:05", "morgen 14:05" or "3.11. 14:05". */
function futureText(at: Date, now: Date): string {
  const word = dayWord(at, now);
  return `${word ?? shortDate(at)} ${formatClock(at.toISOString())}`;
}

/** The reminder card is only for the creator of an open poll with someone still to vote. */
export function reminderState(poll: PollView, myUserId: number | null, now: Date): ReminderState {
  const creatorId = poll.creator?.id;
  if (myUserId === null || creatorId === undefined || creatorId !== myUserId) return { show: false };
  // An older server does not send the field at all: then it cannot send reminders either.
  if (poll.lastReminderAt === undefined) return { show: false };
  if (fixedIdOf(poll) !== null || !poll.open) return { show: false };
  if (!notVotedYet(poll).some((p) => p.id !== creatorId)) return { show: false };

  const last = poll.lastReminderAt === null ? null : new Date(poll.lastReminderAt);
  if (last === null || Number.isNaN(last.getTime())) return { show: true, canSend: true, sentText: null, nextText: null };

  const next = new Date(last.getTime() + REMINDER_INTERVAL_MS);
  if (next.getTime() > now.getTime()) {
    return {
      show: true,
      canSend: false,
      sentText: `Erinnerung gesendet ${pastText(last, now)}`,
      nextText: `Die nächste geht ab ${futureText(next, now)}.`,
    };
  }
  return { show: true, canSend: true, sentText: `Zuletzt erinnert ${pastText(last, now)}`, nextText: null };
}

/** What the creator reads after sending. */
export function reminderResultText(result: ReminderSent): string {
  if (result.recipients <= 0) {
    return "Niemand hat die Erinnerung bekommen: Wer noch nicht abgestimmt hat, hat Erinnerungen ausgeschaltet.";
  }
  return result.recipients === 1 ? "Erinnerung an 1 Person gesendet." : `Erinnerung an ${result.recipients} Personen gesendet.`;
}
