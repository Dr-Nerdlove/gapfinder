import { describe, expect, it } from "vitest";
import { PASSWORD_MISMATCH_MESSAGE, PASSWORD_TOO_SHORT_MESSAGE, USERNAME_MESSAGES } from "./messages";
import { checkNewPassword, checkUsername } from "./validation";

describe("checkUsername", () => {
  it("accepts a normal name, also with extra spaces", () => {
    expect(checkUsername("Vincent R.")).toBeNull();
    expect(checkUsername("  Jörg   Müller  ")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(checkUsername("A")).toBe(USERNAME_MESSAGES.too_short);
    expect(checkUsername("x".repeat(33))).toBe(USERNAME_MESSAGES.too_long);
    expect(checkUsername("Anna <3")).toBe(USERNAME_MESSAGES.invalid_characters);
  });
});

describe("checkNewPassword", () => {
  it("accepts a long enough password that was repeated", () => {
    expect(checkNewPassword("geheim123", "geheim123")).toBeNull();
  });

  it("rejects short passwords, too long ones and different repetitions", () => {
    expect(checkNewPassword("kurz", "kurz")).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(checkNewPassword("x".repeat(257), "x".repeat(257))).toContain("höchstens");
    expect(checkNewPassword("geheim123", "geheim124")).toBe(PASSWORD_MISMATCH_MESSAGE);
  });
});
