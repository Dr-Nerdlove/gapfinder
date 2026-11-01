import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it.each(["", "#", "#/", "#/?utm=1"])("maps %j to the start page", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "start" });
  });

  it.each([
    ["#/anmelden", { name: "login" }],
    ["#/anmelden/", { name: "login" }],
    ["#/profil", { name: "profile" }],
    ["#/kalender", { name: "calendars" }],
    ["#/kalender/", { name: "calendars" }],
    ["#/kalender?x=1", { name: "calendars" }],
    ["#/verwaltung", { name: "admin" }],
    ["#/verwaltung?x=1", { name: "admin" }],
  ])("maps %j to its page", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("reads the token of an invite link", () => {
    expect(parseRoute("#/einladung/aB3_-xY9")).toEqual({ name: "invite", token: "aB3_-xY9" });
    expect(parseRoute("#/einladung/aB3_-xY9/")).toEqual({ name: "invite", token: "aB3_-xY9" });
  });

  it("reads the token of a password reset link", () => {
    expect(parseRoute("#/passwort/Zz09_-")).toEqual({ name: "password-reset", token: "Zz09_-" });
  });

  it.each([
    "#/einladung",
    "#/einladung/",
    "#/einladung/abc/def",
    "#/einladung/ab+c",
    "#/einladung/ab=",
    "#/einladung/ab%20c",
    "#/einladung/ab c",
    "#/einladung/ä",
    "#/passwort",
    "#/passwort/a.b",
    "#/passwort/a/b",
    "#/passwort/../etc",
    `#/passwort/${"a".repeat(513)}`,
  ])("maps the bad token link %j to not-found", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "not-found" });
  });

  it.each(["#/gibt-es-nicht", "#/start/extra", "#nonsense", "#/profil/extra", "#/kalender/extra", "#/calendars", "#/token/abc"])(
    "maps %j to not-found",
    (hash) => {
      expect(parseRoute(hash)).toEqual({ name: "not-found" });
    },
  );
});
