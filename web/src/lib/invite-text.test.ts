import { describe, expect, it } from "vitest";
import { inviteMessage } from "./invite-text";

describe("inviteMessage", () => {
  const text = inviteMessage("https://x.test/#/einladung/tok", 14);

  it("greets and contains the invite link", () => {
    expect(text.startsWith("Hello there! 👋")).toBe(true);
    expect(text).toContain("nur einmal: https://x.test/#/einladung/tok\n");
  });

  it("names the number of days the link is valid", () => {
    expect(text).toContain("Der Link funktioniert 14 Tage lang und nur einmal:");
    expect(inviteMessage("l", 3)).toContain("funktioniert 3 Tage lang und nur einmal");
  });

  it("keeps each step on one line, so WhatsApp indents all of it", () => {
    const lines = text.split("\n");
    const start = lines.indexOf("*So geht's:*");
    expect(lines.slice(start + 1, start + 4).map((line) => line.slice(0, 3))).toEqual(["1. ", "2. ", "3. "]);
    expect(lines[start + 2]).toContain("*Deine Termine bleiben dabei immer privat:*");
    expect(lines[start + 4]).toBe("");
  });

  it("keeps the three steps and the two notes", () => {
    expect(text).toContain("*So geht's:*");
    expect(text).toMatch(/\n2\. Verknüpfe/);
    expect(text).toMatch(/\n3\. Das war's/);
    expect(text).toContain("*Deine Termine bleiben dabei immer privat:*");
    expect(text).toContain("1 bis 7 Uhr");
  });
});
