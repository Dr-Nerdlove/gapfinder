import type { Calendar, CalendarProvider } from "@lueckenfueller/shared";
import { CALENDARS_PER_USER } from "@lueckenfueller/shared";

/** How the app calls each provider (a Record, so a new provider in `shared` needs a label here). */
export const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  google: "Google",
  apple: "Apple iCloud",
  outlook: "Outlook",
  other: "Anderer Anbieter",
};

export function providerLabel(provider: CalendarProvider): string {
  return PROVIDER_LABELS[provider] ?? PROVIDER_LABELS.other;
}

/** How many of the calendars have a link that no longer works. */
export function brokenCount(calendars: readonly Pick<Calendar, "status">[]): number {
  return calendars.filter((calendar) => calendar.status === "broken").length;
}

/** False once the person has the most calendars allowed. */
export function canAddCalendar(count: number): boolean {
  return count < CALENDARS_PER_USER;
}

/**
 * What the admin sees for a person: only a count, never more. Empty when there is no problem or the server
 * is older than the calendar feature and does not send the number.
 */
export function calendarProblemsText(count: number | undefined): string {
  if (count === undefined || !Number.isFinite(count) || count < 1) return "";
  return `${count} Kalender mit Problem`;
}

/** The calendar after a change; the default flag moves when another calendar became the default. */
export function applyCalendarUpdate(calendars: readonly Calendar[], updated: Calendar): Calendar[] {
  const known = calendars.some((calendar) => calendar.id === updated.id);
  const next = known ? calendars.map((calendar) => (calendar.id === updated.id ? updated : calendar)) : [...calendars, updated];
  return updated.isDefault ? next.map((calendar) => (calendar.id === updated.id ? calendar : { ...calendar, isDefault: false })) : next;
}

/** A first check before asking the server: the link must start with https:// or webcal:// (any case). */
export function looksLikeCalendarLink(link: string): boolean {
  return /^(https|webcal):\/\/\S+$/i.test(link.trim());
}
