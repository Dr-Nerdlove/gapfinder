import { describe, expect, it } from "vitest";
import { pollWaitingText, showSleepCard } from "./sleep-notice";

describe("showSleepCard", () => {
  it("shows the card only when the server is away and no notice says so already", () => {
    expect(showSleepCard({ kind: "offline", reason: "network" }, false)).toBe(true);
    expect(showSleepCard({ kind: "offline", reason: "timeout" }, true)).toBe(false);
  });

  it("shows nothing while loading or when online", () => {
    expect(showSleepCard({ kind: "loading" }, false)).toBe(false);
    expect(showSleepCard({ kind: "online", version: "sha-abc1234", features: [] }, false)).toBe(false);
  });
});

describe("pollWaitingText", () => {
  it("keeps the full explanation without a notice", () => {
    expect(pollWaitingText(true, false)).toContain("1 bis 7");
    expect(pollWaitingText(false, false)).toContain("1 bis 7");
  });

  it("does not repeat the sleep message when the notice is visible", () => {
    expect(pollWaitingText(true, true)).not.toContain("1 bis 7");
    expect(pollWaitingText(false, true)).not.toContain("1 bis 7");
    expect(pollWaitingText(true, true)).toContain("Ab 7 Uhr");
    expect(pollWaitingText(false, true)).toContain("30 Sekunden");
  });
});
