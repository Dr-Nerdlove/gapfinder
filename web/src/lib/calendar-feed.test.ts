import { describe, expect, it } from "vitest";
import { feedFetchLines, feedScreenOf } from "./calendar-feed";

describe("the profile's calendar feed", () => {
  it("shows the link while the feed is on and the switch while it is off", () => {
    expect(feedScreenOf({ ok: true, data: { token: "abc" } })).toEqual({ phase: "on", token: "abc", fetches: undefined });
    expect(feedScreenOf({ ok: true, data: { token: null } })).toEqual({ phase: "off" });
  });

  it("waits when the server sleeps", () => {
    expect(feedScreenOf({ ok: false, kind: "offline" })).toEqual({ phase: "waiting" });
  });

  it("says 'not there yet' for an older server that does not know the route", () => {
    expect(feedScreenOf({ ok: false, kind: "error", status: 404, code: "error" })).toEqual({ phase: "unavailable" });
  });

  it("shows other errors as text", () => {
    const screen = feedScreenOf({ ok: false, kind: "error", status: 500, code: "error" });
    expect(screen).toMatchObject({ phase: "failed" });
  });

  it("passes on the fetches the server sends", () => {
    const fetches = [{ app: "google" as const, at: "2026-11-01T10:00:00.000Z" }];
    expect(feedScreenOf({ ok: true, data: { token: "abc", fetches } })).toEqual({ phase: "on", token: "abc", fetches });
  });
});

describe("the lines about the last fetches", () => {
  it("shows nothing when an older server sends no fetches", () => {
    expect(feedFetchLines(undefined)).toBeNull();
  });

  it("is an empty list when nothing was fetched yet", () => {
    expect(feedFetchLines([])).toEqual([]);
  });

  it("names the app and the time, in the given order", () => {
    const lines = feedFetchLines([
      { app: "apple", at: "2026-11-01T10:30:00.000Z" },
      { app: "google", at: "2026-11-01T10:00:00.000Z" },
      { app: "microsoft", at: "2026-11-01T09:00:00.000Z" },
      { app: "other", at: "2026-11-01T08:00:00.000Z" },
    ])!;
    expect(lines.map((line) => line.split(":")[0])).toEqual(["Apple Kalender", "Google Kalender", "Outlook", "Anderes Programm (z. B. Browser)"]);
    expect(lines[0]).toContain("11:30");
  });
});
