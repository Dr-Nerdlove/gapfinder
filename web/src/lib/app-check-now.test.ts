import { beforeEach, describe, expect, it } from "vitest";
import { NEEDS_NEWER_APP_TEXT, OPEN_CHECK_GAP_MS, claimOpenCheck, resetOpenCheck, testNotificationNote } from "./app-check-now";

describe("claimOpenCheck", () => {
  beforeEach(resetOpenCheck);

  it("lets the first check through", () => {
    expect(claimOpenCheck(1_000_000)).toBe(true);
  });

  it("holds back a second check within 60 seconds", () => {
    expect(claimOpenCheck(1_000_000)).toBe(true);
    expect(claimOpenCheck(1_000_000 + OPEN_CHECK_GAP_MS - 1)).toBe(false);
  });

  it("lets one through again after 60 seconds, counted from the last one that ran", () => {
    expect(claimOpenCheck(1_000_000)).toBe(true);
    expect(claimOpenCheck(1_000_000 + 30_000)).toBe(false); // does not move the start
    expect(claimOpenCheck(1_000_000 + OPEN_CHECK_GAP_MS)).toBe(true);
    expect(claimOpenCheck(1_000_000 + OPEN_CHECK_GAP_MS + 1)).toBe(false);
  });

  it("counts a manual check, which itself is never held back", () => {
    expect(claimOpenCheck(1_000_000)).toBe(true);
    expect(claimOpenCheck(1_000_010, true)).toBe(true);
    expect(claimOpenCheck(1_000_020)).toBe(false);
  });
});

describe("testNotificationNote", () => {
  it("tells where to look when the test was sent", () => {
    expect(testNotificationNote({ shown: true })).toBe(
      "Test-Benachrichtigung gesendet. Siehst du sie nicht, blockiert Android sie: Einstellungen → Apps → Lückenfüller → Benachrichtigungen.",
    );
  });

  it("names the settings when Android blocks it", () => {
    expect(testNotificationNote({ shown: false })).toContain("Android blockiert Benachrichtigungen");
    expect(testNotificationNote({ shown: false })).toContain("Einstellungen → Apps → Lückenfüller → Benachrichtigungen");
  });

  it("has a text for an older app", () => {
    expect(NEEDS_NEWER_APP_TEXT).toBe("Dafür braucht es eine neuere Version der App.");
  });
});
