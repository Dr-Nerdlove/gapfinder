import { describe, expect, it } from "vitest";
import { INSTALL_HINT_KEY, dismissInstallHint, installHintDismissed, installHintKind } from "./install-hint";
import type { Platform } from "./push";
import { MemoryStorage, brokenStorage } from "./test-storage";

describe("installHintKind", () => {
  it.each<[Platform, boolean, boolean, string | null]>([
    ["ios", false, false, "ios"],
    ["ios", true, false, null],
    ["ios", false, true, "ios"],
    ["android", false, false, "android"],
    ["android", true, false, "android"],
    ["android", false, true, null],
    ["android", true, true, null],
    ["other", false, false, null],
    ["other", true, true, null],
  ])("%s standalone=%s inApp=%s -> %s", (platform, standalone, inApp, expected) => {
    expect(installHintKind(platform, standalone, inApp)).toBe(expected);
  });
});

describe("install hint dismissal", () => {
  it("is not dismissed at first, dismissed afterwards", () => {
    const storage = new MemoryStorage();
    expect(installHintDismissed(storage)).toBe(false);
    dismissInstallHint(storage);
    expect(installHintDismissed(storage)).toBe(true);
    expect(storage.getItem(INSTALL_HINT_KEY)).toBe("1");
  });

  it("without storage: not dismissed, and dismissing does not throw", () => {
    expect(installHintDismissed(null)).toBe(false);
    expect(() => dismissInstallHint(null)).not.toThrow();
  });

  it("with throwing storage: not dismissed, nothing throws", () => {
    expect(installHintDismissed(brokenStorage)).toBe(false);
    expect(() => dismissInstallHint(brokenStorage)).not.toThrow();
  });
});
