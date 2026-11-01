// Shared by the calendar tests: a fake feed server (no network), a calendar key and small ICS builders.
import type { FetchResult } from "../src/calendars/fetch.js";
import type { BuildAppOptions } from "../src/app.js";
import { Writable } from "node:stream";
import { createTestEnv, type TestEnv } from "./helpers.js";

export const CALENDAR_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 200 - i));

export const GOOGLE_LINK = "https://calendar.google.com/calendar/ical/secret-google-token-91/private-abc/basic.ics";
export const APPLE_LINK = "webcal://p12-caldav.icloud.com/published/2/secret-apple-token-77";
export const OUTLOOK_LINK = "https://outlook.office365.com/owa/calendar/secret-outlook-token-55/reachcalendar.ics";
export const OTHER_LINK = "https://kalender.example.org/secret-other-token-33.ics";

type Reply = FetchResult | (() => Promise<FetchResult>);

/** Stands in for the network: answers by link, remembers every fetch. */
export class FakeFeeds {
  readonly replies = new Map<string, Reply>();
  readonly calls: string[] = [];

  /** `link` as the server will ask for it (webcal:// is https://). */
  set(link: string, reply: Reply | string): this {
    this.replies.set(new URL(link.replace(/^webcal:\/\//i, "https://")).href, typeof reply === "string" ? { ok: true, text: reply } : reply);
    return this;
  }

  fail(link: string, reason: Extract<FetchResult, { ok: false }>["reason"]): this {
    return this.set(link, { ok: false, reason });
  }

  callsFor(link: string): number {
    const href = new URL(link.replace(/^webcal:\/\//i, "https://")).href;
    return this.calls.filter((call) => call === href).length;
  }

  readonly fetch = async (url: URL): Promise<FetchResult> => {
    this.calls.push(url.href);
    const reply = this.replies.get(url.href);
    if (reply === undefined) return { ok: false, reason: "unreachable" };
    return typeof reply === "function" ? reply() : reply;
  };
}

export interface CalendarEnv extends TestEnv {
  feeds: FakeFeeds;
}

export async function createCalendarEnv(
  overrides: Parameters<typeof createTestEnv>[0] = {},
  options: Omit<BuildAppOptions, "now" | "db" | "fetchCalendarText"> = {},
): Promise<CalendarEnv> {
  const feeds = new FakeFeeds();
  const env = await createTestEnv(
    { calendarKey: CALENDAR_KEY, calendarKeyProblem: null, ...overrides },
    { ...options, fetchCalendarText: feeds.fetch },
  );
  return { ...env, feeds };
}

export function captureLog(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

export interface FakeEvent {
  uid?: string;
  /** `2026-11-05T09:00:00Z` or, for an all-day event, `2026-11-06`. */
  start: string;
  end: string;
  summary: string;
  free?: boolean;
}

const stamp = (iso: string): string => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");

export function ics(events: FakeEvent[], name?: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN"];
  if (name !== undefined) lines.push(`X-WR-CALNAME:${name}`);
  events.forEach((event, index) => {
    const allDay = !event.start.includes("T");
    lines.push("BEGIN:VEVENT", `UID:${event.uid ?? `e${index}`}@test`, "DTSTAMP:20260101T000000Z");
    lines.push(
      allDay ? `DTSTART;VALUE=DATE:${stamp(event.start)}` : `DTSTART:${stamp(event.start)}`,
      allDay ? `DTEND;VALUE=DATE:${stamp(event.end)}` : `DTEND:${stamp(event.end)}`,
      `SUMMARY:${event.summary}`,
    );
    if (event.free) lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
