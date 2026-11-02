// Writes the fixed dates of polls as an iCalendar file (RFC 5545): one for a single poll (download) and one for
// a person's feed. Only the poll's own texts and the product name are written; the server writes no other
// prose (labels, links) because it does not know the language of the reader or the address of the app.
import { addDaysToDate, formatDateParts, parseDateParts } from "../time.js";

/** What the file says about one fixed poll. */
export interface FixedEvent {
  pollId: number;
  title: string;
  /** Empty when the poll has no note. */
  note: string;
  /** Timed: ISO instants (UTC). Days: German days "YYYY-MM-DD", both included. */
  when: { kind: "timed"; start: string; end: string } | { kind: "days"; first: string; last: string };
  /** ISO instant when the date was fixed; becomes DTSTAMP. */
  fixedAt: string;
  /** Grows with every change of the fixed date, so calendar apps see that the event changed. */
  sequence: number;
}

/** Lines are cut so that none is longer than this many bytes (without the line break). */
const MAX_LINE_OCTETS = 75;
const PRODUCT_NAME = "Lückenfüller";

/** TEXT value: backslash, semicolon and comma escaped, line breaks as `\n`, other control characters dropped. */
export function escapeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, "\\n");
}

/** One content line cut into lines of at most 75 bytes; the continuation lines start with a space. */
export function foldLine(line: string): string[] {
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    // A continuation line holds its leading space, so it has one byte less for content.
    const limit = lines.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (size + bytes > limit) {
      lines.push(lines.length === 0 ? current : ` ${current}`);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  lines.push(lines.length === 0 ? current : ` ${current}`);
  return lines;
}

/** "20261107T170000Z" */
function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "20261107" */
function dateValue(day: string): string {
  return day.replace(/-/g, "");
}

function eventLines(event: FixedEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:poll-${event.pollId}@lueckenfueller`,
    `DTSTAMP:${utcStamp(event.fixedAt)}`,
    `SEQUENCE:${event.sequence}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.note !== "") lines.push(`DESCRIPTION:${escapeText(event.note)}`);
  const { when } = event;
  if (when.kind === "timed") {
    lines.push(`DTSTART:${utcStamp(when.start)}`, `DTEND:${utcStamp(when.end)}`);
  } else {
    // The end of a whole-day event is the day after the last day.
    const last = parseDateParts(when.last)!;
    lines.push(
      `DTSTART;VALUE=DATE:${dateValue(when.first)}`,
      `DTEND;VALUE=DATE:${dateValue(formatDateParts(addDaysToDate(last, 1)))}`,
    );
  }
  lines.push("TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

/**
 * The calendar file for these events (none is fine). `feed`: adds the name and the refresh hints for apps that
 * subscribe to it.
 */
export function writeCalendar(events: readonly FixedEvent[], options: { feed: boolean }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lueckenfueller//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (options.feed) {
    lines.push(`X-WR-CALNAME:${escapeText(PRODUCT_NAME)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");
  }
  for (const event of events) lines.push(...eventLines(event));
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}
