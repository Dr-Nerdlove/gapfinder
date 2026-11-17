// A throw-away API server for taking documentation screenshots (see README.md in this folder).
// It is the real server, with one difference: calendar links are not fetched from the internet. Every link of the
// form https://cal.example/<name>.ics answers with a made-up calendar for <name> (always the same for the same day).
// Never use it for anything but screenshots: it is never built into the image and never reads real calendars.
import { existsSync } from "node:fs";
import { buildApp } from "../../server/src/app.ts";
import { loadConfig } from "../../server/src/config.ts";
import { CINEMA_PEOPLE, FILM_CINEMAS, TOBI_BUSY, berlinInstant, cineamoAnswer, cinemaDay } from "./cinema.mjs";

const dir = process.env.SHOTS_DIR;
if (!dir) throw new Error("SHOTS_DIR is not set (run.sh sets it)");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function icsTime(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
function hash(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Sophie is busy on Saturday evenings of even weeks and free on those of odd weeks (the poll picture relies on it). */
export function sophieBusy(day: Date): boolean {
  return Math.floor(day.getTime() / 86400000 / 7) % 2 === 0;
}

const filmRound = existsSync(`${dir}/cinemas-on`);

function calendarFor(name: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//screenshots//EN", `X-WR-CALNAME:${name}`];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  let seed = hash(name);
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  // On the cinema day (phase 10d) the circle of the cinema pictures has no random events (the random numbers are still
  // drawn, so every other day stays as it was), and Tobi has one fixed appointment.
  const day10d = cinemaDay();
  const thursday = new Date(Date.parse(`${day10d}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
  let quiet = false;
  const event = (uid: string, from: Date, to: Date): void => {
    if (quiet) return;
    lines.push("BEGIN:VEVENT", `UID:${uid}@screenshots`, "DTSTAMP:20261101T000000Z", `DTSTART:${icsTime(from)}`, `DTEND:${icsTime(to)}`, "SUMMARY:Termin", "END:VEVENT");
  };
  for (let day = 0; day < 120; day++) {
    const d = new Date(start.getTime() + day * 86400000);
    const weekday = d.getUTCDay(); // 0 Sunday, 6 Saturday
    const weekend = weekday === 0 || weekday === 6;
    const roll = rnd();
    const dayText = d.toISOString().slice(0, 10);
    // Round two (the film choice) has only two days with a free evening for the circle: the cinema day and the Thursday
    // before it (Tobi is busy all day on every other day), like the mock-up's "Do 19., Sa 21.".
    quiet = CINEMA_PEOPLE.includes(name) && (dayText === day10d || (filmRound && dayText === thursday));
    if (filmRound && name === "Tobi" && !quiet) event(`${name}-film-${day}`, d, new Date(d.getTime() + 24 * 3600000 - 60000));
    if (quiet && name === "Tobi") {
      lines.push("BEGIN:VEVENT", "UID:Tobi-cinema@screenshots", "DTSTAMP:20261101T000000Z", `DTSTART:${icsTime(berlinInstant(day10d, TOBI_BUSY.from))}`, `DTEND:${icsTime(berlinInstant(day10d, TOBI_BUSY.to))}`, "SUMMARY:Termin", "END:VEVENT");
    }
    if (name === "Sophie" && weekday === 6) {
      if (sophieBusy(d)) event(`${name}-${day}`, new Date(d.getTime() + 16 * 3600000), new Date(d.getTime() + 22 * 3600000));
      continue;
    }
    if (roll < (weekend ? 0.22 : 0.3)) {
      const hour = weekend ? 15 + Math.floor(rnd() * 5) : 7 + Math.floor(rnd() * 9);
      const from = new Date(d.getTime() + hour * 3600000);
      event(`${name}-${day}`, from, new Date(from.getTime() + (1 + Math.floor(rnd() * 4)) * 3600000));
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// The film choice pictures (run.sh creates this marker for its second round) need configured cinemas; the others do not.
if (existsSync(`${dir}/cinemas-on`)) process.env.CINEMAS = FILM_CINEMAS;
const config = loadConfig();
const app = await buildApp(config, {
  // A made-up cineamo: the server never reaches api.cineamo.com here.
  fetchCinemaText: async (url) => {
    const text = cineamoAnswer(url);
    return text === null ? { ok: false, reason: "unreachable" } : { ok: true, text };
  },
  fetchCalendarText: async (url) => {
    const match = /\/([^/]+)\.ics$/.exec(url.pathname);
    if (!match) return { ok: false, reason: "invalid_link" };
    const name = decodeURIComponent(match[1]!);
    // `touch $SHOTS_DIR/broken-Max` and restart: that person's calendar can no longer be read.
    if (existsSync(`${dir}/broken-${name}`)) return { ok: false, reason: "unreachable" };
    return { ok: true, text: calendarFor(name) };
  },
});
await app.listen({ port: config.port, host: config.host });
console.log("fake server listening");
