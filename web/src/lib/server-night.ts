/** The server is off from 01:00 to 07:00 (local time of the home PC; the friends live in the same zone). */
export const WAKE_HOUR = 7;

/** True between 01:00 and 06:59 local time: when "the server sleeps" is the likely reason for no answer. */
export function isServerNight(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 1 && hour < WAKE_HOUR;
}
