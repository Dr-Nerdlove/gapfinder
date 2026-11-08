import { describe, expect, it } from "vitest";
import { inviteMessage } from "./invite-text";

describe("inviteMessage", () => {
  const text = inviteMessage("https://x.test/#/einladung/tok", 14);

  it("contains the invite link", () => {
    expect(text).toContain("leg ein Passwort fest: https://x.test/#/einladung/tok\n");
  });

  it("names the number of days the link is valid", () => {
    expect(text).toContain("Der Link gilt 14 Tage und funktioniert nur einmal.");
    expect(inviteMessage("l", 3)).toContain("gilt 3 Tage");
  });

  it("keeps the three steps and the two notes", () => {
    expect(text).toContain("*So geht's:*");
    expect(text).toMatch(/\n2\. Verknüpfe/);
    expect(text).toMatch(/\n3\. Das war's/);
    expect(text).toContain("Datenschutz");
    expect(text).toContain("1 bis 7 Uhr");
  });
});
