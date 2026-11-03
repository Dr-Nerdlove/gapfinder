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
    ["#/suche", { name: "search" }],
    ["#/suche/", { name: "search" }],
    ["#/suche?x=1", { name: "search" }],
    ["#/verwaltung", { name: "admin" }],
    ["#/verwaltung?x=1", { name: "admin" }],
    ["#/privatsphaere", { name: "privacy" }],
    ["#/privatsphaere/", { name: "privacy" }],
  ])("maps %j to its page", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("reads the token of an invite link", () => {
    expect(parseRoute("#/einladung/aB3_-xY9")).toEqual({ name: "invite", token: "aB3_-xY9" });
    expect(parseRoute("#/einladung/aB3_-xY9/")).toEqual({ name: "invite", token: "aB3_-xY9" });
  });

  it("maps the poll pages", () => {
    expect(parseRoute("#/abstimmungen")).toEqual({ name: "polls" });
    expect(parseRoute("#/abstimmungen/")).toEqual({ name: "polls" });
    expect(parseRoute("#/abstimmung-neu")).toEqual({ name: "poll-new" });
  });

  it("reads the share token of a poll link", () => {
    expect(parseRoute("#/abstimmung/aB3_-xY9")).toEqual({ name: "poll", token: "aB3_-xY9" });
    expect(parseRoute("#/abstimmung/aB3_-xY9/")).toEqual({ name: "poll", token: "aB3_-xY9" });
    expect(parseRoute("#/abstimmung/aB3_-xY9?x=1")).toEqual({ name: "poll", token: "aB3_-xY9" });
    expect(parseRoute("#/abstimmung/")).toEqual({ name: "not-found" });
    expect(parseRoute("#/abstimmung/a b")).toEqual({ name: "not-found" });
    expect(parseRoute("#/abstimmung/a/b")).toEqual({ name: "not-found" });
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
