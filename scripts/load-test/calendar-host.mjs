// A stand-in for Google, iCloud and Outlook in the load test (see README.md in this folder): a plain local HTTP
// server that answers `/<person>/<calendar>.ics` with a made-up but realistically large calendar, after a delay
// like a real calendar service. It runs as its own process, so its memory does not count against the API server.
//   node calendar-host.mjs <port> <profile>     profile: realistic | heavy
import http from "node:http";

const port = Number(process.argv[2] ?? 8090);
const profile = process.argv[3] ?? "realistic";
if (!["realistic", "heavy"].includes(profile)) throw new Error(`unknown profile ${profile}`);

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");
const local = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
};
const dateOnly = (ms) => local(ms).slice(0, 8);

function random(seedText) {
  let seed = 7;
  for (const c of seedText) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
}

// What a Google feed carries per event besides the times: description, location, attendees. About 0.7–1 KB.
const filler = (rnd, n) => {
  const words = ["Treffen", "Besprechung", "Abendessen", "Training", "Kino", "Arzt", "Projekt", "Telefonat", "Geburtstag", "Konzert"];
  return Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(" ");
};
function vevent(lines, rnd, uid, startMs, endMs, extra = []) {
  lines.push(
    "BEGIN:VEVENT",
    `DTSTART;TZID=Europe/Berlin:${local(startMs)}`,
    `DTEND;TZID=Europe/Berlin:${local(endMs)}`,
    ...extra,
    "DTSTAMP:20261101T120000Z",
    `UID:${uid}@loadtest.example`,
    "CREATED:20240101T100000Z",
    `DESCRIPTION:${filler(rnd, 25)}\\n${filler(rnd, 15)}`,
    "LAST-MODIFIED:20260901T100000Z",
    `LOCATION:${filler(rnd, 4)}\\, 10115 Berlin\\, Deutschland`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    `SUMMARY:${filler(rnd, 3)}`,
    "TRANSP:OPAQUE",
    "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Person Eins;X-NUM-GUESTS=0:mailto:eins@loadtest.example",
    "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Person Zwei;X-NUM-GUESTS=0:mailto:zwei@loadtest.example",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:This is an event reminder",
    "TRIGGER:-P0DT0H30M0S",
    "END:VALARM",
    "END:VEVENT",
  );
}

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Berlin", "X-LIC-LOCATION:Europe/Berlin",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE",
];

/**
 * kind "main": a private calendar with years of history (like a Google feed, which always sends everything) and a
 * few weekly series; "work": weekly and daily series with exceptions plus single meetings; "birthdays": yearly
 * series. `targetBytes` decides how many single events the history gets.
 */
function calendar(person, kind, targetBytes) {
  const rnd = random(`${person}/${kind}`);
  const lines = ["BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${person} ${kind}`, "X-WR-TIMEZONE:Europe/Berlin", ...VTIMEZONE];
  const today = Math.floor(Date.now() / DAY) * DAY;
  if (kind === "birthdays") {
    for (let i = 0; i < 60; i++) {
      const day = today + Math.floor(rnd() * 365) * DAY - 5 * 365 * DAY;
      lines.push("BEGIN:VEVENT", `DTSTART;VALUE=DATE:${dateOnly(day)}`, `DTEND;VALUE=DATE:${dateOnly(day + DAY)}`,
        "RRULE:FREQ=YEARLY", `UID:${person}-bday-${i}@loadtest.example`, "DTSTAMP:20261101T120000Z",
        `SUMMARY:Geburtstag ${filler(rnd, 1)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
    }
  } else {
    // Series: started up to three years ago, some still running, some with exceptions (EXDATE) and moved dates.
    const series = kind === "work" ? 25 : 6;
    for (let i = 0; i < series; i++) {
      const startDay = today - Math.floor(rnd() * 3 * 365) * DAY;
      const start = startDay + (8 + Math.floor(rnd() * 10)) * 3_600_000;
      const daily = kind === "work" && i < 3;
      const rule = daily ? "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR" : `RRULE:FREQ=WEEKLY;INTERVAL=${1 + Math.floor(rnd() * 2)}`;
      const exdates = Array.from({ length: 5 }, (_, k) => `EXDATE;TZID=Europe/Berlin:${local(start + (7 * (k + 1) * 3) * DAY)}`);
      vevent(lines, rnd, `${person}-${kind}-series-${i}`, start, start + 3_600_000, [rule, ...exdates]);
      // One moved occurrence (RECURRENCE-ID), as calendars have when a single meeting is shifted.
      const moved = start + 7 * 10 * DAY;
      vevent(lines, rnd, `${person}-${kind}-series-${i}`, moved + 3_600_000, moved + 7_200_000, [`RECURRENCE-ID;TZID=Europe/Berlin:${local(moved)}`]);
    }
    // Single events: from years back to a year ahead, until the calendar has its size.
    const size = () => lines.reduce((sum, line) => sum + line.length + 2, 0);
    let bytes = size();
    for (let i = 0; bytes < targetBytes; i++) {
      const day = today + Math.floor((rnd() * 1.2 - 1) * 8 * 365) * DAY;
      const start = day + (7 + Math.floor(rnd() * 14)) * 3_600_000 + (rnd() < 0.5 ? 1_800_000 : 0);
      const before = lines.length;
      vevent(lines, rnd, `${person}-${kind}-${i}`, start, start + (1 + Math.floor(rnd() * 3)) * 3_600_000);
      for (let k = before; k < lines.length; k++) bytes += lines[k].length + 2;
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Sizes of the profile, the same for every run: realistic 0.2–4 MB per private calendar, heavy 9.5 MB each. */
function targetBytes(person, kind) {
  if (profile === "heavy") return 9.5 * 1024 * 1024;
  const rnd = random(`size/${person}/${kind}`);
  const r = rnd();
  if (kind === "work") return (0.3 + r * 1.2) * 1024 * 1024;
  // Most people have a few hundred KB to 2 MB, one in five a long history of 3–4 MB.
  return (r < 0.8 ? 0.2 + r * 2.2 : 3 + (r - 0.8) * 5) * 1024 * 1024;
}

const cache = new Map();
let served = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/sizes") {
    const sizes = [...cache.values()].map((text) => text.length).sort((a, b) => a - b);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count: sizes.length, totalMB: sizes.reduce((a, b) => a + b, 0) / 1024 / 1024, largestMB: (sizes.at(-1) ?? 0) / 1024 / 1024 }));
    return;
  }
  const match = /^\/([^/]+)\/(main|work|birthdays)\.ics$/.exec(req.url ?? "");
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  const key = `${match[1]}/${match[2]}`;
  let text = cache.get(key);
  if (text === undefined) {
    text = calendar(decodeURIComponent(match[1]), match[2], targetBytes(match[1], match[2]));
    cache.set(key, text);
  }
  // A real service takes a while to answer a big feed: 0.3–1.5 s before the first byte.
  const delay = 300 + Math.floor(random(`delay/${key}/${served}`)() * 1200);
  served++;
  setTimeout(() => {
    res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "content-length": Buffer.byteLength(text) });
    res.end(text);
  }, delay);
});
server.listen(port, "127.0.0.1", () => console.log(`calendar host on ${port} (${profile})`));
