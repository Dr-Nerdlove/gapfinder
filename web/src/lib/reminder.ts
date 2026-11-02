// A reminder for "the server is awake again" as a calendar entry (.ics), made in the app: it works on every
// phone, needs no permission and no server. The poll link is the only thing put into it.

/** The server is off from 01:00 to 07:00 (local time of the home PC; the friends live in the same zone). */
export const WAKE_HOUR = 7;

/** True between 01:00 and 06:59 local time: when "the server sleeps" is the likely reason for no answer. */
export function isServerNight(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 1 && hour < WAKE_HOUR;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local date and time without a zone ("floating"), so the entry means 07:00 wherever the phone is. */
function floating(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

/** The next 07:00 after `now` (today if it is before 07:00, else tomorrow). */
export function nextWakeTime(now: Date): Date {
  const wake = new Date(now.getFullYear(), now.getMonth(), now.getDate(), WAKE_HOUR, 0, 0, 0);
  if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
  return wake;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines are folded at 75 bytes (RFC 5545); ASCII only here, the text is kept free of umlauts in folded parts. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** The calendar entry: 07:00 on the next morning, 15 minutes long, with the poll link in it. */
export function buildReminderIcs(pollLink: string, title: string, now: Date = new Date()): string {
  const start = nextWakeTime(now);
  const end = new Date(start.getTime() + 15 * 60_000);
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lueckenfueller//Reminder//DE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:reminder-${floating(start)}-${stamp}@lueckenfueller`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${floating(start)}`,
    `DTEND:${floating(end)}`,
    `SUMMARY:${escapeText(`Abstimmen: ${title}`)}`,
    `DESCRIPTION:${escapeText(`Jetzt ist der Server wieder wach. Hier abstimmen: ${pollLink}`)}`,
    `URL:${pollLink}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Abstimmen",
    "TRIGGER:PT0S",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Offers the text as a file download (the phone then offers to add it to the calendar). */
export function downloadIcs(content: string, fileName = "abstimmung-erinnerung.ics"): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
