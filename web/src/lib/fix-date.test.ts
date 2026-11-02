import type { FixCheck, Proposal } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import type { ApiResult } from "./api";
import {
  eventOf,
  fixedIdOf,
  fixedProposal,
  googleCalendarUrl,
  outlookCalendarUrl,
  reviewCheck,
  serverCanFix,
  startChoice,
  warningLines,
} from "./fix-date";

const TIMED: Proposal = { id: 1, start: "2026-12-12T13:00:00.000Z", end: "2026-12-12T16:00:00.000Z" };
const DAYS: Proposal = { id: 2, first: "2026-12-30", last: "2026-12-31" };
const person = (id: number, username: string) => ({ id, username, seedColor: null });
const poll = { title: "Bowling & Pizza", note: "Hauptstr. 4, Ärger?", proposals: [TIMED, DAYS], fixedProposalId: null as number | null | undefined };

describe("which date is fixed", () => {
  it("reads the fixed proposal", () => {
    expect(fixedIdOf({ fixedProposalId: 2 })).toBe(2);
    expect(fixedProposal({ ...poll, fixedProposalId: 2 })).toBe(DAYS);
    expect(fixedProposal(poll)).toBeNull();
    expect(fixedProposal({ ...poll, fixedProposalId: 99 })).toBeNull();
  });

  it("treats a missing field (older server) as 'not fixed' and hides the buttons", () => {
    expect(fixedIdOf({})).toBeNull();
    expect(fixedProposal({ ...poll, fixedProposalId: undefined })).toBeNull();
    expect(serverCanFix({})).toBe(false);
    expect(serverCanFix({ fixedProposalId: null })).toBe(true);
    expect(serverCanFix({ fixedProposalId: 1 })).toBe(true);
  });

  it("starts the choice on the fixed, else the best, else the first proposal", () => {
    expect(startChoice({ ...poll, fixedProposalId: 2 }, [1])).toBe(2);
    expect(startChoice(poll, [2, 1])).toBe(2);
    expect(startChoice(poll, [])).toBe(1);
    expect(startChoice({ proposals: [], fixedProposalId: null }, [])).toBeNull();
  });
});

describe("Google Calendar link", () => {
  it("fills in a timed event in UTC", () => {
    const url = new URL(googleCalendarUrl(eventOf(poll, TIMED)));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Bowling & Pizza");
    expect(url.searchParams.get("dates")).toBe("20261212T130000Z/20261212T160000Z");
    expect(url.searchParams.get("details")).toBe("Hauptstr. 4, Ärger?");
  });

  it("ends a whole-day event on the day after the last day, across the new year", () => {
    const url = new URL(googleCalendarUrl(eventOf(poll, DAYS)));
    expect(url.searchParams.get("dates")).toBe("20261230/20270101");
    const single = new URL(googleCalendarUrl(eventOf(poll, { id: 3, first: "2026-02-28", last: "2026-02-28" })));
    expect(single.searchParams.get("dates")).toBe("20260228/20260301");
  });

  it("escapes the texts and leaves out an empty note", () => {
    const raw = googleCalendarUrl(eventOf(poll, TIMED));
    expect(raw).toContain("text=Bowling%20%26%20Pizza");
    expect(raw).not.toContain("& Pizza");
    expect(googleCalendarUrl(eventOf({ ...poll, note: "" }, TIMED))).not.toContain("details=");
  });
});

describe("Outlook link", () => {
  it("fills in a timed event in UTC", () => {
    const url = new URL(outlookCalendarUrl(eventOf(poll, TIMED)));
    expect(url.origin + url.pathname).toBe("https://outlook.live.com/calendar/0/deeplink/compose");
    expect(url.searchParams.get("path")).toBe("/calendar/action/compose");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("subject")).toBe("Bowling & Pizza");
    expect(url.searchParams.get("startdt")).toBe("2026-12-12T13:00:00Z");
    expect(url.searchParams.get("enddt")).toBe("2026-12-12T16:00:00Z");
    expect(url.searchParams.get("allday")).toBeNull();
    expect(url.searchParams.get("body")).toBe("Hauptstr. 4, Ärger?");
  });

  it("marks whole days as all-day with the day after the last day as the end", () => {
    const url = new URL(outlookCalendarUrl(eventOf(poll, DAYS)));
    expect(url.searchParams.get("allday")).toBe("true");
    expect(url.searchParams.get("startdt")).toBe("2026-12-30");
    expect(url.searchParams.get("enddt")).toBe("2027-01-01");
  });

  it("leaves out an empty note", () => {
    expect(outlookCalendarUrl(eventOf({ ...poll, note: "" }, TIMED))).not.toContain("body=");
  });
});

describe("the check before fixing", () => {
  const check = (over: Partial<FixCheck> = {}): FixCheck => ({ proposalId: 1, busy: [], unreadable: [], noCalendar: [], ...over });
  const ok = (data: FixCheck): ApiResult<FixCheck> => ({ ok: true, data });

  it("is clear when nobody is busy, unreadable or without a calendar", () => {
    expect(reviewCheck(ok(check()))).toMatchObject({ kind: "checked", clear: true });
  });

  it("is not clear when any of the three lists has a person", () => {
    for (const over of [{ busy: [person(2, "Anna")] }, { unreadable: [person(3, "Chris")] }, { noCalendar: [person(4, "Dora")] }]) {
      expect(reviewCheck(ok(check(over)))).toMatchObject({ kind: "checked", clear: false });
    }
  });

  it("names the people of each group in plain words, leaving out empty groups", () => {
    expect(warningLines(check({ busy: [person(2, "Anna"), person(5, "Ben")], noCalendar: [person(4, "Dora")] }))).toEqual([
      "Laut Kalender nicht frei: Anna, Ben",
      "Kein Kalender verknüpft: Dora",
    ]);
    expect(warningLines(check({ unreadable: [person(3, "Chris")] }))).toEqual(["Kalender nicht lesbar: Chris"]);
    expect(warningLines(check())).toEqual([]);
  });

  it("does not block fixing when the check fails", () => {
    expect(reviewCheck({ ok: false, kind: "offline" })).toMatchObject({ kind: "unchecked" });
    const rate = reviewCheck({ ok: false, kind: "error", status: 429, code: "rate_limited", retryAfterSeconds: 120 });
    expect(rate).toMatchObject({ kind: "unchecked" });
    expect(rate.kind === "unchecked" && rate.text).toContain("2 Minuten");
    const key = reviewCheck({ ok: false, kind: "error", status: 503, code: "calendars_unavailable" });
    expect(key.kind === "unchecked" && key.text).toContain("noch nicht eingerichtet");
  });
});

