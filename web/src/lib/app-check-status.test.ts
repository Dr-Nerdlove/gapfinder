import { describe, expect, it } from "vitest";
import { appCheckLine } from "./app-check-status";

// 2026-11-05 12:00 in Berlin (UTC+1)
const now = Date.parse("2026-11-05T11:00:00Z");

describe("appCheckLine", () => {
  it("says nothing for an older app shell", () => {
    expect(appCheckLine(undefined, now)).toBeNull();
  });

  it("explains that no check has run yet", () => {
    expect(appCheckLine(null, now)).toBe("Noch nicht nach Neuem gesehen. Das passiert etwa alle 15 Minuten.");
  });

  it("keeps 'alles in Ordnung' for an older shell without a count", () => {
    // 00:32 UTC is 01:32 in Berlin
    expect(appCheckLine({ at: Date.parse("2026-11-05T00:32:00Z"), result: "ok" }, now)).toBe(
      "Zuletzt nach Neuem gesehen: heute, 01:32 – alles in Ordnung.",
    );
  });

  it("says how many notifications the check showed", () => {
    const at = Date.parse("2026-11-05T00:32:00Z");
    expect(appCheckLine({ at, result: "ok", count: 0 }, now)).toBe("Zuletzt nach Neuem gesehen: heute, 01:32 – nichts Neues.");
    expect(appCheckLine({ at, result: "ok", count: 1 }, now)).toBe("Zuletzt nach Neuem gesehen: heute, 01:32 – 1 neue Benachrichtigung.");
    expect(appCheckLine({ at, result: "ok", count: 3 }, now)).toBe("Zuletzt nach Neuem gesehen: heute, 01:32 – 3 neue Benachrichtigungen.");
  });

  it("leaves the other results as they are, whatever the count", () => {
    const at = Date.parse("2026-11-05T00:32:00Z");
    expect(appCheckLine({ at, result: "error", count: 2 }, now)).toBe(
      "Zuletzt versucht: heute, 01:32 – das hat nicht geklappt. Nächster Versuch in etwa 15 Minuten.",
    );
  });

  it("shows unavailable and error", () => {
    const at = Date.parse("2026-11-05T00:32:00Z");
    expect(appCheckLine({ at, result: "unavailable" }, now)).toBe(
      "Zuletzt versucht: heute, 01:32 – der Server war nicht erreichbar. Nächster Versuch in etwa 15 Minuten.",
    );
    expect(appCheckLine({ at, result: "error" }, now)).toBe(
      "Zuletzt versucht: heute, 01:32 – das hat nicht geklappt. Nächster Versuch in etwa 15 Minuten.",
    );
  });

  it("uses the German calendar day, not UTC", () => {
    // 23:30 UTC on the 4th is 00:30 on the 5th in Berlin: today
    expect(appCheckLine({ at: Date.parse("2026-11-04T23:30:00Z"), result: "ok" }, now)).toContain("heute, 00:30");
  });

  it("says gestern", () => {
    expect(appCheckLine({ at: Date.parse("2026-11-04T10:00:00Z"), result: "ok" }, now)).toContain("gestern, 11:00");
  });

  it("names older days with weekday and date", () => {
    // 3 Nov 2026 is a Tuesday
    expect(appCheckLine({ at: Date.parse("2026-11-03T10:00:00Z"), result: "ok" }, now)).toContain("Di 3.11., 11:00");
  });
});
