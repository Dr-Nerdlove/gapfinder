import { describe, expect, it } from "vitest";
import { openHashOf } from "./worker-message";

describe("openHashOf", () => {
  it("accepts a poll page", () => {
    expect(openHashOf({ type: "open", hash: "#/abstimmung/abc_DEF-123" })).toBe("#/abstimmung/abc_DEF-123");
  });

  it("rejects other types, other pages and broken data", () => {
    expect(openHashOf({ type: "close", hash: "#/abstimmung/abc" })).toBeNull();
    expect(openHashOf({ type: "open", hash: "#/verwaltung" })).toBeNull();
    expect(openHashOf({ type: "open", hash: "#/abstimmung/" })).toBeNull();
    expect(openHashOf({ type: "open", hash: "https://evil.example/#/abstimmung/abc" })).toBeNull();
    expect(openHashOf({ type: "open", hash: "#/abstimmung/a/b" })).toBeNull();
    expect(openHashOf({ type: "open", hash: 5 })).toBeNull();
    expect(openHashOf({ type: "open" })).toBeNull();
    expect(openHashOf(null)).toBeNull();
    expect(openHashOf("open")).toBeNull();
  });
});
