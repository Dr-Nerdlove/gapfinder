import type { DoorbellStatus } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { doorbellDevicesText, doorbellLastRingText, doorbellStateText } from "./doorbell-status";

const status = (state: DoorbellStatus["state"]): DoorbellStatus => ({ state, devicesWithToken: 0, lastRing: null });

describe("doorbell status texts", () => {
  it("tells the three states apart", () => {
    expect(doorbellStateText(status("ready"))).toMatch(/^Bereit/);
    expect(doorbellStateText(status("not_configured"))).toMatch(/^Nicht eingerichtet/);
    expect(doorbellStateText(status("invalid"))).toMatch(/ungültig/);
  });

  it("counts the phones", () => {
    expect(doorbellDevicesText(0)).toBe("Noch kein Handy angemeldet");
    expect(doorbellDevicesText(1)).toBe("1 Handy kann sofort benachrichtigt werden");
    expect(doorbellDevicesText(3)).toBe("3 Handys können sofort benachrichtigt werden");
  });

  it("describes the last ring with its time and result", () => {
    expect(doorbellLastRingText(null)).toMatch(/noch nichts gesendet/);
    const at = "2026-11-05T11:00:00.000Z";
    expect(doorbellLastRingText({ at, ok: true })).toMatch(/angekommen bei Google$/);
    expect(doorbellLastRingText({ at, ok: false })).toMatch(/hat nicht geklappt$/);
    expect(doorbellLastRingText({ at, ok: true })).toContain("2026");
  });
});
