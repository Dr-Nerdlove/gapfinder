// The shared package has no test runner of its own, so its helpers are tested here.
import {
  normalizeName,
  normalizeSeedColor,
  suggestUsername,
  USERNAME_MAX_LENGTH,
  usernameKey,
  usernameProblem,
} from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";

describe("normalizeName / usernameKey", () => {
  it("trims, collapses whitespace and composes unicode", () => {
    expect(normalizeName("  Vincent \t  R.  ")).toBe("Vincent R.");
    expect(normalizeName("Amélie")).toBe("Amélie");
  });

  it("compares usernames without case", () => {
    expect(usernameKey("Vincent  R.")).toBe(usernameKey("vincent r."));
    expect(usernameKey("Jürgen")).not.toBe(usernameKey("Jurgen"));
  });
});

describe("usernameProblem", () => {
  it.each(["Vincent R.", "Anna-Lena", "O'Neil", "Zoë", "Jörg_2", "李雷", "Al"])("accepts %s", (name) => {
    expect(usernameProblem(name)).toBeNull();
  });

  it("rejects too short and too long names", () => {
    expect(usernameProblem("A")).toBe("too_short");
    expect(usernameProblem("")).toBe("too_short");
    expect(usernameProblem("a".repeat(USERNAME_MAX_LENGTH))).toBeNull();
    expect(usernameProblem("a".repeat(USERNAME_MAX_LENGTH + 1))).toBe("too_long");
  });

  it.each(["<script>", "a@b", "12", "..", "a/b", "tab\tname"])("rejects %j", (name) => {
    expect(usernameProblem(name)).toBe("invalid_characters");
  });
});

describe("suggestUsername", () => {
  it("uses first names plus the initial of the last name", () => {
    expect(suggestUsername("Vincent Richter")).toBe("Vincent R.");
    expect(suggestUsername("Anna Maria Schmidt")).toBe("Anna Maria S.");
    expect(suggestUsername("  vincent   richter ")).toBe("vincent R.");
    expect(suggestUsername("Max")).toBe("Max");
    expect(suggestUsername("Émile Zola")).toBe("Émile Z.");
  });

  it("returns an empty string for an empty name and cuts long names", () => {
    expect(suggestUsername("   ")).toBe("");
    expect([...suggestUsername("A".repeat(100) + " Zed")].length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
  });
});

describe("normalizeSeedColor", () => {
  it("returns lower-case #rrggbb", () => {
    expect(normalizeSeedColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeSeedColor("  #0a1b2c ")).toBe("#0a1b2c");
  });

  it.each(["", "red", "#abc", "aabbcc", "#aabbccdd", "#gggggg"])("rejects %j", (value) => {
    expect(normalizeSeedColor(value)).toBeNull();
  });
});
