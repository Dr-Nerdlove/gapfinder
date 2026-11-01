import { describe, expect, it } from "vitest";
import { buildInviteLink, buildPasswordResetLink } from "./links";

const where = { origin: "https://dr-nerdlove.github.io", pathname: "/gapfinder/" };

describe("links", () => {
  it("builds the invite link on the page's own address", () => {
    expect(buildInviteLink("abc_DEF-123", where)).toBe("https://dr-nerdlove.github.io/gapfinder/#/einladung/abc_DEF-123");
  });

  it("builds the password reset link", () => {
    expect(buildPasswordResetLink("tok-9", where)).toBe("https://dr-nerdlove.github.io/gapfinder/#/passwort/tok-9");
  });

  it("works for a page served from the root", () => {
    expect(buildInviteLink("t", { origin: "http://localhost:5173", pathname: "/" })).toBe("http://localhost:5173/#/einladung/t");
  });
});
