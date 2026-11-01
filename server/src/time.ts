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
