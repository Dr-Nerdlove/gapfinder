const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export const ONE_HOUR_MS = HOUR_MS;

const BERLIN = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

function berlinFields(utcMs: number): { year: number; month: number; day: number; wallMs: number } {
  const f: Record<string, number> = {};
  for (const part of BERLIN.formatToParts(utcMs)) f[part.type] = Number(part.value);
  const wallMs = Date.UTC(f.year!, f.month! - 1, f.day!, (f.hour ?? 0) % 24, f.minute, f.second);
  return { year: f.year!, month: f.month!, day: f.day!, wallMs };
}

/**
 * 00:00 German time (Europe/Berlin) of the day `plusDays` after the German calendar day of `date`. Follows the
 * daylight saving changes: the day of the change is 23 or 25 hours long. German clocks never change at midnight,
 * so the wall time exists exactly once.
 */
export function berlinMidnight(date: Date, plusDays = 0): Date {
  const { year, month, day } = berlinFields(date.getTime());
  const wall = Date.UTC(year, month - 1, day + plusDays, 0, 0, 0);
  for (const offsetHours of [1, 2]) {
    const utc = wall - offsetHours * HOUR_MS;
    if (berlinFields(utc).wallMs === wall) {
      return new Date(utc);
    }
  }
  return new Date(wall - HOUR_MS);
}

/**
 * The instant when German clocks show the given wall time: `minutesOfDay` after 00:00 of the German day
 * `year`-`month`-`day` (1-based month). Day and minutes may overflow (1440 is the next day's 00:00); the wall
 * time is normalised like `Date.UTC` does it. A wall time that does not exist (02:00–02:59 on the day the
 * clocks go forward) is the instant at UTC+1, where the clocks show 03:xx. One that exists twice (02:00–02:59
 * when they go back) is the earlier of the two, at UTC+2.
 */
export function berlinWallToUtc(year: number, month: number, day: number, minutesOfDay: number): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minutesOfDay, 0);
  for (const offsetHours of [2, 1]) {
    const utc = wall - offsetHours * HOUR_MS;
    if (berlinFields(utc).wallMs === wall) return new Date(utc);
  }
  return new Date(wall - HOUR_MS);
}

/** A calendar day without a time zone; `month` is 1-based. All arithmetic on it is done on the wall date. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" as a real date, or null (also for 2026-02-30). */
export function parseDateParts(text: string): DateParts | null {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

export function formatDateParts(parts: DateParts): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** Days since 1970-01-01 of the wall date: consecutive days differ by exactly 1, whatever the clocks do. */
export function dayNumber(parts: DateParts): number {
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

export function datePartsOfDayNumber(days: number): DateParts {
  const date = new Date(days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The wall date `days` later (or earlier when negative). */
export function addDaysToDate(parts: DateParts, days: number): DateParts {
  return datePartsOfDayNumber(dayNumber(parts) + days);
}

/** ISO weekday of the wall date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(parts: DateParts): number {
  const sunday0 = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/** The German calendar day at this instant. */
export function berlinDateOf(date: Date): DateParts {
  const { year, month, day } = berlinFields(date.getTime());
  return { year, month, day };
}
