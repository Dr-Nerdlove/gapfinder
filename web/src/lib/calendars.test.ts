import type { Calendar } from "@lueckenfueller/shared";
import { CALENDARS_PER_USER } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { applyCalendarUpdate, brokenCount, calendarDisplayName, calendarProblemsText, canAddCalendar, looksLikeCalendarLink, PROVIDER_LABELS, providerLabel } from "./calendars";

const calendar = (id: number, extra: Partial<Calendar> = {}): Calendar => ({
  id,
  name: `Kalender ${id}`,
  provider: "google",
  countsAsBusy: true,
  isDefault: false,
  status: "ok",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...extra,
});

describe("providerLabel", () => {
  it("names each provider in German", () => {
    expect(providerLabel("google")).toBe("Google");
    expect(providerLabel("apple")).toBe("Apple iCloud");
    expect(providerLabel("outlook")).toBe("Outlook");
    expect(providerLabel("other")).toBe("Anderer Anbieter");
  });

  it("has a label for every provider and falls back for a new one", () => {
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(["apple", "google", "other", "outlook"]);
    expect(providerLabel("fax" as never)).toBe("Anderer Anbieter");
  });
});

describe("calendarDisplayName", () => {
  it("shows the calendar's own name", () => {
    expect(calendarDisplayName(calendar(1, { name: "Familie" }))).toBe("Familie");
  });

  it("shows the provider when the name is empty or only spaces", () => {
    expect(calendarDisplayName(calendar(1, { name: "", provider: "google" }))).toBe("Google");
    expect(calendarDisplayName(calendar(1, { name: "  ", provider: "apple" }))).toBe("Apple iCloud");
    expect(calendarDisplayName(calendar(1, { name: "", provider: "outlook" }))).toBe("Outlook");
    expect(calendarDisplayName(calendar(1, { name: "", provider: "other" }))).toBe("Anderer Anbieter");
  });

  it("falls back to a general word when there is neither a name nor a provider", () => {
    expect(calendarDisplayName({ name: "" })).toBe("Ein Kalender");
  });
});

describe("brokenCount", () => {
  it("counts the broken calendars", () => {
    expect(brokenCount([])).toBe(0);
    expect(brokenCount([calendar(1), calendar(2, { status: "broken" }), calendar(3, { status: "broken" })])).toBe(2);
  });
});

describe("canAddCalendar", () => {
  it("allows calendars up to the limit", () => {
    expect(canAddCalendar(0)).toBe(true);
    expect(canAddCalendar(CALENDARS_PER_USER - 1)).toBe(true);
    expect(canAddCalendar(CALENDARS_PER_USER)).toBe(false);
    expect(canAddCalendar(CALENDARS_PER_USER + 1)).toBe(false);
  });
});

describe("calendarProblemsText", () => {
  it("shows only the number of calendars with a problem", () => {
    expect(calendarProblemsText(1)).toBe("1 Kalender mit Problem");
    expect(calendarProblemsText(2)).toBe("2 Kalender mit Problem");
  });

  it("shows nothing for zero, a missing number (older server) or nonsense", () => {
    expect(calendarProblemsText(0)).toBe("");
    expect(calendarProblemsText(undefined)).toBe("");
    expect(calendarProblemsText(Number.NaN)).toBe("");
    expect(calendarProblemsText(-1)).toBe("");
  });
});

describe("applyCalendarUpdate", () => {
  it("replaces the calendar with the same id", () => {
    const next = applyCalendarUpdate([calendar(1), calendar(2)], calendar(2, { name: "Neu" }));
    expect(next.map((c) => c.name)).toEqual(["Kalender 1", "Neu"]);
  });

  it("appends a new calendar", () => {
    expect(applyCalendarUpdate([calendar(1)], calendar(2)).map((c) => c.id)).toEqual([1, 2]);
  });

  it("moves the default to the chosen calendar", () => {
    const before = [calendar(1, { isDefault: true }), calendar(2)];
    const next = applyCalendarUpdate(before, calendar(2, { isDefault: true }));
    expect(next.map((c) => c.isDefault)).toEqual([false, true]);
    expect(before[0]!.isDefault).toBe(true);
  });

  it("leaves the default alone when another calendar changes", () => {
    const next = applyCalendarUpdate([calendar(1, { isDefault: true }), calendar(2)], calendar(2, { countsAsBusy: false }));
    expect(next.map((c) => c.isDefault)).toEqual([true, false]);
  });
});

describe("looksLikeCalendarLink", () => {
  it.each(["https://calendar.google.com/calendar/ical/x/basic.ics", "webcal://p01-caldav.icloud.com/published/2/abc", "HTTPS://X.test/a", "  https://x.test/a.ics  "])(
    "accepts %j",
    (link) => {
      expect(looksLikeCalendarLink(link)).toBe(true);
    },
  );

  it.each(["", "   ", "calendar.google.com/x", "http://x.test/a.ics", "ftp://x.test/a", "https://", "https://x.test/a b", "javascript:alert(1)", "meine Mail"])(
    "rejects %j",
    (link) => {
      expect(looksLikeCalendarLink(link)).toBe(false);
    },
  );
});
