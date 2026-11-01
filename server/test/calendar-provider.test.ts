import { describe, expect, it } from "vitest";
import { normalizeCalendarUrl } from "../src/calendars/fetch.js";
import { providerOfLink } from "../src/calendars/provider.js";

describe("providerOfLink", () => {
  it.each([
    ["https://calendar.google.com/calendar/ical/x/basic.ics", "google"],
    ["https://www.google.com/calendar/ical/x/basic.ics", "google"],
    ["https://CALENDAR.GOOGLE.COM/x.ics", "google"],
    ["webcal://p01-caldav.icloud.com/published/2/abc", "apple"],
    ["https://www.icloud.com/x", "apple"],
    ["https://outlook.live.com/owa/calendar/x/reachcalendar.ics", "outlook"],
    ["https://outlook.office365.com/owa/calendar/x/reachcalendar.ics", "outlook"],
    ["https://outlook.office.com/owa/calendar/x/reachcalendar.ics", "outlook"],
    ["https://something.outlook.com/x.ics", "outlook"],
    ["https://outlook.com/x.ics", "outlook"],
    ["https://kalender.example.org/x.ics", "other"],
    // Look-alikes are not the provider.
    ["https://evil-google.com/x.ics", "other"],
    ["https://google.com.evil.example/x.ics", "other"],
    ["https://notoutlook.com/x.ics", "other"],
    ["https://icloud.com.example.net/x.ics", "other"],
    ["https://example.com/google.com/x.ics", "other"],
  ])("%s → %s", (link, provider) => {
    expect(providerOfLink(normalizeCalendarUrl(link)!)).toBe(provider);
  });
});
