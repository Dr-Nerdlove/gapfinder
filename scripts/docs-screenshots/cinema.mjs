// Shared by fake-server.mts and seed.mjs: the evening of the cinema pictures (phase 10d) and the calendars that make it
// work. Plain JavaScript so that seed.mjs can import it without tsx.

/** The people of the cinema search ("du" is Vincent). Their calendars are free on the cinema day, except Tobi's. */
export const CINEMA_PEOPLE = ["Vincent", "Anna", "Tobi", "Emil", "Berta"];

/** The first Saturday at least 8 days ahead, as "YYYY-MM-DD" (UTC date, like the poll's Saturdays). */
export function cinemaDay(now = Date.now()) {
  for (let days = 8; ; days++) {
    const d = new Date(now + days * 86400000);
    if (d.getUTCDay() === 6) return d.toISOString().slice(0, 10);
  }
}

/** The instant of a Berlin wall clock ("YYYY-MM-DD", "HH:MM"). */
export function berlinInstant(day, clock) {
  const noon = new Date(`${day}T12:00:00Z`);
  const berlinNoon = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(noon));
  return new Date(Date.parse(`${day}T${clock}:00Z`) - (berlinNoon - 12) * 3600000);
}

/** Tobi is busy from 17:00 to 18:30 on the cinema day: the 17:30 showing does not fit because of him. */
export const TOBI_BUSY = { from: "17:00", to: "18:30" };
