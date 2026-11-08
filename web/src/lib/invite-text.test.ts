import { describe, expect, it } from "vitest";
import { inviteMessage } from "./invite-text";

describe("inviteMessage", () => {
  const text = inviteMessage("https://x.test/#/einladung/tok", 14);

  it("greets and contains the invite link", () => {
    expect(text.startsWith("Hello there! 👋")).toBe(true);
    expect(text).toContain("leg ein Passwort fest: https://x.test/#/einladung/tok\n");
  });

  it("names the number of days the link is valid", () => {
    expect(text).toContain("(Der Link funktioniert 14 Tage lang)");
    expect(inviteMessage("l", 3)).toContain("funktioniert 3 Tage lang");
  });

  it("keeps the three steps and the two notes", () => {
    expect(text).toContain("*So geht's:*");
    expect(text).toMatch(/\n2\. Verknüpfe/);
    expect(text).toMatch(/\n3\. Das war's/);
    expect(text).toContain("*Deine Termine bleiben dabei immer privat:*");
    expect(text).toContain("1 bis 7 Uhr");
  });
});
