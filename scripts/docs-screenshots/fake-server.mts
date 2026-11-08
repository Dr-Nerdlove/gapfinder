// A throw-away API server for taking documentation screenshots (see README.md in this folder).
// It is the real server, with one difference: calendar links are not fetched from the internet. Every link of the
// form https://cal.example/<name>.ics answers with a made-up calendar for <name> (always the same for the same day).
// Never use it for anything but screenshots: it is never built into the image and never reads real calendars.
import { existsSync } from "node:fs";
import { buildApp } from "../../server/src/app.ts";
import { loadConfig } from "../../server/src/config.ts";

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

function calendarFor(name: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//screenshots//EN", `X-WR-CALNAME:${name}`];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  let seed = hash(name);
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  const event = (uid: string, from: Date, to: Date): void => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@screenshots`, "DTSTAMP:20261101T000000Z", `DTSTART:${icsTime(from)}`, `DTEND:${icsTime(to)}`, "SUMMARY:Termin", "END:VEVENT");
  };
  for (let day = 0; day < 120; day++) {
    const d = new Date(start.getTime() + day * 86400000);
    const weekday = d.getUTCDay(); // 0 Sunday, 6 Saturday
    const weekend = weekday === 0 || weekday === 6;
    const roll = rnd();
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

const config = loadConfig();
const app = await buildApp(config, {
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
