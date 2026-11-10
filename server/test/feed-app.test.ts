import { describe, expect, it } from "vitest";
import { classifyFeedApp } from "../src/calendars/feed-app.js";

describe("telling the calendar app from the user agent", () => {
  it.each([
    ["Google-Calendar-Importer", "google"],
    ["Mozilla/5.0 (compatible; Google-Calendar-Importer)", "google"],
    ["google-calendar-importer", "google"],
    ["iOS/17.5 (21F79) dataaccessd/1.0", "apple"],
    ["macOS/14.5 (23F79) CalendarAgent/988", "apple"],
    ["Mac OS X/10.8 (12A269) iCal/1.0", "apple"],
    ["Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17531; Pro)", "microsoft"],
    ["Mozilla/5.0 (compatible; Exchange Server)", "microsoft"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "other"],
    ["", "other"],
    [undefined, "other"],
  ] as const)("%s -> %s", (agent, app) => {
    expect(classifyFeedApp(agent)).toBe(app);
  });
});
